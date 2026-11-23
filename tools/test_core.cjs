// Compare the JS port (src/squid-core.js) against the reference trace
// recorded from the real SQUID1.COM by tools/squid_ref.py.
// usage: node tools/test_core.cjs <squid_ref.json>
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SquidCore = require("../src/squid-core.js");

const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const root = path.join(__dirname, "..");
const com = fs.readFileSync(path.join(root, "assets/SQUID1.COM"));
const font = fs.readFileSync(path.join(root, "assets/vga8x16.bin"));

const opl = [];
let tag = -1;
const core = new SquidCore(new Uint8Array(com), new Uint8Array(font), {
  onOpl: (r, v) => opl.push([tag, r, v]),
});
const A = SquidCore.ADDR;
const sha = (b) => crypto.createHash("sha1").update(b).digest("hex").slice(0, 16);
let fails = 0;
const check = (name, ok, extra = "") => {
  if (!ok) fails++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? "ok  " : "FAIL"} ${name} ${extra}`);
};

const hexEq = (name, buf, hex) => {
  const got = Buffer.from(buf).toString("hex");
  let i = 0;
  while (i < got.length && got[i] === hex[i]) i++;
  check(name, got === hex, got === hex ? "" : `first diff at byte ${i >> 1}`);
};
hexEq("extended table", core.mem.subarray(A.EXTENDED, A.EXTENDED + 0x8000), ref.snaps.init.extended);
hexEq("fontbuffer", core.mem.subarray(A.FONTBUFFER, A.FONTBUFFER + 4096), ref.snaps.init.fontbuffer);
const up = ref.upload;
hexEq("VGA font upload", core.vgaFont.subarray(up.first * 16, (up.first + up.count) * 16), up.hex);

const N = ref.frames.length;
let firstBad = -1;
for (let f = 0; f < N; f++) {
  const [s, p] = ref.frames[f];
  if (sha(core.screen) !== s || sha(core.palTable()) !== p) {
    if (firstBad < 0) firstBad = f;
  }
  if (ref.snaps[f] && process.env.VERBOSE) console.log("snapshot frame", f);
  tag = f;
  core.frame();
}
check(`screen+palette for ${N} frames`, firstBad < 0, firstBad >= 0 ? `first mismatch at frame ${firstBad}` : "");

const refOpl = ref.opl.filter((e) => e[0] < N - 1);
const ours = opl.filter((e) => e[0] < N - 1);
let k = 0;
while (k < refOpl.length && k < ours.length && refOpl[k].join() === ours[k].join()) k++;
check(`AdLib writes (${refOpl.length})`, k === refOpl.length && ours.length === refOpl.length,
  `ref=${refOpl.length} got=${ours.length}` + (k < refOpl.length ? ` diverge at #${k}: ref ${refOpl[k]} got ${ours[k]}` : ""));

console.log(fails ? `${fails} check(s) failed` : `all checks passed (${N} frames)`);
process.exit(fails ? 1 : 0);
