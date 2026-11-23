/*
 * squid-core.js — faithful JavaScript port of SQUID1.COM's logic.
 *
 * Original: "Squid BBS" intro, SQUID1.ASM by cld & The Doctor (31-Jan-1994),
 * Curitiba, Brazil. Freeware; the authors ask that they be credited.
 *
 * The port works on a 64 KB memory image laid out exactly like the original
 * program (the .COM loaded at 0100h plus its uninitialised tables), so the
 * original's quirks come through unchanged: the font smoother, the filler
 * characters the smoothing table picks up from neighbouring data, and the
 * "chorus" detune that really comes from the high bytes of the track pointers.
 * Each routine below is named after its label in SQUID1.ASM.
 *
 * No DOM here: the renderer and the OPL2 synth consume this state.
 */
(function (root) {
  "use strict";

  // Addresses of the tables and variables inside SQUID1.COM (as loaded at 0x100)
  const A = {
    CREDITS: 0x0522, FONTE: 0x0548, SCROLLER: 0x0673, SINTABLE: 0x06ff,
    NOTE2FREQ: 0x0740, REG_INDEX: 0x0758, ARPEGIATOR: 0x0761,
    INSTRUMENTS: 0x0800, BRASS: 0x080b, A_PTR: 0x0842, SM_TABLE: 0x0844,
    BASE: 0x085b, FINETUNE: 0x0869, TRACK: 0x0870, NOTELEN: 0x087e,
    TIMER: 0x088c, SCROLL_INDEX: 0x089a, ANGLE: 0x089c, FONTBUFFER: 0x089d,
    PAL_TABLE: 0x189d, EXTENDED: 0x21fd,
  };
  const TRACKS = 7;
  const PAL_LINES = 290;
  const CUSTOM_TEXT = 0xa200;   // free memory past the EXTENDED table, for custom scroll text

  class SquidCore {
    /**
     * @param {Uint8Array} com      bytes of SQUID1.COM
     * @param {Uint8Array} romFont  4096-byte VGA 8x16 ROM font
     * @param {object} [opts]
     * @param {(reg:number, val:number)=>void} [opts.onOpl]  AdLib register writes
     * @param {object} [opts.custom]  modern-version content; omit for the original.
     *   glyphs: {A..Z, 0: 13 row bytes}, scroll: Uint8Array (ASCII),
     *   lines: [{row, attr, bytes: Uint8Array}], colors: {bg, text, bars: [r,g,b] 0..1},
     *   bars: number of sine bars
     * @param {number} [opts.cols=80]  text columns (wider screens for the modern version)
     */
    constructor(com, romFont, opts = {}) {
      this.A = A;
      this.mem = new Uint8Array(0x10000);
      this.mem.set(com, 0x100);
      this.romFont = romFont;
      this.cols = opts.cols || 80;
      this.stride = this.cols * 2;            // bytes per text row
      this.screen = new Uint8Array(this.stride * 25); // B800:0000, char/attr pairs
      this.vgaFont = new Uint8Array(romFont); // character generator RAM
      this.onOpl = opts.onOpl || (() => {});
      this.palInitDone = false;               // the self-modifying "_init_" patch
      this.frameCount = 0;
      this.custom = opts.custom || null;
      this.scrollWrap = A.SCROLLER - 1;
      this.init();
    }

    w16(a) { return this.mem[a & 0xffff] | (this.mem[(a + 1) & 0xffff] << 8); }
    s16(a, v) { this.mem[a & 0xffff] = v & 0xff; this.mem[(a + 1) & 0xffff] = (v >> 8) & 0xff; }
    addata(reg, val) { this.onOpl(reg & 0xff, val & 0xff); }

    // ---- start: .. xtend/smooth/patches, Adlib + screen init ----------------
    init() {
      const m = this.mem;
      m.fill(0, A.FINETUNE + 2, A.FINETUNE + 2 + 6 * TRACKS + 2 * 19636);
      this.reset();
      for (let i = 0; i < TRACKS; i++) this.s16(A.TRACK + 2 * i, this.w16(A.BASE + 2 * i));
      // "mov ch,4 / rep movsw": only 400h words = the first 128 characters
      m.set(this.romFont.subarray(0, 2048), A.FONTBUFFER);

      // copy: 23 redefined 8x16 characters starting at 'A' (13 rows each)
      if (this.custom) {
        // modern version: all 26 letters plus Squid's 0, each at its real ASCII code
        for (const [ch, rows] of Object.entries(this.custom.glyphs)) {
          const d = A.FONTBUFFER + ch.charCodeAt(0) * 16;
          m.fill(0, d, d + 16);
          m.set(rows, d + 2);
        }
      } else {
        let di = A.FONTBUFFER + 0x41 * 16, si = A.FONTE;
        for (let c = 0; c < 23; c++) {
          m[di++] = 0; m[di++] = 0;
          for (let r = 0; r < 13; r++) m[di++] = m[si++];
          m[di++] = 0;
        }
      }

      this.setchar();
      // INT 10h/1100h: load chars 00h..CEh of fontbuffer into the VGA
      this.vgaFont.set(m.subarray(A.FONTBUFFER, A.FONTBUFFER + 0xcf * 16), 0);
      this.xtend();
      this.smooth();

      // Patches for '1' and '4' (the smoother misses them)
      this.s16(A.EXTENDED + 0x34 * 256 + 16 * 4 + 6, 0x0103);
      this.s16(A.EXTENDED + 0x34 * 256 + 16 * 4 + 36, 0x0103);
      this.s16(A.EXTENDED + 0x31 * 256 + 16 * 2 + 6, 0x0103);
      this.s16(A.EXTENDED + 0x31 * 256 + 16 * 2 + 36, 0x0103);

      this.addata(0x01, 0x20);                     // enable waveform select
      let bx = this.setInstr(6, 0, A.INSTRUMENTS); // channels 0..5
      this.setInstr(1, bx, A.BRASS);               // channel 6: chorus for solo

      this.screen[0] = 0; this.screen[1] = 0;      // "hide" the cursor
      this.cl = 0;
      if (this.custom) { this.initCustomText(); return; }
      this.bp = A.SCROLLER + 49;
      this.write(A.SCROLLER, 20 * 160 + 34, 11);
      this.write(A.CREDITS, 21 * 160 + 30, 3);
    }

    // modern version: scroll text goes to free memory and loops to its own start;
    // small lines are written centred (plain bytes, no Squid letter encoding).
    initCustomText() {
      const m = this.mem, s = this.screen, c = this.custom;
      const max = 0xfff0 - CUSTOM_TEXT;
      const txt = c.scroll.subarray(0, max);
      m.set(txt, CUSTOM_TEXT);
      m[CUSTOM_TEXT + txt.length] = 0x7f;          // end marker
      this.bp = this.scrollWrap = CUSTOM_TEXT - 1;
      this.writeLines(c.lines || [], 0, this.cols);
    }

    /** Write text lines centred within columns x0..x0+cols (clearing those rows). */
    writeLines(lines, x0, cols) {
      const s = this.screen, st = this.stride;
      for (const ln of lines) {
        s.fill(0, ln.row * st, (ln.row + 1) * st);
        const b = ln.bytes.subarray(0, cols);
        let di = ln.row * st + (x0 + ((cols - b.length) >> 1)) * 2;
        for (let i = 0; i < b.length; i++) {   // optional per-character colours (links)
          s[di++] = b[i]; s[di++] = ln.attrs ? ln.attrs[i] : ln.attr;
        }
      }
    }

    setchar() {
      const m = this.mem;
      let di = A.FONTBUFFER + 0xc0 * 16, bp = di;
      let ax = 1, bx = 0x8000, cx = 32, dx = 32;
      do {
        do {
          m[di] |= ax >> 8; m[di + 64] |= ax & 0xff;
          m[di + 32] |= bx >> 8; m[di + 96] |= bx & 0xff;
          di++;
        } while (--cx);
        ax = (ax << 1) & 0xffff; bx >>= 1; bp++; di = bp;
        dx -= 2; cx = dx & 0xff;
      } while (cx !== 0);
      ax = (ax - 1) & 0xffff;               // "bandeirinhas" (little flags)
      di = A.FONTBUFFER + 0xc8 * 16; let si = di + 15;
      for (let i = 0; i < 8; i++) {
        m[di++] = ax & 0xff; m[si--] = ax & 0xff;
        ax = (ax & 0xff00) | ((ax & 0xff) >> 1);
      }
      ax = (ax - 1) & 0xffff;
      di = A.FONTBUFFER + 0xc9 * 16; si = di + 15;
      for (let i = 0; i < 8; i++) {
        m[di++] = ax & 0xff; m[si--] = ax & 0xff;
        ax = (ax & 0xff00) | (((ax & 0xff) << 1) & 0xff);
      }
    }

    // Blow each 8x16 glyph up into a 8x16 grid of (char 10h, attr 01h) cells,
    // stored column by column: EXTENDED + ch*256 + col*32 + row*2
    xtend() {
      const m = this.mem;
      let si = A.FONTBUFFER, di = A.EXTENDED;
      for (let c = 0; c < 127; c++) {
        let bl = 0x80;
        for (let col = 0; col < 8; col++) {
          for (let row = 0; row < 16; row++) {
            if (m[si++] & bl) this.s16(di, 0x0110);
            di += 2;
          }
          si -= 16; bl >>= 1;
        }
        si += 16;
      }
    }

    // The Doctor's diagonal smoother, transcribed register by register.
    smooth() {
      const m = this.mem;
      let si = A.EXTENDED + 0x2f * 256;
      for (let n = 16 * 8 * (0x7a - 0x2f + 1); n > 0; n--, si += 2) {
        if (m[si] !== 0x10) continue;
        let ah = 0, bx = 0xffde, dx = 0xffc0;
        for (let bp = 4; bp > 0; bp--) {
          const carry = m[(si + bx) & 0xffff] >= 0x10 ? 1 : 0; // add al,0f0h
          ah = ((ah << 1) | carry) & 0xff;                      // rcl ah,1
          bx ^= dx; dx ^= 0xfffc;
        }
        bx = 0x20;
        let al = 0xf9;
        for (;;) {
          let dh = ah ^ al, dl = dh;
          dl = ((dl & 0x0a) >> 1) & dh;
          if (dl !== 0 && m[(si + bx) & 0xffff] !== 0x10) {
            dh = dl & 0x04; dl &= 0x01;
            dl = ((dl << 1) | (al < 0x10 ? 1 : 0)) | dh;
            const t = (si + bx) & 0xffff;
            m[t] = (m[t] + dl) & 0xff;
            m[(t + 1) & 0xffff] = 1;
          }
          if (al === 0x06) break;
          al = ~al & 0xff;
          bx = (-bx) & 0xffff;
        }
      }
    }

    setInstr(count, bx, si) {
      const m = this.mem;
      for (; count > 0; count--, bx++) {
        let ah = m[A.REG_INDEX + bx];
        for (let op = 0; op < 2; op++) {
          for (let k = 0; k < 4; k++) { ah = (ah + 0x20) & 0xff; this.addata(ah, m[si++]); }
          ah = (ah + 0x60) & 0xff; this.addata(ah, m[si++]);
          ah = (ah - 0xdd) & 0xff;
        }
        this.addata(0xc0 + bx, m[si++]);
      }
      return bx;
    }

    reset() { for (let r = 0xf5; r > 0; r--) this.addata(r, 0); }

    // Write a string: 0-terminated; bit 7 = character followed by a space
    write(si, di, attr) {
      const m = this.mem, s = this.screen;
      for (;;) {
        let al = m[si++];
        if (al === 0) return;
        if (al & 0x80) { s[di++] = al & 0x7f; s[di++] = attr; al = 0x20; }
        s[di++] = al; s[di++] = attr;
      }
    }

    /** Palette for scanline-indexed rendering: entry i (0..289) holds
     *  [idx0, R, G, B, idx1, R, G, B] as written to the DAC after line i. */
    palTable() { return this.mem.subarray(A.PAL_TABLE, A.PAL_TABLE + 8 * PAL_LINES); }

    // ---- one pass of mainloop (after the retrace wait and copper loop) -----
    frame() {
      this.scroll();
      this.updscr();
      this.initr();
      this.sinbar();
      this.play();
      this.frameCount++;
    }

    scroll() {
      // rows 3..15, columns 1..cols-3 <- 2..cols-2 (80 cols: 482, 484, 154 bytes)
      const s = this.screen, st = this.stride, n = st - 6;
      for (let r = 0; r < 13; r++) { const d = (3 + r) * st + 2; s.copyWithin(d, d + 2, d + 2 + n); }
    }

    updscr() {
      const m = this.mem, s = this.screen;
      let al, bl, cl = 0;             // cx is 0 on entry (left by scroll)
      for (;;) {
        const bx = this.w16(A.SCROLL_INDEX);
        this.s16(A.SCROLL_INDEX, bx + 1);
        bl = bx & 0xff;
        if (bl & 0x10) {              // gap between letters
          if (!(m[this.bp] & 0x80) && (bl & 1)) this.s16(A.SCROLL_INDEX, 0);
          al = 0x20;
          break;
        }
        cl = bl & 0x0f;
        if (cl === 0) this.bp = (this.bp + 1) & 0xffff;
        cl >>= 1;
        al = m[this.bp] & 0x7f;
        if (al !== 0x7f) break;
        this.bp = this.scrollWrap;    // end of text: wrap around
        this.s16(A.SCROLL_INDEX, 0);
      }
      let si = A.EXTENDED + (al << 8) + ((cl & 0xff) << 5);
      let di = 2 * this.stride - 4;   // row 1, column cols-2 (80 cols: 316)
      const dl = bl, table = A.SM_TABLE - 2;
      for (let i = 0; i < 15; i++, si += 2, di += this.stride) {
        let c = m[si];
        if (dl & 1) c = (c + 8) & 0xff;
        s[di] = m[(table + c) & 0xffff];  // xlat
        s[di + 1] = m[si + 1];
      }
    }

    initr() {
      const m = this.mem;
      let si = A.PAL_TABLE;
      if (this.custom) return this.initrCustom();
      for (let cx = PAL_LINES; cx > 0; cx--, si += 8) {
        const c = cx >> 3;
        m[si] = 0; m[si + 1] = 0;     // colour 0 index, R
        m[si + 2] = c; m[si + 3] = c; // G, B: cyan -> black
        if (!this.palInitDone) {      // colour 1: black -> cyan (first pass only)
          m[si + 4] = 1; m[si + 5] = 0;
          m[si + 6] = ~c & 0xff; m[si + 7] = ~c & 0xff; // "not ax"
        }
      }
      this.palInitDone = true;
    }

    // modern version: same ramps, tinted by RGB weights
    initrCustom() {
      const m = this.mem, { bg, text } = this.custom.colors;
      let si = A.PAL_TABLE;
      for (let cx = PAL_LINES; cx > 0; cx--, si += 8) {
        const c = cx >> 3;
        m[si] = 0; m[si + 4] = 1;
        for (let k = 0; k < 3; k++) {
          m[si + 1 + k] = Math.round(c * bg[k]);
          m[si + 5 + k] = Math.round((63 - c) * text[k]);
        }
      }
    }

    sinbar() {
      const m = this.mem, cu = this.custom;
      const tint = cu ? cu.colors.bars : null;
      for (let cx = cu ? cu.bars : 4; cx > 0; cx--) {
        let al = (m[A.ANGLE] - (cx << 3)) & 0xff, dl = 0;
        if (al & 0x80) { dl = 0xff; al &= 0x7f; }
        if (al > 0x40) al = (-al) & 0x3f;
        al = m[A.SINTABLE + al] ^ dl;
        const ax = (al << 24 >> 24) + 137; // cbw
        let si = A.PAL_TABLE + ax * 8, col = 48;
        for (let k = 0; k < 24; k++, si += 8, col -= 2) {
          if (tint) {
            m[si + 1] = Math.round(col * tint[0]);
            m[si + 2] = Math.round(col * tint[1]);
            m[si + 3] = Math.round(col * tint[2]);
          } else { m[si + 1] = col; m[si + 2] = col; m[si + 3] = col; }
        }
      }
      m[A.ANGLE] = (m[A.ANGLE] + 1) & 0xff;
    }

    // ---- play: the AdLib mini-player (one tick per frame) ------------------
    play() {
      const m = this.mem;
      for (let bx = 0; bx < 2 * TRACKS; bx += 2) {
        if (this.w16(A.TIMER + bx) === 0) {
          let dx = 0;
          if (bx === 0) dx = m[this.w16(A.A_PTR)];
          let si = this.w16(A.TRACK + bx);
          let done = false;
          while (!done) {
            const al = m[si++];
            let ch, cl;
            if (al & 0x80) {                       // note
              ch = al;
              let n = ((al & 0x0f) + dx) & 0xffff;
              if ((n & 0xff) >= 12) { n -= 12; ch = (ch + 0x10) & 0xff; }
              ch = (ch & 0xf0) >> 2;
              const f = this.w16(A.NOTE2FREQ + ((n << 1) & 0xffff));
              ch |= f >> 8; cl = f & 0xff;
              cl = (cl + m[(A.FINETUNE + bx) & 0xffff]) & 0xff;
            } else if (al === 0) {                 // pause (key off)
              ch = 0; cl = 0;
            } else if (al & 0x40) {                // control
              const c = al & 0x3f;
              if (c === 0) {                       // end of track: loop
                this.s16(A.TRACK + bx, this.w16(A.BASE + bx));
                if (bx === 0) {                    // arpeggiator steps on
                  let p = (this.w16(A.A_PTR) + 1) & 0xffff;
                  this.s16(A.A_PTR, p);
                  if (m[p] === 0x40) { p = A.ARPEGIATOR; this.s16(A.A_PTR, p); }
                  dx = m[p];
                }
                si = this.w16(A.TRACK + bx);
              } else {                             // note length
                m[A.NOTELEN + bx] = ((c - 0x0f) << 2) & 0xff;
              }
              continue;
            } else {                               // volume: TL for both ops
              let ax = (((m[A.REG_INDEX + (bx >> 1)] + 0x40) & 0xff) << 8 | al) - 1 & 0xffff;
              this.addata(ax >> 8, ax);
              ax = ((((ax >> 8) + 3) & 0xff) << 8 | m[si++]) - 1 & 0xffff;
              this.addata(ax >> 8, ax);
              continue;
            }
            this.s16(A.TIMER + bx, this.w16(A.NOTELEN + bx));
            this.s16(A.TRACK + bx, si);
            const reg = 0xa0 + (bx >> 1);
            this.addata(reg, cl);
            this.addata(reg + 0x10, 0);
            this.addata(reg + 0x10, ch);
            done = true;
          }
        }
        this.s16(A.TIMER + bx, this.w16(A.TIMER + bx) - 1);
      }
    }
  }

  SquidCore.ADDR = A;
  root.SquidCore = SquidCore;
  if (typeof module !== "undefined" && module.exports) module.exports = SquidCore;
})(typeof window !== "undefined" ? window : globalThis);
