/*
 * main.js — runs the Squid remake in the page: visuals on requestAnimationFrame
 * at the VGA text-mode refresh rate (70.087 Hz), music in its own player
 * instance clocked by the audio stream so note timing is sample-accurate.
 */
(function () {
  "use strict";
  const HZ = 28322000 / (900 * 449);   // VGA 720x400 text mode: ~70.087 Hz
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const com = b64(window.SQUID_ASSETS.com);
  const font = b64(window.SQUID_ASSETS.font);

  const canvas = document.getElementById("screen");
  const vga = new VGAText(canvas);
  const core = new SquidCore(com, font);
  const draw = () => vga.draw(core.screen, core.vgaFont, core.palTable());

  // --- visuals: fixed-step simulation, draw the latest state each display frame
  const STEP = 1000 / HZ;
  let last = performance.now(), acc = 0;
  draw();
  function tick(now) {
    acc += Math.min(now - last, 250);
    last = now;
    let stepped = false;
    while (acc >= STEP) { core.frame(); acc -= STEP; stepped = true; }
    if (stepped) draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // --- audio: browsers only allow sound after a click or key press
  const hint = document.getElementById("hint");
  let audio = null;
  function startAudio() {
    if (audio) { if (audio.ctx.state === "suspended") audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const opl = new OPL2(ctx.sampleRate);
    const player = new SquidCore(com, font, { onOpl: (r, v) => opl.write(r, v) });
    const perTick = ctx.sampleRate / HZ;
    let until = 0;
    // ScriptProcessor (not AudioWorklet) so this also works opened from file://
    const node = ctx.createScriptProcessor(2048, 0, 1);
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length;) {
        if (until <= 0) { player.play(); until += perTick; }
        const n = Math.min(out.length - i, Math.ceil(until));
        opl.generate(out, i, n);
        until -= n; i += n;
      }
    };
    node.connect(ctx.destination);
    ctx.resume();
    audio = { ctx, node };
    hint.classList.add("gone");
  }
  addEventListener("pointerdown", startAudio);
  addEventListener("keydown", startAudio);
})();
