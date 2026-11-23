"""Inline the JS and assets into self-contained HTML pages.

Each page is a single file that works opened straight from disk (file://) or
from any web host.
usage: python3 tools/build.py
  -> dist/index.html     modern version: app/ (edit app/config.js)
  -> dist/faithful.html  faithful remake of SQUID1.COM: faithful/

Build the modern version with your own config kept outside this repo:
  python3 tools/build.py --config my/config.js --out my/site/index.html
(only that one page is built when --config or --out is given)
"""
import argparse, base64, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda *p: os.path.join(ROOT, *p)
read = lambda p: open(p if os.path.isabs(p) else R(p), encoding="utf-8").read()
b64 = lambda p: base64.b64encode(open(R(p), "rb").read()).decode()


def build(out, template, parts):
    html = read(template)
    common = {
        "%%COM%%": b64("assets/SQUID1.COM"),
        "%%FONT%%": b64("assets/vga8x16.bin"),
        "%%OPL2%%": read("src/opl2.js"),
        "%%CORE%%": read("src/squid-core.js"),
        "%%VGA%%": read("src/vga-text.js"),
    }
    for key, val in {**common, **parts}.items():
        assert key in html, key
        html = html.replace(key, val)
    path = out if os.path.isabs(out) else R(out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(html)
    print(f"{out}: {len(html.encode())} bytes")


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--config", help="config.js to use instead of app/config.js")
ap.add_argument("--out", help="output file for the modern version (default dist/index.html)")
args = ap.parse_args()
abspath = lambda p: os.path.abspath(p) if p else None

build(abspath(args.out) or "dist/index.html", "app/template.html", {
    "%%GLYPHS%%": read("app/glyphs.js"),
    "%%CONFIG%%": read(abspath(args.config) or "app/config.js"),
    "%%MAIN%%": read("app/main.js"),
})
if not (args.config or args.out):
    build("dist/faithful.html", "faithful/template.html", {"%%MAIN%%": read("faithful/main.js")})
