/*
 * app/main.js: the modern version. Same engine and look as the Squid remake,
 * made for today's screens:
 *  - the screen gets wider (more text columns) instead of just bigger, so more of
 *    the message is in view and the letters stop at a readable size (maxScale)
 *  - smooth scrolling: the scroller slides between text columns, so it doesn't
 *    judder on 60 Hz displays (the original assumed a 70 Hz VGA monitor)
 *  - adjustable scroll speed (buttons, arrow keys or - / +), remembered between visits
 *  - sound button (or the M key) turns it on and off
 *  - [label](url) links in the small text lines
 * The credit line to the original authors is always added here.
 */
(function () {
  "use strict";
  const HZ = 28322000 / (900 * 449);   // VGA text-mode refresh, ~70.087 Hz
  const STEP = 1000 / HZ;
  const MAXCOLS = 256;                 // engine screen width; the view shows the right-hand part
  const LINE_ASPECT = 1.35;            // VGA 720x400 shown at 4:3: pixels are 1.35x taller than wide
  // 1x here is a calmer pace than the original: 0.75 of its one column per 70 Hz frame,
  // which reads better on big screens. The faithful remake keeps the original rate.
  const BASE_SPEED = 0.75;
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];   // multiples of BASE_SPEED
  // Original: https://hornet.org/code/demosrc/bbsintro/sqd1_src.zip (SQUID1.COM + source)
  const CREDIT = "based on the Squid BBS intro (1994) by cld & The Doctor";

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const ascii = (t) => Uint8Array.from(String(t), (c) => {
    const n = c.charCodeAt(0);
    return n >= 0x20 && n < 0x7f ? n : 0x3f;   // non-ASCII -> "?"
  });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode etc. */ } },
  };

  const cfg = window.SQUID_CONFIG || {};
  const col = cfg.colors || {};
  // Lines may hold [label](url) links: the label is drawn in linkAttr, and a real
  // <a> is laid over those text cells.
  const linkAttr = (cfg.linkAttr ?? 15) & 15;
  function parseLine(l) {
    const attr = l.attr & 15, links = [];
    let text = "", attrs = [];
    const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let at = 0, m;
    const src = String(l.text);
    while ((m = re.exec(src))) {
      const plain = src.slice(at, m.index);
      text += plain; attrs.push(...Array(plain.length).fill(attr));
      links.push({ start: text.length, label: m[1], url: m[2] });
      text += m[1]; attrs.push(...Array(m[1].length).fill(linkAttr));
      at = re.lastIndex;
    }
    const rest = src.slice(at);
    text += rest; attrs.push(...Array(rest.length).fill(attr));
    return { row: l.row, attr, bytes: ascii(text), attrs: Uint8Array.from(attrs), links };
  }
  const lines = (cfg.lines || []).map(parseLine)
    .concat([parseLine({ row: 23, attr: 3, text: CREDIT })]);
  const custom = {
    glyphs: window.SQUID_GLYPHS,
    scroll: ascii(cfg.scroll || " "),
    lines,
    colors: { bg: col.bg || [0, 1, 1], text: col.text || [0, 1, 1], bars: col.bars || [1, 1, 1] },
    bars: Math.max(1, Math.min(8, cfg.bars | 0 || 4)),
  };
  if (cfg.title) document.title = cfg.title;
  const maxScale = cfg.maxScale > 0 ? cfg.maxScale : 1.5;
  const smooth = cfg.smooth !== false;
  let speed = Number(store.get("intro.speed")) || cfg.speed || 1;

  const com = b64(window.SQUID_ASSETS.com);
  const font = b64(window.SQUID_ASSETS.font);
  const canvas = document.getElementById("screen");
  const crt = document.getElementById("crt");
  const linkLayer = document.getElementById("links");
  const vga = new VGAText(canvas);
  const core = new SquidCore(com, font, { custom, cols: MAXCOLS });

  // --- layout: grow up to maxScale, then add columns instead of growing more
  const view = { stride: MAXCOLS * 2, x0: 0, cols: 80, shift: 0, rowA: 1, rowB: 16 };
  const HUD_SPACE = 44;                // keep the bottom strip free for the controls
  function layout() {
    const W = innerWidth, H = innerHeight - HUD_SPACE, dpr = devicePixelRatio || 1;
    let s = Math.min(H / (400 * LINE_ASPECT), maxScale, W / 720);
    // snap so every text-mode line is a whole number of device pixels (even rows, no banding)
    const lineDev = Math.max(1, Math.floor(LINE_ASPECT * s * dpr));
    s = lineDev / (LINE_ASPECT * dpr);
    const cols = Math.max(80, Math.min(Math.floor(W / (9 * s)), MAXCOLS - 2));
    view.cols = cols;
    view.x0 = MAXCOLS - cols;
    const cw = cols * 9 * s, ch = 400 * LINE_ASPECT * s;
    for (const el of [canvas, crt, linkLayer]) { el.style.width = cw + "px"; el.style.height = ch + "px"; }
    crt.classList.toggle("on", cfg.crt !== false);
    core.writeLines(lines, view.x0, cols);
    placeLinks(s, cols);
    draw();
  }

  function placeLinks(s, cols) {
    linkLayer.textContent = "";
    const cellW = 9 * s, cellH = 16 * LINE_ASPECT * s;
    for (const ln of lines) {
      const left0 = (cols - ln.bytes.length) >> 1;
      for (const k of ln.links) {
        const a = document.createElement("a");
        a.href = k.url;
        a.textContent = k.label;
        if (/^https?:/i.test(k.url)) { a.target = "_blank"; a.rel = "noopener"; }
        Object.assign(a.style, {
          left: (left0 + k.start) * cellW + "px", top: ln.row * cellH + "px",
          width: k.label.length * cellW + "px", height: cellH + "px",
        });
        linkLayer.appendChild(a);
      }
    }
  }
  const draw = () => vga.draw(core.screen, core.vgaFont, core.palTable(), view);

  // --- animation: bars at the original 70 Hz; scroller at `speed`, smoothly
  let last = performance.now(), acc = 0, scrollPos = 0, scrolled = 0;
  function tick(now) {
    const dt = Math.min(now - last, 250);
    last = now;
    acc += dt;
    while (acc >= STEP) { core.initr(); core.sinbar(); acc -= STEP; }
    scrollPos += (dt / STEP) * speed * BASE_SPEED;
    while (scrolled < Math.floor(scrollPos)) { core.scroll(); core.updscr(); scrolled++; }
    view.shift = smooth ? Math.floor((scrollPos - scrolled) * 9) : 0;
    draw();
    requestAnimationFrame(tick);
  }

  // --- controls (bottom right): sound button and speed; dim when idle
  const hud = document.getElementById("hud");
  const soundBtn = document.getElementById("sound");
  const speedOut = document.getElementById("speed");
  const note = document.getElementById("note");
  let hudTimer = 0;
  function showHud(msg) {
    const on = !!(audio && audio.on);
    soundBtn.textContent = on ? "♪ sound on" : "♪ sound off";
    soundBtn.setAttribute("aria-pressed", String(on));
    speedOut.textContent = speed + "×";
    note.textContent = msg || "";
    hud.classList.remove("idle");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.add("idle"), 3000);
  }

  // --- sound: the music runs in its own player, clocked by the audio stream
  let audio = null;
  function startAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const opl = new OPL2(ctx.sampleRate);
    const player = new SquidCore(com, font, { custom, onOpl: (r, v) => opl.write(r, v) });
    const perTick = ctx.sampleRate / HZ;
    let until = 0;
    // ScriptProcessor (not AudioWorklet) so this also works opened from file://
    // (one unused input: Safari is unreliable with zero-input processors)
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const stats = { buffers: 0, peak: 0 };
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      stats.buffers++;
      for (let i = 0; i < out.length;) {
        if (until <= 0) { player.play(); until += perTick; }
        const n = Math.min(out.length - i, Math.ceil(until));
        opl.generate(out, i, n);
        until -= n; i += n;
      }
      for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > stats.peak) stats.peak = v; }
    };
    node.connect(ctx.destination);
    // for troubleshooting from the browser console: introAudio()
    window.introAudio = () => ({ state: ctx.state, rate: ctx.sampleRate, ...stats });
    return { ctx, node, on: false };
  }
  function toggleSound() {
    if (!audio) audio = startAudio();
    if (!audio) return showHud("no audio in this browser");
    audio.on = !audio.on;
    if (audio.on) {
      audio.ctx.resume().then(() => showHud(), () => showHud("sound blocked by the browser"));
    } else audio.ctx.suspend();
    showHud();
  }
  function setSpeed(dir) {
    let i = SPEEDS.findIndex((v) => v >= speed);
    if (i < 0) i = SPEEDS.length - 1;
    i = Math.max(0, Math.min(SPEEDS.length - 1, i + dir));
    speed = SPEEDS[i];
    store.set("intro.speed", String(speed));
    showHud();
  }

  // "click" (not pointerdown): Safari only allows audio to start from a real click or key
  soundBtn.addEventListener("click", toggleSound);
  document.getElementById("slower").addEventListener("click", () => setSpeed(-1));
  document.getElementById("faster").addEventListener("click", () => setSpeed(1));
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const k = e.key;
    if (k === "m" || k === "M") toggleSound();
    else if (k === "ArrowLeft" || k === "-" || k === "_") setSpeed(-1);
    else if (k === "ArrowRight" || k === "=" || k === "+") setSpeed(1);
  });
  addEventListener("mousemove", () => { if (hud.classList.contains("idle")) showHud(); });
  addEventListener("resize", layout);

  layout();
  showHud();
  requestAnimationFrame(tick);
})();
