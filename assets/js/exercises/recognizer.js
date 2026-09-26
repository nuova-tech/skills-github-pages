/**
 * Heuristic "smart" exercise recognition. Rather than a heavyweight classifier,
 * we score candidate exercises from coarse pose features (orientation, which
 * joints are moving, vertical vs lateral motion). This runs continuously and is
 * good enough to auto-select the movement in free-workout mode; it degrades
 * gracefully and simply suggests rather than forcing a switch.
 *
 * A TensorFlow.js sequence model could be dropped in behind the same interface
 * (`feed(landmarks)` → `best()`), which is why the feature extraction is kept
 * separate from the scoring.
 * @module exercises/recognizer
 */

import { LM, angleDeg, segmentAngleDeg, mid } from '../pose/landmarks.js';

const WINDOW = 45; // ~1.5s at 30fps

export class ExerciseRecognizer {
  constructor() {
    /** @type {number[]} */ this.kneeHist = [];
    /** @type {number[]} */ this.elbowHist = [];
    /** @type {number[]} */ this.wristYHist = [];
    /** @type {number[]} */ this.tiltHist = [];
  }

  /** @param {import('../pose/landmarks.js').Landmark[]} lm */
  feed(lm) {
    const knee = (angleDeg(lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE])
      + angleDeg(lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE])) / 2;
    const elbow = (angleDeg(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_ELBOW], lm[LM.LEFT_WRIST])
      + angleDeg(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_ELBOW], lm[LM.RIGHT_WRIST])) / 2;
    const wristY = (lm[LM.LEFT_WRIST].y + lm[LM.RIGHT_WRIST].y) / 2;
    const tilt = Math.abs(segmentAngleDeg(
      mid(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]),
      mid(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP])) + 90);
    push(this.kneeHist, knee); push(this.elbowHist, elbow);
    push(this.wristYHist, wristY); push(this.tiltHist, tilt);
  }

  /** @returns {{id:string, confidence:number}|null} */
  best() {
    if (this.kneeHist.length < WINDOW * 0.6) return null;
    const kneeRange = range(this.kneeHist);
    const elbowRange = range(this.elbowHist);
    const wristRange = range(this.wristYHist) * 100;
    const avgTilt = avg(this.tiltHist);
    const horizontal = avgTilt > 50; // body roughly horizontal (push-up/plank)

    /** @type {Array<[string, number]>} */
    const scores = [];
    if (horizontal) {
      scores.push(['pushup', elbowRange * 1.5]);
      scores.push(['plank', 30 - Math.min(30, elbowRange + kneeRange)]);
    } else {
      scores.push(['squat', kneeRange * 1.2 - elbowRange * 0.3]);
      scores.push(['jumpingjack', wristRange * 1.4 - kneeRange * 0.2]);
      scores.push(['lunge', kneeRange * 0.9]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    const [id, raw] = scores[0];
    const confidence = Math.max(0, Math.min(1, raw / 60));
    return confidence > 0.35 ? { id, confidence } : null;
  }

  reset() { this.kneeHist = []; this.elbowHist = []; this.wristYHist = []; this.tiltHist = []; }
}

/** @param {number[]} arr @param {number} v */
function push(arr, v) { arr.push(v); if (arr.length > WINDOW) arr.shift(); }
/** @param {number[]} a */
function range(a) { return a.length ? Math.max(...a) - Math.min(...a) : 0; }
/** @param {number[]} a */
function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
