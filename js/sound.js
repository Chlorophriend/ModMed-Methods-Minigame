// Original sound effects, synthesized live with the Web Audio API (no audio files to upload).
// Browsers only allow sound after the first tap or click, so unlock() runs on the first pointer/key event.

const KEY = 'itd-sound';
let ctx = null;
let master = null;
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch {}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlock() { if (enabled) ac(); }
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

// One note: oscillator with a quick attack and exponential decay, optional pitch glide.
function note({ freq = 440, to = null, at = 0, dur = 0.2, type = 'sine', vol = 0.2, attack = 0.008 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Filtered noise burst (bubbles, whooshes, ticks).
function noise({ at = 0, dur = 0.25, from = 800, to = 3000, q = 1.2, vol = 0.12, type = 'bandpass' }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// Pentatonic-ish scale used for tier jingles: deeper tiers get more notes and a lower, richer ending.
const TIER_NOTES = [
  [659, 784],                 // Schooler: short and bright
  [523, 659, 784],            // Rare
  [392, 494, 587, 784],       // Deep Cut
  [262, 330, 392, 523, 659],  // One in a krillion: long descent-and-rise flourish
];

const SOUNDS = {
  // phone
  join: () => { note({ freq: 520, to: 780, dur: 0.12, vol: 0.15 }); note({ freq: 780, to: 1040, at: 0.09, dur: 0.14, vol: 0.12 }); },
  ping: () => { note({ freq: 880, dur: 0.5, vol: 0.18 }); note({ freq: 880, dur: 0.6, at: 0.22, vol: 0.06 }); },
  tick: () => note({ freq: 1250, dur: 0.05, type: 'square', vol: 0.05 }),
  wrong: () => { note({ freq: 330, dur: 0.12, type: 'triangle', vol: 0.18 }); note({ freq: 247, dur: 0.22, at: 0.11, type: 'triangle', vol: 0.18 }); },
  blip: () => note({ freq: 660, to: 990, dur: 0.12, vol: 0.12 }),
  lock: (tier = 0) => {
    noise({ dur: 0.35, from: 400, to: 1800, q: 3, vol: 0.1 });            // splash
    note({ freq: 900, to: 260, dur: 0.28, vol: 0.14 });                    // sinking bloop
    TIER_NOTES[Math.max(0, Math.min(3, tier))].forEach((f, i) =>
      note({ freq: f, at: 0.22 + i * 0.09, dur: 0.32, type: i % 2 ? 'triangle' : 'sine', vol: 0.13 }));
  },
  none: () => { note({ freq: 196, to: 98, dur: 0.5, type: 'triangle', vol: 0.2 }); },
  surface: () => [392, 523, 659, 784].forEach((f, i) => note({ freq: f, at: i * 0.08, dur: 0.3, vol: 0.12 })),
  // big screen
  pop: () => { note({ freq: 600, to: 1200, dur: 0.09, vol: 0.12 }); noise({ dur: 0.08, from: 2000, to: 4000, vol: 0.05 }); },
  start: () => { note({ freq: 196, dur: 1.2, vol: 0.16 }); note({ freq: 294, dur: 1.2, at: 0.02, vol: 0.1 }); note({ freq: 392, dur: 1.4, at: 0.12, vol: 0.08 }); noise({ dur: 0.9, from: 300, to: 120, type: 'lowpass', q: 0.7, vol: 0.08 }); },
  bubble: (tier = 0) => note({ freq: [1100, 900, 700, 520][Math.max(0, Math.min(3, tier))], to: 300, dur: 0.16, vol: 0.09 }),
  whoosh: (tier = 0) => { noise({ dur: 0.4, from: 3000 - tier * 600, to: 500 - tier * 80, q: 1.5, vol: 0.08 }); note({ freq: TIER_NOTES[tier][0], at: 0.12, dur: 0.35, vol: 0.08 }); },
  fanfare: () => {
    [523, 659, 784, 1047].forEach((f, i) => note({ freq: f, at: i * 0.12, dur: 0.35, type: 'triangle', vol: 0.14 }));
    [523, 659, 784].forEach(f => note({ freq: f, at: 0.55, dur: 1.2, vol: 0.08 }));
  },
};

export function play(name, arg) {
  if (!enabled || !SOUNDS[name]) return;
  try { SOUNDS[name](arg); } catch {}
}

export const isOn = () => enabled;

export function setOn(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch {}
  if (enabled) { ac(); play('blip'); }
}

// A small toggle button; call bindSoundButton() after it is in the page.
export const soundButtonHTML = () =>
  `<button type="button" class="btn sound-btn" id="sound-btn" aria-pressed="${enabled}">${enabled ? '♪ Sound on' : '♪ Sound off'}</button>`;

export function bindSoundButton() {
  const b = document.getElementById('sound-btn');
  if (!b) return;
  b.addEventListener('click', () => {
    setOn(!enabled);
    b.setAttribute('aria-pressed', String(enabled));
    b.textContent = enabled ? '♪ Sound on' : '♪ Sound off';
  });
}
