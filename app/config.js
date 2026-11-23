/*
 * config.js: the part of the modern version you edit. Rebuild with:
 *     python3 tools/build.py
 * Or keep your own copy elsewhere and build with it:
 *     python3 tools/build.py --config path/to/config.js --out path/to/index.html
 *
 * Text is plain ASCII. CAPITALS (A-Z) and 0 use Squid's hand-drawn letters;
 * lowercase, other digits and punctuation use the standard VGA font, as in
 * the original. Anything outside ASCII is shown as "?".
 *
 * The credit line to the original authors is added by the engine (see main.js)
 * and is not part of this file, so it stays even when every message changes.
 */
window.SQUID_CONFIG = {
  title: "Squid BBS intro",            // browser tab title

  // Big scroller: loops forever. Extra spaces make longer pauses.
  scroll:
    "SQUID BBS INTRO - MODERN VERSION    " +
    "A PORT OF THE 1994 INTRO TO PLAIN JAVASCRIPT - NO EMULATOR - " +
    "THE MUSIC COMES FROM A YAMAHA OPL2 FM CHIP REBUILT IN SOFTWARE    " +
    "ALL 26 LETTERS - SMOOTH SCROLLING - WIDE SCREENS    " +
    "EDIT APP/CONFIG.JS TO MAKE IT SAY ANYTHING YOU WANT    " +
    "GREETS TO CLD AND THE DOCTOR FOR THE CODE AND THE MUZAK    ",

  // Small text lines under the scroller, centred. attr = VGA colour 0-15
  // (11 light cyan and 3 cyan are the original's; 15 white, 7 grey, 8 dark grey).
  // Links: write [label](url) and the label becomes clickable, drawn in linkAttr.
  lines: [
    { row: 20, attr: 11, text: "YOUR BBS NAME HERE  -  555-0199  -  24 HOURS" },
    { row: 21, attr: 3,  text: "Edit app/config.js  -  [original Squid source](https://hornet.org/code/demosrc/bbsintro/sqd1_src.zip)" },
  ],
  linkAttr: 15,                        // colour for link text (15 = bright white)

  // Colours as RGB weights 0-1, applied to the original's brightness ramps.
  // The original is bg [0, 1, 1] (cyan fading to black), bars [1, 1, 1] (white).
  colors: {
    bg:   [0, 1, 1],                   // the band behind the scroller
    text: [0, 1, 1],                   // the scroller letters (black fading to cyan)
    bars: [1, 1, 1],                   // the chrome sine bars
  },
  bars: 4,                             // number of sine bars (original: 4)

  // Modern-screen options
  speed: 1,          // scroll speed, 1 = default (0.75x the original's rate). Viewers change it with the - / +
                     // buttons or arrow keys (their choice is remembered in their browser).
  smooth: true,      // slide smoothly between text columns (false = original column steps)
  maxScale: 1.5,     // how big it may get: 1 = original VGA size, 2 = double. On wider
                     // windows the screen gains columns instead of growing past this.
  crt: true,         // soft dark vignette at the edges, like a tube monitor
};
