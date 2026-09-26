/**
 * Workout session orchestrator. Consumes smoothed pose frames, drives the
 * per-exercise {@link RepCounter} (or a hold timer for isometrics), accumulates
 * professional metrics (active/rest time, calories, power, stability,
 * explosiveness, endurance), and emits events the UI/coach/gamification react
 * to. Supports multiple workout modes via a list of stages.
 * @module workout/session
 */

import { EventBus } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { getExercise } from '../exercises/registry.js';
import { RepCounter } from '../exercises/repCounter.js';

const log = createLogger('session');

/**
 * @typedef {Object} Stage
 * @property {string} exerciseId
 * @property {number} [targetReps]
 * @property {number} [durationMs] for timed / hold stages
 * @property {number} [restMs]
 *
 * @typedef {Object} ExerciseTally
 * @property {string} id
 * @property {string} name
 * @property {number} reps
 * @property {number} avgRom
 * @property {number} avgForm
 * @property {number} bestSymmetry
 * @property {number} holdMs
 *
 * @typedef {Object} SessionSummary
 * @property {number} durationMs
 * @property {number} activeMs
 * @property {number} restMs
 * @property {number} totalReps
 * @property {number} calories
 * @property {number} avgFormScore
 * @property {number} avgSymmetry
 * @property {number} avgRom
 * @property {number} stabilityScore
 * @property {number} explosivenessScore
 * @property {number} enduranceScore
 * @property {number} overallScore
 * @property {string} mode
 * @property {ExerciseTally[]} exercises
 *
 * @typedef {Object} SessionEvents
 * @property {{rep:import('../exercises/repCounter.js').RepResult, exerciseId:string, total:number}} rep
 * @property {{exerciseId:string, holdMs:number, valid:boolean}} hold
 * @property {{stage:Stage, index:number}} stage
 * @property {{tally:ExerciseTally[], metrics:LiveMetrics}} tick
 * @property {SessionSummary} finish
 * @property {{faults:string[], faultJoints:number[]}} form
 *
 * @typedef {Object} LiveMetrics
 * @property {number} reps
 * @property {number} activeMs
 * @property {number} restMs
 * @property {number} calories
 * @property {number} powerW
 * @property {number} stability
 */

const REST_GAP_MS = 2500; // no rep within this window counts as "rest"

export class WorkoutSession {
  /**
   * @param {{mode:string, stages:Stage[], weightKg:number}} cfg
   */
  constructor(cfg) {
    this.mode = cfg.mode;
    this.stages = cfg.stages;
    this.weightKg = cfg.weightKg || 70;
    /** @type {EventBus<SessionEvents>} */
    this.bus = new EventBus();

    this.stageIndex = 0;
    this.startedT = 0;
    this.lastRepT = 0;
    this.activeMs = 0;
    this.restMs = 0;
    this.lastFrameT = 0;

    /** @type {Map<string, ExerciseTally>} */
    this.tallies = new Map();
    /** @type {RepCounter|null} */
    this.counter = null;
    this.holdMs = 0;
    this.holdValid = false;

    // stability: variance of hip position while "resting" between reps
    this._hipSamples = [];
    /** @type {number[]} */ this._romHistory = [];
    /** @type {number[]} */ this._tutHistory = [];
    this.finished = false;
  }

  get currentStage() { return this.stages[this.stageIndex]; }
  get currentExercise() { return getExercise(this.currentStage.exerciseId); }

  start() {
    this.startedT = performance.now();
    this.lastFrameT = this.startedT;
    this._enterStage(0);
    log.info('session started', { mode: this.mode, stages: this.stages.length });
  }

  /** @param {number} i */
  _enterStage(i) {
    this.stageIndex = i;
    const stage = this.stages[i];
    const def = getExercise(stage.exerciseId);
    this.counter = def.kind === 'rep' ? new RepCounter(def) : null;
    this.holdMs = 0;
    if (!this.tallies.has(def.id)) {
      this.tallies.set(def.id, { id: def.id, name: def.name, reps: 0, avgRom: 0, avgForm: 0, bestSymmetry: 0, holdMs: 0 });
    }
    this.bus.emit('stage', { stage, index: i });
  }

  /** Advance to the next stage; finishes the session if none remain. */
  nextStage() {
    if (this.stageIndex + 1 < this.stages.length) this._enterStage(this.stageIndex + 1);
    else this.finish();
  }

  /**
   * Switch the active exercise mid-set (used by free mode + auto-detect).
   * @param {string} exerciseId
   */
  switchExercise(exerciseId) {
    if (this.currentStage.exerciseId === exerciseId) return;
    this.stages[this.stageIndex] = { exerciseId };
    this._enterStage(this.stageIndex);
    log.info('switched exercise', exerciseId);
  }

  /**
   * Feed one pose frame.
   * @param {import('../pose/poseEngine.js').PoseFrame} frame
   */
  onFrame(frame) {
    if (this.finished) return;
    const t = frame.tMs;
    const dt = this.lastFrameT ? t - this.lastFrameT : 0;
    this.lastFrameT = t;
    if (!frame.inFrame) { this.restMs += dt; return; }

    const def = this.currentExercise;
    const tally = this.tallies.get(def.id);
    if (!tally) return;

    // stability sampling from hip midpoint
    const hip = frame.landmarks[23];
    if (hip) this._hipSamples.push(hip.x + hip.y);
    if (this._hipSamples.length > 90) this._hipSamples.shift();

    if (def.kind === 'hold') {
      const valid = def.holdTest ? def.holdTest(frame.landmarks) : false;
      this.holdValid = valid;
      if (valid) { this.holdMs += dt; this.activeMs += dt; tally.holdMs = Math.round(this.holdMs); }
      else this.restMs += dt;
      // live form
      this._emitForm(def, frame);
      this.bus.emit('hold', { exerciseId: def.id, holdMs: Math.round(this.holdMs), valid });
      // stage completion for timed holds
      if (this.currentStage.durationMs && this.holdMs >= this.currentStage.durationMs) this.nextStage();
    } else if (this.counter) {
      // active vs rest accounting
      if (t - this.lastRepT < REST_GAP_MS && this.lastRepT) this.activeMs += dt; else this.restMs += dt;
      this._emitForm(def, frame);
      const rep = this.counter.update(frame.landmarks, t);
      if (rep) {
        this.lastRepT = t;
        tally.reps = rep.index;
        this._romHistory.push(rep.romPct);
        this._tutHistory.push(rep.tutMs);
        tally.avgRom = avg(this._romHistoryFor(def.id));
        tally.avgForm = blend(tally.avgForm, rep.formScore, rep.index);
        tally.bestSymmetry = Math.max(tally.bestSymmetry, rep.symmetryPct);
        const total = this.totalReps();
        this.bus.emit('rep', { rep, exerciseId: def.id, total });
        if (this.currentStage.targetReps && rep.index >= this.currentStage.targetReps) this.nextStage();
      }
    }

    this.bus.emit('tick', { tally: [...this.tallies.values()], metrics: this.liveMetrics() });
  }

  /** @param {import('../exercises/registry.js').ExerciseDef} def @param {import('../pose/poseEngine.js').PoseFrame} frame */
  _emitForm(def, frame) {
    if (!def.formChecks?.length) { this.bus.emit('form', { faults: [], faultJoints: [] }); return; }
    /** @type {string[]} */ const faults = [];
    /** @type {number[]} */ const joints = [];
    for (const fc of def.formChecks) {
      const r = fc.test(frame.landmarks);
      if (!r.ok) {
        faults.push(r.cue);
        if (typeof r.from === 'number') joints.push(r.from);
        if (typeof r.to === 'number') joints.push(r.to);
      }
    }
    this.bus.emit('form', { faults, faultJoints: joints });
  }

  /** @param {string} id */
  _romHistoryFor() { return this._romHistory.slice(-30); }

  totalReps() { let n = 0; for (const t of this.tallies.values()) n += t.reps; return n; }

  /** @returns {LiveMetrics} */
  liveMetrics() {
    const minutes = (performance.now() - this.startedT) / 60000;
    const met = this.currentExercise.met;
    const calories = met * this.weightKg * (this.activeMs / 3600000);
    const stability = this._stability();
    const cadence = this._tutHistory.length ? 60000 / avg(this._tutHistory.slice(-5)) : 0;
    const powerW = Math.round(met * this.weightKg * 0.5 + cadence * 2);
    return {
      reps: this.totalReps(),
      activeMs: Math.round(this.activeMs),
      restMs: Math.round(this.restMs),
      calories,
      powerW,
      stability,
    };
  }

  _stability() {
    if (this._hipSamples.length < 10) return 100;
    const m = avg(this._hipSamples);
    const variance = avg(this._hipSamples.map((v) => (v - m) ** 2));
    return Math.max(0, Math.min(100, Math.round(100 - variance * 40000)));
  }

  /** @returns {SessionSummary} */
  finish() {
    if (this.finished) return this._summary;
    this.finished = true;
    const durationMs = performance.now() - this.startedT;
    const exercises = [...this.tallies.values()].filter((t) => t.reps > 0 || t.holdMs > 0);
    const totalReps = exercises.reduce((s, e) => s + e.reps, 0);
    const avgFormScore = exercises.length ? Math.round(avg(exercises.map((e) => e.avgForm || 100))) : 100;
    const avgSymmetry = exercises.length ? Math.round(avg(exercises.filter((e) => e.bestSymmetry).map((e) => e.bestSymmetry)) || 100) : 100;
    const avgRom = exercises.length ? Math.round(avg(exercises.map((e) => e.avgRom || 0))) : 0;
    const calories = this.liveMetrics().calories;

    const stabilityScore = this._stability();
    const explosivenessScore = clamp(Math.round(this._tutHistory.length ? 12000 / avg(this._tutHistory) * 50 : 50));
    const enduranceScore = clamp(Math.round(Math.min(100, (this.activeMs / 60000) * 20 + totalReps)));
    const overallScore = Math.round((avgFormScore * 0.4 + avgRom * 0.25 + stabilityScore * 0.15 + enduranceScore * 0.2));

    /** @type {SessionSummary} */
    const summary = {
      durationMs, activeMs: Math.round(this.activeMs), restMs: Math.round(this.restMs),
      totalReps, calories, avgFormScore, avgSymmetry, avgRom,
      stabilityScore, explosivenessScore, enduranceScore, overallScore,
      mode: this.mode, exercises,
    };
    this._summary = summary;
    this.bus.emit('finish', summary);
    log.info('session finished', summary);
    return summary;
  }
}

/** @param {number[]} a */
function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
/** @param {number} prev @param {number} val @param {number} n */
function blend(prev, val, n) { return Math.round((prev * (n - 1) + val) / n); }
/** @param {number} v */
function clamp(v) { return Math.max(0, Math.min(100, v)); }
