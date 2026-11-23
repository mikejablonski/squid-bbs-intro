# squid-bbs-intro

A BBS-style intro in plain JavaScript: big hand-drawn letters scrolling over chrome
copper bars, with AdLib FM music. A port of **Squid** (SQUID1.COM, 1994) by
**cld & The Doctor**, rebuilt from scratch and then reworked for modern screens.

No emulator and no dependencies. The program logic, the VGA text-mode renderer and the
Yamaha OPL2 synth are all written in JS, and each page builds to a single HTML file
that runs from disk or any web host.

## What's here

| Folder | What |
|---|---|
| `app/` | **The modern version**: `config.js` (text, links, colours, options), `main.js`, `template.html`, `glyphs.js` |
| `faithful/` | A faithful remake of SQUID1.COM, checked frame by frame against the original |
| `src/squid-core.js` | The program logic: font setup, The Doctor's smoother, scroller, copper palette table, sine bars, the AdLib mini-player |
| `src/opl2.js` | Small YM3812 (OPL2) FM synth: Yamaha log-sin/exp tables, 4 waveforms, envelopes, KSL, feedback |
| `src/vga-text.js` | 720×400 VGA text-mode renderer: 9×16 cells, per-scanline palette changes |
| `assets/` | `SQUID1.COM`, the original program, and the VGA 8×16 ROM font. Both are embedded in each built page; at startup the program is loaded into a 64 KB memory image, and the engine reads its letters, sine table, instruments and tune from there |
| `tools/` | Build script, plus the tools that check the port against the real program |

## Build

```
python3 tools/build.py
```

This writes `dist/index.html` (the modern version) and `dist/faithful.html`. Open either one
in a browser. Press the sound button or **M** for sound. In the modern version, **−/+** or the
arrow keys change the scroll speed.

To make it say something else, edit `app/config.js` and rebuild. To keep your own
text outside this repo (for example in your website's repo), point the build at it:

```
python3 tools/build.py --config path/to/config.js --out path/to/index.html
```

## The modern version vs. the original

- **Wider, not just bigger**: the screen grows with the window up to a readable size
  (`maxScale`), then gains text columns instead. The engine runs a 256-column screen
  and shows the part that fits.
- **Smooth scrolling**: the scroller slides between text columns. The original stepped
  one column per 70 Hz frame, which judders on 60 Hz displays.
- **Calmer, adjustable speed**: 1× is 0.75 of the original's scroll rate, which reads
  better on big screens; viewers can go from 0.25× to 3×. Only the scroller changes,
  while the bars and music keep the original timing. The viewer's choice is remembered.
  (The faithful remake runs at the original rate.)
- **All 26 letters**: G, J, N and X were drawn by the authors but commented out to save
  bytes. They're restored here.
- **Links** in the small text lines (`[label](url)`), drawn as text and clickable.
- **Colours and bar count** are configurable. The page snaps its size to whole device
  pixels and adds a soft vignette.

## How the port was checked

- `tools/squid_ref.py` runs the real SQUID1.COM in a sandboxed x86 CPU emulator (Unicorn)
  with just enough PC hardware, and records every frame's text screen, palette table
  and every AdLib register write.
- `node tools/test_core.cjs trace.json` replays `src/squid-core.js` against it. The font
  setup, 3,001 frames of screen and palette, and all 3,074 AdLib writes match exactly.
- `node tools/render_wav.cjs out.wav` renders the music through `opl2.js` for listening
  comparisons.

```
pip install unicorn
python3 tools/squid_ref.py assets/SQUID1.COM assets/vga8x16.bin trace.json
node tools/test_core.cjs trace.json
```

## Credits

- **Squid BBS intro** (1994, Curitiba, Brazil): code & muzak by **cld**, AdLib player by
  **The Doctor**. Released as freeware with its source:
  https://hornet.org/code/demosrc/bbsintro/sqd1_src.zip
  This project is a new implementation in JS with its own renderer, synth and
  features.
- VGA 8×16 font: the IBM VGA ROM font, dumped from DOSBox-X's copy.

## Licence

The code in this repo is MIT licensed (see `LICENSE`). `assets/SQUID1.COM` and anything taken from it
(the glyphs, sine table and tune) remain the work of cld & The Doctor, under their
freeware terms above.
