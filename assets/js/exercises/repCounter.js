/**
 * Generic rep-counting state machine driven by an {@link ExerciseDef}.
 *
 * It supports two strategies:
 *  1. Fixed hysteresis thresholds (`down`/`up`) — the common case.
 *  2. Adaptive peak detection when thresholds are sentinels (`-1000`) — used for
 *     small-amplitude movements like calf raises where the absolute scale is
 *     unknown and we track relative oscillation around a rolling baseline.
 *
 * For every completed rep it emits rich metrics: range of motion %, concentric/
 * eccentric tempo, time under tension, left/right symmetry, depth peak, and a
 * form score aggregated from the exercise's form checks.
 * @module exercises/repCounter
 */

import { createLogger } from '../core/logger.js';

const log = createLogger('reps');

/**
 * @typedef {import('./registry.js').ExerciseDef} ExerciseDef
 * @typedef {import('../pose/landmarks.js').Landmark} Landmark
 * @typedef {Object} RepResult
 * @property {number} index 1-based rep number
 * @property {number} romPct 0..100 range of motion achieved
 * @property {number} peak metric value at the bottom of the rep
 * @property {number} concentricMs time of the lifting/return phase
 * @property {number} eccentricMs time of the lowering/active phase
 * @property {number} tutMs total time under tension for the rep
 * @property {number} symmetryPct 100 = perfectly even left/right
 * @property {number} formScore 0..100
 * @property {string[]} faults form cues triggered during the rep
 */

export class RepCounter {
  /** @param {ExerciseDef} def */
  constructor(def) {
    this.def = def;
    this.adaptive = def.down === -1000 && def.up === -1000;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.phase = /** @type {'up'|'down'} */ ('up');
    this.repStartT = 0;
    this.downEnterT = 0;
    this.peak = this.def.invert ? -Infinity : Infinity;
    /** @type {{l:number,r:number}} */
    this.peakSides = { l: 0, r: 0 };
    /** @type {Set<string>} */
    this.repFaults = new Set();
    this.formSamples = 0;
    this.formGood = 0;
    // adaptive baseline tracking
    this.rollMin = Infinity;
    this.rollMax = -Infinity;
    this.lastVal = 0;
  }

  /** Whether a metric value counts as "deeper" than the stored peak. @param {number} v */
  _isDeeper(v) {
    return this.def.invert ? v > this.peak : v < this.peak;
  }

  /**
   * Feed one frame. Returns a RepResult when a rep completes, else null.
   * @param {Landmark[]} lm
   * @param {number} tMs
   * @returns {RepResult|null}
   */
  update(lm, tMs) {
    if (!this.def.metric) return null;
    const v = this.def.metric(lm);
    this.lastVal = v;

    // Aggregate live form quality for the in-progress rep.
    if (this.def.formChecks?.length) {
      for (const fc of this.def.formChecks) {
        const r = fc.test(lm);
        this.formSamples++;
        if (r.ok) this.formGood++; else this.repFaults.add(r.cue);
      }
    }

    let down, up;
    if (this.adaptive) {
      // Maintain a decaying rolling range and derive thresholds from it.
      this.rollMin = Math.min(this.rollMin * 1.0005, v);
      this.rollMax = Math.max(this.rollMax * 0.9995, v);
      const range = this.rollMax - this.rollMin;
      if (range < 1.0) return null; // not enough signal yet
      down = this.rollMax - range * 0.35;
      up = this.rollMin + range * 0.35;
    } else {
      down = this.def.down ?? 0;
      up = this.def.up ?? 0;
    }

    const enteringDown = this.def.invert ? v >= down : v <= down;
    const enteringUp = this.def.invert ? v <= up : v >= up;

    if (this.phase === 'up' && enteringDown) {
      this.phase = 'down';
      this.downEnterT = tMs;
      if (!this.repStartT) this.repStartT = tMs;
      this.peak = v;
      this._capturePeakSides(lm);
    } else if (this.phase === 'down') {
      if (this._isDeeper(v)) { this.peak = v; this._capturePeakSides(lm); }
      if (enteringUp) {
        const result = this._completeRep(tMs);
        this.phase = 'up';
        this.repStartT = tMs;
        this.peak = this.def.invert ? -Infinity : Infinity;
        this.repFaults = new Set();
        this.formSamples = 0; this.formGood = 0;
        return result;
      }
    }
    return null;
  }

  /** @param {Landmark[]} lm */
  _capturePeakSides(lm) {
    if (this.def.left && this.def.right) {
      this.peakSides = { l: this.def.left(lm), r: this.def.right(lm) };
    }
  }

  /** @param {number} tMs @returns {RepResult} */
  _completeRep(tMs) {
    this.count++;
    const [worst, best] = this.def.romRange ?? [0, 1];
    let romPct = ((this.peak - worst) / (best - worst)) * 100;
    romPct = Math.max(0, Math.min(100, romPct));

    const eccentricMs = this.downEnterT - this.repStartT > 0 ? this.downEnterT - this.repStartT : 0;
    const concentricMs = tMs - this.downEnterT;
    const tutMs = tMs - this.repStartT;

    let symmetryPct = 100;
    if (this.def.left && this.def.right) {
      const { l, r } = this.peakSides;
      const denom = Math.max(Math.abs(l), Math.abs(r), 1);
      symmetryPct = Math.max(0, 100 - (Math.abs(l - r) / denom) * 100);
    }

    const formScore = this.formSamples
      ? Math.round((this.formGood / this.formSamples) * 100)
      : 100;

    const result = {
      index: this.count,
      romPct: Math.round(romPct),
      peak: Math.round(this.peak * 10) / 10,
      concentricMs: Math.round(concentricMs),
      eccentricMs: Math.round(eccentricMs),
      tutMs: Math.round(tutMs),
      symmetryPct: Math.round(symmetryPct),
      formScore,
      faults: [...this.repFaults],
    };
    log.debug(`rep ${this.count}`, result);
    return result;
  }
}
