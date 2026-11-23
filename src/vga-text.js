/*
 * vga-text.js — renders an 80x25 VGA text screen (720x400, 9x16 cells)
 * with per-scanline changes to DAC colours 0 and 1, the way Squid's
 * "copper" loop reprogrammed the palette during each horizontal retrace.
 */
(function (root) {
  "use strict";

  // Default text-mode attribute -> DAC mapping and default DAC values (6-bit)
  const ATTR_TO_DAC = [0, 1, 2, 3, 4, 5, 20, 7, 56, 57, 58, 59, 60, 61, 62, 63];
  const DEFAULT_DAC = {
    0: [0, 0, 0], 1: [0, 0, 42], 2: [0, 42, 0], 3: [0, 42, 42], 4: [42, 0, 0],
    5: [42, 0, 42], 20: [42, 21, 0], 7: [42, 42, 42], 56: [21, 21, 21],
    57: [21, 21, 63], 58: [21, 63, 21], 59: [21, 63, 63], 60: [63, 21, 21],
    61: [63, 21, 63], 62: [63, 63, 21], 63: [63, 63, 63],
  };
  const c6 = (v) => ((v & 63) << 2) | ((v & 63) >> 4);
  const rgba = (r, g, b) => (255 << 24) | (c6(b) << 16) | (c6(g) << 8) | c6(r); // little-endian ABGR

  class VGAText {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = 720; canvas.height = 400;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.img = this.ctx.createImageData(720, 400);
      this.px = new Uint32Array(this.img.data.buffer);
      this.base = ATTR_TO_DAC.map((d) => rgba(...DEFAULT_DAC[d]));
      this.colors = new Uint32Array(16);
    }

    /**
     * @param {Uint8Array} screen  char/attr pairs, `stride` bytes per row
     * @param {Uint8Array} font    256*16 bytes (character generator)
     * @param {Uint8Array} pal     290 entries of 8 bytes (Squid's pal_table)
     * @param {object} [view]      wide-screen options (modern version):
     *   stride: bytes per screen row (160), x0: first column shown (0), cols: columns shown (80),
     *   shift: pixels (0-8) to slide rows rowA..rowB-1 left, for smooth sub-column scrolling
     */
    draw(screen, font, pal, view = {}) {
      const stride = view.stride || 160, x0 = view.x0 || 0, cols = view.cols || 80;
      const shift = view.shift | 0, rowA = view.rowA || 1, rowB = view.rowB || 16;
      const W = cols * 9;
      if (this.canvas.width !== W) {
        this.canvas.width = W;
        this.img = this.ctx.createImageData(W, 400);
        this.px = new Uint32Array(this.img.data.buffer);
      }
      const px = this.px, colors = this.colors, nLines = pal.length >> 3;
      const maxCol = stride >> 1;
      colors.set(this.base);
      const last = (nLines - 1) * 8;
      for (let y = 0; y < 400; y++) {
        // Entry i is written in the retrace after visible line i, so it shows
        // from line i+1. Line 0 and lines past the table keep the last entry.
        const e = y >= 1 && y <= nLines ? (y - 1) * 8 : last;
        colors[0] = rgba(pal[e + 1], pal[e + 2], pal[e + 3]);
        colors[1] = rgba(pal[e + 5], pal[e + 6], pal[e + 7]);
        const row = y >> 4, line = y & 15;
        const sh = row >= rowA && row < rowB ? shift : 0;
        const rowStart = y * W, rowEnd = rowStart + W;
        let o = y * W - sh;
        for (let c = 0; c <= cols; c++) {
          const col = x0 + c;
          if (c === cols && !sh) break;
          let ch = 0, at = 0;
          if (col < maxCol) { const sidx = row * stride + col * 2; ch = screen[sidx]; at = screen[sidx + 1]; }
          const fg = colors[at & 15], bg = colors[(at >> 4) & 7];
          const bits = font[ch * 16 + line];
          const ninth = ch >= 0xc0 && ch <= 0xdf && (bits & 1);
          for (let b = 0; b < 9; b++, o++) {
            if (o < rowStart || o >= rowEnd) continue;
            const on = b < 8 ? bits & (0x80 >> b) : ninth;
            px[o] = on ? fg : bg;
          }
        }
      }
      this.ctx.putImageData(this.img, 0, 0);
    }
  }

  root.VGAText = VGAText;
  if (typeof module !== "undefined" && module.exports) module.exports = VGAText;
})(typeof window !== "undefined" ? window : globalThis);
