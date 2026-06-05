/**
 * One Euro filter for landmark smoothing. It adapts cutoff frequency to motion
 * speed: heavy smoothing when still (kills jitter), light smoothing when moving
 * fast (preserves responsiveness). This is the same family of filter MediaPipe
 * uses internally and is well suited to noisy pose streams.
 * @module pose/smoothing
 */

class LowPass {
  constructor() {
    /** @type {number|null} */ this.y = null;
    /** @type {number} */ this.s = 0;
  }
  /** @param {number} x @param {number} alpha */
  filter(x, alpha) {
    this.s = this.y == null ? x : alpha * x + (1 - alpha) * this.s;
    this.y = x;
    return this.s;
  }
}

class OneEuroScalar {
  /** @param {{minCutoff?:number, beta?:number, dCutoff?:number}} [opts] */
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilt = new LowPass();
    this.dxFilt = new LowPass();
    /** @type {number|null} */ this.lastX = null;
  }
  /** @param {number} cutoff @param {number} dt */
  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  /** @param {number} x @param {number} dt seconds */
  filter(x, dt) {
    if (dt <= 0) dt = 1 / 30;
    const dx = this.lastX == null ? 0 : (x - this.lastX) / dt;
    this.lastX = x;
    const edx = this.dxFilt.filter(dx, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilt.filter(x, this._alpha(cutoff, dt));
  }
}

/**
 * Smooths a full array of 33 landmarks. x/y/z each get their own One Euro
 * filter; visibility is passed through (it's already a confidence value).
 */
export class LandmarkSmoother {
  /** @param {{minCutoff?:number, beta?:number}} [opts] */
  constructor(opts = {}) {
    this.opts = opts;
    /** @type {OneEuroScalar[][]} */
    this.filters = [];
    this.lastT = 0;
  }

  reset() { this.filters = []; this.lastT = 0; }

  /**
   * @param {import('./landmarks.js').Landmark[]} landmarks
   * @param {number} [tMs] timestamp in ms (defaults to now)
   * @returns {import('./landmarks.js').Landmark[]}
   */
  smooth(landmarks, tMs = performance.now()) {
    const dt = this.lastT ? (tMs - this.lastT) / 1000 : 1 / 30;
    this.lastT = tMs;
    return landmarks.map((lm, i) => {
      let f = this.filters[i];
      if (!f) {
        f = [new OneEuroScalar(this.opts), new OneEuroScalar(this.opts), new OneEuroScalar(this.opts)];
        this.filters[i] = f;
      }
      return {
        x: f[0].filter(lm.x, dt),
        y: f[1].filter(lm.y, dt),
        z: f[2].filter(lm.z, dt),
        visibility: lm.visibility,
      };
    });
  }
}
