/**
 * Juice: confetti bursts, synthesized sound effects (WebAudio, no asset files),
 * and haptic feedback. All effects are guarded so they no-op gracefully when a
 * capability is missing or disabled in settings.
 * @module ui/celebrate
 */

/** @type {AudioContext|null} */
let audioCtx = null;
function ctx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

/** @param {number} freq @param {number} dur @param {OscillatorType} type @param {number} when */
function tone(freq, dur, type = 'sine', when = 0) {
  const ac = ctx(); if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type; osc.frequency.value = freq;
  osc.connect(gain); gain.connect(ac.destination);
  const t0 = ac.currentTime + when;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

export const sound = {
  enabled: true,
  rep() { if (this.enabled) tone(660, 0.08, 'triangle'); },
  fault() { if (this.enabled) tone(180, 0.15, 'sawtooth'); },
  levelUp() { if (this.enabled) { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.1)); } },
  achievement() { if (this.enabled) { [659, 880].forEach((f, i) => tone(f, 0.2, 'sine', i * 0.12)); } },
  finish() { if (this.enabled) { [392, 523, 659].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.12)); } },
};

/** @param {number|number[]} pattern */
export function haptic(pattern, enabled = true) {
  if (enabled && typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

/**
 * Confetti burst rendered on a transient full-screen canvas.
 * @param {{count?:number, duration?:number}} [opts]
 */
export function confetti(opts = {}) {
  if (typeof document === 'undefined') return;
  const count = opts.count ?? 140;
  const duration = opts.duration ?? 2200;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.width = innerWidth; canvas.height = innerHeight;
  document.body.appendChild(canvas);
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const colors = ['#ff6a00', '#ff9d3c', '#ffc93c', '#35b8ff', '#c7ff3c'];
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight / 2,
    vx: (Math.random() - 0.5) * 14,
    vy: Math.random() * -16 - 4,
    size: Math.random() * 7 + 3,
    color: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
  }));
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    c.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.4; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      c.fillStyle = p.color; c.globalAlpha = Math.max(0, 1 - t / duration);
      c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      c.restore();
    }
    if (t < duration) requestAnimationFrame(frame); else canvas.remove();
  }
  requestAnimationFrame(frame);
}
