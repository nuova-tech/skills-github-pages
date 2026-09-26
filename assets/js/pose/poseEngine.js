/**
 * Real-time pose estimation pipeline built on MediaPipe Pose.
 *
 * Responsibilities:
 *  - acquire a camera stream (built-in, USB, or phone) via getUserMedia
 *  - run MediaPipe Pose per frame and apply One Euro smoothing
 *  - measure FPS and a per-frame quality score (visibility + lighting proxy)
 *  - detect when the user leaves the frame and signal auto-pause
 *  - expose a simple calibration routine before a workout starts
 *
 * MediaPipe is loaded from CDN (see index.html). TensorFlow.js is available on
 * `window.tf` for the classification path. Both run fully client-side, which is
 * what makes static GitHub Pages hosting viable.
 * @module pose/poseEngine
 */

import { EventBus } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { LandmarkSmoother } from './smoothing.js';
import { LM, avgVisibility } from './landmarks.js';

const log = createLogger('pose');

/**
 * @typedef {Object} PoseFrame
 * @property {import('./landmarks.js').Landmark[]} landmarks smoothed, normalized
 * @property {import('./landmarks.js').Landmark[]} raw unsmoothed
 * @property {import('./landmarks.js').Landmark[]|undefined} world world landmarks
 * @property {number} fps
 * @property {number} quality 0..1
 * @property {boolean} inFrame
 * @property {number} tMs
 *
 * @typedef {{pose: PoseFrame, status: {state:string, detail?:string}, fps:number}} PoseEvents
 */

const CORE_LANDMARKS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
];

export class PoseEngine {
  constructor() {
    /** @type {EventBus<PoseEvents>} */
    this.bus = new EventBus();
    this.smoother = new LandmarkSmoother({ minCutoff: 1.2, beta: 0.03 });
    /** @type {any} */ this.pose = null;
    /** @type {HTMLVideoElement|null} */ this.video = null;
    /** @type {MediaStream|null} */ this.stream = null;
    this.running = false;
    this.fps = 0;
    this._frameTimes = [];
    this._missingFrames = 0;
    this._inFrame = true;
    this._rafId = 0;
  }

  /** Load and configure the MediaPipe Pose graph. */
  async init() {
    if (this.pose) return;
    if (typeof window === 'undefined' || !('Pose' in window)) {
      throw new Error('MediaPipe Pose not loaded — check network / CDN.');
    }
    // @ts-ignore - global from CDN
    const pose = new window.Pose({
      locateFile: (/** @type {string} */ f) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    pose.onResults((/** @type {any} */ r) => this._onResults(r));
    this.pose = pose;
    log.info('MediaPipe Pose initialised');
  }

  /** List available video input devices for a camera picker. */
  async listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput');
    } catch (err) { log.warn('enumerateDevices failed', err); return []; }
  }

  /**
   * Start the camera + processing loop.
   * @param {HTMLVideoElement} videoEl
   * @param {{deviceId?:string, facingMode?:string}} [opts]
   */
  async start(videoEl, opts = {}) {
    await this.init();
    this.video = videoEl;
    this.bus.emit('status', { state: 'requesting-camera' });
    const constraints = {
      audio: false,
      video: opts.deviceId
        ? { deviceId: { exact: opts.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: opts.facingMode ?? 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = this.stream;
    await videoEl.play();
    this.running = true;
    this.smoother.reset();
    this.bus.emit('status', { state: 'running' });
    log.info('camera started', { w: videoEl.videoWidth, h: videoEl.videoHeight });
    this._loop();
  }

  async _loop() {
    if (!this.running || !this.video || !this.pose) return;
    try {
      if (this.video.readyState >= 2) {
        await this.pose.send({ image: this.video });
      }
    } catch (err) {
      log.error('pose.send failed', err);
    }
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  /** @param {any} results */
  _onResults(results) {
    const tMs = performance.now();
    this._trackFps(tMs);

    const raw = results.poseLandmarks;
    if (!raw) {
      this._missingFrames++;
      if (this._inFrame && this._missingFrames > 8) {
        this._inFrame = false;
        this.bus.emit('status', { state: 'no-user', detail: 'Step into frame to resume' });
      }
      return;
    }
    this._missingFrames = 0;

    const quality = this._quality(raw);
    const inFrame = this._isInFrame(raw) && quality > 0.25;
    if (inFrame && !this._inFrame) {
      this.bus.emit('status', { state: 'running' });
    }
    this._inFrame = inFrame;

    const landmarks = this.smoother.smooth(raw, tMs);
    /** @type {PoseFrame} */
    const frame = {
      landmarks, raw,
      world: results.poseWorldLandmarks,
      fps: this.fps, quality, inFrame, tMs,
    };
    this.bus.emit('pose', frame);
  }

  /** Visibility-weighted quality proxy. @param {import('./landmarks.js').Landmark[]} lm */
  _quality(lm) {
    return avgVisibility(lm, CORE_LANDMARKS);
  }

  /** True when the torso landmarks sit within the frame margins. @param {import('./landmarks.js').Landmark[]} lm */
  _isInFrame(lm) {
    const pts = CORE_LANDMARKS.map((i) => lm[i]).filter(Boolean);
    if (pts.length < 4) return false;
    const m = 0.02;
    const inside = pts.filter((p) => p.x > m && p.x < 1 - m && p.y > m && p.y < 1 - m && p.visibility > 0.4);
    return inside.length >= 4;
  }

  /** @param {number} tMs */
  _trackFps(tMs) {
    this._frameTimes.push(tMs);
    while (this._frameTimes.length > 30) this._frameTimes.shift();
    if (this._frameTimes.length >= 2) {
      const span = this._frameTimes[this._frameTimes.length - 1] - this._frameTimes[0];
      this.fps = span > 0 ? Math.round(((this._frameTimes.length - 1) / span) * 1000) : 0;
      this.bus.emit('fps', this.fps);
    }
  }

  /**
   * Sample frames to confirm the user is fully framed & lit before starting.
   * Resolves with a calibration report once stable, or after a timeout.
   * @param {{frames?:number, timeoutMs?:number}} [opts]
   * @returns {Promise<{ok:boolean, quality:number, message:string}>}
   */
  calibrate(opts = {}) {
    const need = opts.frames ?? 20;
    const timeout = opts.timeoutMs ?? 8000;
    return new Promise((resolve) => {
      let good = 0; let qSum = 0; let n = 0;
      const off = this.bus.on('pose', (f) => {
        n++; qSum += f.quality;
        if (f.inFrame && f.quality > 0.6) good++; else good = Math.max(0, good - 1);
        if (good >= need) {
          off(); clearTimeout(timer);
          resolve({ ok: true, quality: qSum / n, message: 'Calibrated — you are centered and visible.' });
        }
      });
      const timer = setTimeout(() => {
        off();
        const q = n ? qSum / n : 0;
        resolve({ ok: q > 0.45, quality: q, message: q > 0.45
          ? 'Calibrated with reduced confidence — improve lighting if possible.'
          : 'Could not get a clear view. Step back and improve lighting.' });
      }, timeout);
    });
  }

  pause() { this.running = false; cancelAnimationFrame(this._rafId); }
  resume() { if (!this.running) { this.running = true; this._loop(); } }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._rafId);
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.video) this.video.srcObject = null;
    this.bus.emit('status', { state: 'stopped' });
  }
}
