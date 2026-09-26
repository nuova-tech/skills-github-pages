/**
 * AI coaching layer: turns rep metrics and form faults into spoken + on-screen
 * cues, with throttling so the coach is helpful rather than nagging. Voice uses
 * the Web Speech API when available and degrades silently to text only.
 * @module coach/coach
 */

import { createLogger } from '../core/logger.js';

const log = createLogger('coach');

export class Coach {
  /** @param {{voice?:boolean}} [opts] */
  constructor(opts = {}) {
    this.voiceEnabled = opts.voice ?? true;
    this.cueCooldownMs = 3500;
    /** @type {Map<string, number>} */
    this.lastCueAt = new Map();
    this.supportsSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;
    /** @type {(cue:{text:string, severity:string})=>void} */
    this.onCue = () => {};
  }

  /** @param {boolean} on */
  setVoice(on) { this.voiceEnabled = on; if (!on) this.cancel(); }

  /**
   * Speak/show a cue, throttled per unique key.
   * @param {string} text
   * @param {{key?:string, severity?:'info'|'warn'|'success', force?:boolean}} [opts]
   */
  say(text, opts = {}) {
    const key = opts.key ?? text;
    const now = Date.now();
    if (!opts.force && now - (this.lastCueAt.get(key) ?? 0) < this.cueCooldownMs) return;
    this.lastCueAt.set(key, now);
    this.onCue({ text, severity: opts.severity ?? 'info' });
    if (this.voiceEnabled && this.supportsSpeech) this._speak(text);
  }

  /** Encourage based on a completed rep. @param {import('../exercises/repCounter.js').RepResult} rep @param {number} total */
  onRep(rep, total) {
    if (rep.faults.length) {
      this.say(rep.faults[0], { key: rep.faults[0], severity: 'warn' });
      return;
    }
    if (rep.romPct >= 90) this.say('Great depth!', { key: 'depth-good', severity: 'success' });
    if (total > 0 && total % 10 === 0) this.say(`${total} reps! Keep going.`, { key: 'milestone', severity: 'success', force: true });
  }

  /** @param {string} text */
  _speak(text) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1.0; u.volume = 1.0;
      window.speechSynthesis.speak(u);
    } catch (err) { log.warn('speech failed', err); }
  }

  cancel() { if (this.supportsSpeech) window.speechSynthesis.cancel(); }

  /**
   * Build a structured post-workout summary from session data.
   * @param {import('../workout/session.js').SessionSummary} s
   * @returns {{headline:string, lines:string[]}}
   */
  summarize(s) {
    const lines = [];
    lines.push(`You completed ${s.totalReps} reps across ${s.exercises.length} exercise(s).`);
    if (s.avgFormScore >= 90) lines.push('Outstanding form — clean reps throughout. 🏅');
    else if (s.avgFormScore >= 75) lines.push('Solid form overall, with a little room to tighten up.');
    else lines.push('Focus on form next time — quality beats quantity.');
    const weakest = [...s.exercises].sort((a, b) => a.avgRom - b.avgRom)[0];
    if (weakest && weakest.avgRom < 70) lines.push(`Work on full range of motion in ${weakest.name}.`);
    if (s.avgSymmetry < 85) lines.push('Your left/right balance was uneven — train both sides equally.');
    lines.push(`Estimated ${Math.round(s.calories)} kcal burned in ${formatDur(s.durationMs)}.`);
    const headline = s.avgFormScore >= 85 ? 'Excellent session! 🔥' : 'Nice work — session complete.';
    return { headline, lines };
  }
}

/** @param {number} ms */
function formatDur(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
