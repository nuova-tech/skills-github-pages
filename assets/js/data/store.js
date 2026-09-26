/**
 * Persistence layer. Everything is stored locally (localStorage) so the app
 * works offline and on static hosting with no backend. The schema is versioned
 * and the public surface is intentionally small so a cloud-sync adapter could
 * implement the same methods later.
 * @module data/store
 */

import { createLogger } from '../core/logger.js';

const log = createLogger('store');
const KEY = 'aifit:v1';

/**
 * @typedef {Object} WorkoutRecord
 * @property {string} id
 * @property {number} date epoch ms
 * @property {number} durationMs
 * @property {number} totalReps
 * @property {number} calories
 * @property {number} avgFormScore
 * @property {number} xpEarned
 * @property {string} mode
 * @property {Array<{id:string,name:string,reps:number,avgRom:number,avgForm:number,bestSymmetry:number,holdMs?:number}>} exercises
 *
 * @typedef {Object} Profile
 * @property {string} name
 * @property {number} weightKg used for calorie estimates
 * @property {number} heightCm
 * @property {number} age
 * @property {number} xp
 * @property {number} level
 * @property {string[]} achievements unlocked achievement ids
 * @property {Record<string, number>} prs personal records: exerciseId → best reps in a set
 *
 * @typedef {Object} AppState
 * @property {number} version
 * @property {Profile} profile
 * @property {WorkoutRecord[]} workouts
 * @property {Record<string, any>} settings
 */

/** @returns {AppState} */
function defaults() {
  return {
    version: 1,
    profile: {
      name: 'Athlete', weightKg: 70, heightCm: 175, age: 30,
      xp: 0, level: 1, achievements: [], prs: {},
    },
    workouts: [],
    settings: { voice: true, sound: true, haptics: true, autoDetect: false },
  };
}

export class Store {
  constructor() {
    /** @type {AppState} */
    this.state = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      return { ...defaults(), ...parsed, profile: { ...defaults().profile, ...parsed.profile } };
    } catch (err) {
      log.warn('failed to load state, using defaults', err);
      return defaults();
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
    catch (err) { log.error('save failed (quota?)', err); }
  }

  /** @returns {Profile} */
  get profile() { return this.state.profile; }
  /** @returns {WorkoutRecord[]} */
  get workouts() { return this.state.workouts; }
  get settings() { return this.state.settings; }

  /** @param {Partial<Profile>} patch */
  updateProfile(patch) { Object.assign(this.state.profile, patch); this.save(); }
  /** @param {Record<string,any>} patch */
  updateSettings(patch) { Object.assign(this.state.settings, patch); this.save(); }

  /** @param {WorkoutRecord} rec */
  addWorkout(rec) {
    this.state.workouts.unshift(rec);
    // Update PRs (best reps per exercise in a single set).
    for (const ex of rec.exercises) {
      const prev = this.state.profile.prs[ex.id] ?? 0;
      if (ex.reps > prev) this.state.profile.prs[ex.id] = ex.reps;
    }
    this.save();
  }

  /** @param {string} id */
  unlockAchievement(id) {
    if (!this.state.profile.achievements.includes(id)) {
      this.state.profile.achievements.push(id);
      this.save();
      return true;
    }
    return false;
  }

  /** Current streak in days (consecutive calendar days with a workout). */
  currentStreak() {
    const days = new Set(this.state.workouts.map((w) => dayKey(w.date)));
    let streak = 0;
    const cursor = new Date();
    // allow today or yesterday to seed the streak
    if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dayKey(cursor.getTime()))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  totalReps() { return this.state.workouts.reduce((s, w) => s + w.totalReps, 0); }
  totalWorkouts() { return this.state.workouts.length; }

  /** Export full state as JSON string. */
  exportJSON() { return JSON.stringify(this.state, null, 2); }

  /** Export workout history as CSV. */
  exportCSV() {
    const header = 'date,mode,duration_s,total_reps,calories,avg_form,xp,exercises';
    const rows = this.state.workouts.map((w) => [
      new Date(w.date).toISOString(),
      w.mode,
      Math.round(w.durationMs / 1000),
      w.totalReps,
      Math.round(w.calories),
      w.avgFormScore,
      w.xpEarned,
      w.exercises.map((e) => `${e.name}:${e.reps}`).join('|'),
    ].join(','));
    return [header, ...rows].join('\n');
  }

  reset() { this.state = defaults(); this.save(); }
}

/** @param {number} ms */
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
