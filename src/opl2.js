/*
 * opl2.js — a compact Yamaha YM3812 (OPL2 / AdLib) FM synthesizer.
 *
 * Written for the Squid remake. It models the parts of the chip that matter
 * for 2-operator melodic voices: log-sine/exponent tables, the four OPL2
 * waveforms, phase generator (F-number, block, multiplier), envelope
 * generator (attack/decay/sustain/release, KSR, percussive vs sustained),
 * key-scale level, total level, feedback and FM/additive connection.
 * Tremolo, vibrato and rhythm mode are not used by Squid and not modelled.
 *
 * The chip runs at its native rate (3.579545 MHz / 72 ≈ 49716 Hz) and is
 * resampled linearly to the output rate.
 */
(function (root) {
  "use strict";

  const NATIVE_RATE = 3579545 / 72;

  // Yamaha's internal tables, regenerated from their known formulas
  const LOGSIN = new Uint16Array(256);
  const EXP = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    LOGSIN[i] = Math.round(-Math.log2(Math.sin(((i + 0.5) * Math.PI) / 512)) * 256);
    EXP[i] = Math.round((Math.pow(2, i / 256) - 1) * 1024);
  }
  const MULT_X2 = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
  const KSL_ROM = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];
  const KSL_SHIFT = [31, 1, 2, 0];
  // Envelope increment patterns per rate (8 steps of 4 bits each)
  const EG_INC = new Uint32Array(64);
  {
    const low = [0x00000000, 0x00000000, 0x10101010, 0x10101010,
                 0x10101010, 0x10101010, 0x11101110, 0x11101110];
    const mid = [0x10101010, 0x10111010, 0x11101110, 0x11111110];
    const high = [0x11111111, 0x21112111, 0x21212121, 0x22212221,
                  0x22222222, 0x42224222, 0x42424242, 0x44424442,
                  0x44444444, 0x84448444, 0x84848484, 0x88848884,
                  0x88888888, 0x88888888, 0x88888888, 0x88888888];
    for (let r = 0; r < 64; r++) {
      EG_INC[r] = r < 8 ? low[r] : r < 48 ? mid[r & 3] : high[r - 48];
    }
  }
  // register offset (0..21) -> [channel, operator]
  const SLOT = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], null, null,
                [3, 0], [4, 0], [5, 0], [3, 1], [4, 1], [5, 1], null, null,
                [6, 0], [7, 0], [8, 0], [6, 1], [7, 1], [8, 1]];

  const ATTACK = 0, DECAY = 1, SUSTAIN = 2, RELEASE = 3;

  class Operator {
    constructor() {
      this.mult = 0; this.ksr = 0; this.egt = 0; this.ksl = 0; this.tl = 0;
      this.ar = 0; this.dr = 0; this.sl = 0; this.rr = 0; this.ws = 0;
      this.phase = 0; this.att = 0x3ff; this.state = RELEASE;
      this.out = 0; this.prevOut = 0;
    }
  }

  class Channel {
    constructor() {
      this.ops = [new Operator(), new Operator()];
      this.fnum = 0; this.block = 0; this.key = 0; this.fb = 0; this.cnt = 0;
    }
  }

  class OPL2 {
    constructor(sampleRate = 48000) {
      this.sampleRate = sampleRate;
      this.ch = Array.from({ length: 9 }, () => new Channel());
      this.waveSel = false;
      this.egCounter = 0;
      this.step = NATIVE_RATE / sampleRate; // native samples per output sample
      this.frac = 0;
      this.prev = 0; this.cur = 0;
      this.gain = 1 / 16400;   // matches DOSBox's OPL emulator level
      // AdLib cards were AC-coupled: block DC like the output capacitor did
      this.dcR = 1 - (2 * Math.PI * 5) / sampleRate; this.dcX = 0; this.dcY = 0;
    }

    write(reg, val) {
      reg &= 0xff; val &= 0xff;
      if (reg === 0x01) { this.waveSel = !!(val & 0x20); return; }
      const hi = reg & 0xe0, lo = reg & 0x1f;
      if (hi >= 0x20 && hi <= 0x80 || hi === 0xe0) {
        const s = SLOT[lo];
        if (!s) return;
        const op = this.ch[s[0]].ops[s[1]];
        switch (hi) {
          case 0x20: op.mult = val & 15; op.ksr = (val >> 4) & 1; op.egt = (val >> 5) & 1; break;
          case 0x40: op.tl = val & 63; op.ksl = val >> 6; break;
          case 0x60: op.ar = val >> 4; op.dr = val & 15; break;
          case 0x80: op.sl = val >> 4; op.rr = val & 15; break;
          case 0xe0: op.ws = val & 3; break;
        }
        return;
      }
      const c = reg & 0x0f;
      if (c > 8) return;
      const ch = this.ch[c];
      if ((reg & 0xf0) === 0xa0) {
        ch.fnum = (ch.fnum & 0x300) | val;
      } else if ((reg & 0xf0) === 0xb0) {
        ch.fnum = (ch.fnum & 0xff) | ((val & 3) << 8);
        ch.block = (val >> 2) & 7;
        const key = (val >> 5) & 1;
        if (key && !ch.key) for (const op of ch.ops) this.keyOn(ch, op);
        if (!key && ch.key) for (const op of ch.ops) op.state = RELEASE;
        ch.key = key;
      } else if ((reg & 0xf0) === 0xc0) {
        ch.cnt = val & 1; ch.fb = (val >> 1) & 7;
      }
    }

    keyOn(ch, op) {
      op.state = ATTACK;
      op.phase = 0;
      if (this.rate(ch, op, op.ar) >= 62) op.att = 0;
    }

    rate(ch, op, r) {
      if (r === 0) return 0;
      const keycode = (ch.block << 1) | ((ch.fnum >> 9) & 1);
      return Math.min(63, r * 4 + (op.ksr ? keycode : keycode >> 2));
    }

    clockEnvelope(ch, op) {
      if (op.state === ATTACK && op.att === 0) op.state = DECAY;
      const slLevel = (op.sl === 15 ? 31 : op.sl) << 5;
      if (op.state === DECAY && op.att >= slLevel) op.state = SUSTAIN;
      let r;
      switch (op.state) {
        case ATTACK: r = op.ar; break;
        case DECAY: r = op.dr; break;
        case SUSTAIN: r = op.egt ? 0 : op.rr; break;
        default: r = op.rr;
      }
      const rate = this.rate(ch, op, r);
      const shift = rate >> 2;
      const counter = this.egCounter * (1 << shift);
      if (counter % 2048 !== 0) return;
      const bits = Math.floor(counter / (1 << (shift <= 11 ? 11 : shift))) & 7;
      const inc = (EG_INC[rate] >>> (4 * bits)) & 15;
      if (op.state === ATTACK) {
        if (rate < 62) op.att += ((~op.att) * inc) >> 4;
        if (op.att < 0) op.att = 0;
      } else {
        op.att += inc;
        if (op.att > 0x3ff) op.att = 0x3ff;
      }
    }

    totalAtt(ch, op) {
      let att = op.att + (op.tl << 3);
      if (op.ksl) {
        const k = 4 * KSL_ROM[ch.fnum >> 6] - 32 * (8 - ch.block);
        if (k > 0) att += k >> KSL_SHIFT[op.ksl];
      }
      return att > 0x3ff ? 0x3ff : att;
    }

    opOut(phase, att, ws) {
      if (!this.waveSel) ws = 0;
      const p = phase & 1023;
      let idx = p & 255, neg = false;
      switch (ws) {
        case 0: if (p & 256) idx = 255 - idx; neg = !!(p & 512); break;
        case 1: if (p & 512) return 0; if (p & 256) idx = 255 - idx; break;
        case 2: if (p & 256) idx = 255 - idx; break;
        case 3: if (p & 256) return 0; break;
      }
      const l = LOGSIN[idx] + (att << 2);
      if (l >= 0x1fff) return 0;
      const v = ((EXP[~l & 255] | 0x400) << 1) >> (l >> 8);
      return neg ? -v : v;
    }

    // One sample at the chip's native rate
    clock() {
      this.egCounter++;
      let mix = 0;
      for (let c = 0; c < 9; c++) {
        const ch = this.ch[c], m = ch.ops[0], k = ch.ops[1];
        this.clockEnvelope(ch, m);
        this.clockEnvelope(ch, k);
        if (m.att >= 0x3ff && k.att >= 0x3ff && m.state === RELEASE && k.state === RELEASE) {
          m.prevOut = m.out = 0; k.out = 0;
        } else {
          const fbmod = ch.fb ? (m.prevOut + m.out) >> (9 - ch.fb) : 0;
          const mo = this.opOut((m.phase >> 10) + fbmod, this.totalAtt(ch, m), m.ws);
          m.prevOut = m.out; m.out = mo;
          const co = this.opOut((k.phase >> 10) + (ch.cnt ? 0 : mo), this.totalAtt(ch, k), k.ws);
          k.out = co;
          mix += ch.cnt ? mo + co : co;
        }
        const base = ch.fnum << ch.block;
        m.phase = (m.phase + ((base * MULT_X2[m.mult]) >> 1)) & 0xfffff;
        k.phase = (k.phase + ((base * MULT_X2[k.mult]) >> 1)) & 0xfffff;
      }
      return mix;
    }

    /** Fill out[offset .. offset+n) with mono samples at sampleRate. */
    generate(out, offset, n) {
      for (let i = 0; i < n; i++) {
        this.frac += this.step;
        while (this.frac >= 1) { this.prev = this.cur; this.cur = this.clock(); this.frac -= 1; }
        const x = (this.prev + (this.cur - this.prev) * this.frac) * this.gain;
        this.dcY = x - this.dcX + this.dcR * this.dcY; this.dcX = x;
        out[offset + i] = this.dcY;
      }
    }
  }

  OPL2.NATIVE_RATE = NATIVE_RATE;
  root.OPL2 = OPL2;
  if (typeof module !== "undefined" && module.exports) module.exports = OPL2;
})(typeof window !== "undefined" ? window : globalThis);
