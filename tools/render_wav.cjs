// Render N seconds of the Squid music through opl2.js to a 16-bit mono WAV.
// usage: node tools/render_wav.cjs out.wav [seconds]
const fs = require("fs"), path = require("path");
const SquidCore = require("../src/squid-core.js");
const OPL2 = require("../src/opl2.js");
const root = path.join(__dirname, "..");
const sr = 48000, secs = +(process.argv[3] || 20);
const opl = new OPL2(sr);
const core = new SquidCore(new Uint8Array(fs.readFileSync(path.join(root, "assets/SQUID1.COM"))),
  new Uint8Array(fs.readFileSync(path.join(root, "assets/vga8x16.bin"))), { onOpl: (r, v) => opl.write(r, v) });
const N = sr * secs, buf = new Float32Array(N), spt = sr / 70.087;
let acc = 0, peak = 0, sumsq = 0;
for (let i = 0; i < N; i += 1) {
  if (acc <= 0) { core.play(); acc += spt; }
  opl.generate(buf, i, 1); acc -= 1;
  peak = Math.max(peak, Math.abs(buf[i])); sumsq += buf[i] * buf[i];
}
const out = Buffer.alloc(44 + N * 2);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 2, 4); out.write("WAVEfmt ", 8);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
out.writeUInt32LE(sr, 24); out.writeUInt32LE(sr * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
out.write("data", 36); out.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
fs.writeFileSync(process.argv[2], out);
console.log(`peak=${peak.toFixed(3)} rms=${Math.sqrt(sumsq / N).toFixed(3)} -> ${process.argv[2]}`);
