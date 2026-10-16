// 极简音效（WebAudio，无音频文件），支持静音
let ctx = null;
let muted = false;
function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function blip(freq, dur, type = 'sine', gain = 0.12) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}
export const sfx = {
  resume() { ac(); },
  setMuted(m) { muted = !!m; },
  isMuted() { return muted; },
  hit() { blip(220, 0.06, 'square', 0.10); },
  pot() { blip(660, 0.12, 'triangle', 0.14); },
  rail() { blip(140, 0.04, 'sine', 0.06); },
  win() { blip(880, 0.3, 'triangle', 0.16); },
};
