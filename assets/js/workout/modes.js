/**
 * Workout mode definitions and plan builders. A "plan" compiles down to a list
 * of {@link Stage}s the {@link WorkoutSession} executes, so every mode shares
 * one engine.
 * @module workout/modes
 */

/** @typedef {import('./session.js').Stage} Stage */

export const MODES = [
  { id: 'free', name: 'Free Workout', icon: '🎛️', desc: 'Pick an exercise and go. Auto-detect optional.' },
  { id: 'guided', name: 'Guided', icon: '🧭', desc: 'Follow a structured set list with targets.' },
  { id: 'circuit', name: 'Circuit', icon: '🔁', desc: 'Rotate through exercises with short rests.' },
  { id: 'hiit', name: 'HIIT', icon: '🔥', desc: 'Work/rest intervals at high intensity.' },
  { id: 'amrap', name: 'AMRAP', icon: '⏱️', desc: 'As many reps as possible in the time cap.' },
  { id: 'emom', name: 'EMOM', icon: '⏲️', desc: 'Every minute on the minute.' },
  { id: 'timed', name: 'Timed Challenge', icon: '🎯', desc: 'Beat the clock for a rep goal.' },
  { id: 'test', name: 'Fitness Test', icon: '📋', desc: 'Benchmark squats, push-ups, plank.' },
];

/**
 * @param {string} exerciseId
 * @returns {{mode:string, stages:Stage[]}}
 */
export function freePlan(exerciseId) {
  return { mode: 'free', stages: [{ exerciseId }] };
}

/**
 * Circuit of exercises, one round = each once; repeated `rounds` times.
 * @param {string[]} exerciseIds @param {{reps?:number, restMs?:number, rounds?:number}} [opts]
 */
export function circuitPlan(exerciseIds, opts = {}) {
  const reps = opts.reps ?? 12;
  const restMs = opts.restMs ?? 15000;
  const rounds = opts.rounds ?? 3;
  /** @type {Stage[]} */ const stages = [];
  for (let r = 0; r < rounds; r++) {
    for (const id of exerciseIds) stages.push({ exerciseId: id, targetReps: reps, restMs });
  }
  return { mode: 'circuit', stages };
}

/** AMRAP: a single exercise, time-capped (duration enforced by the UI timer). @param {string} exerciseId @param {number} minutes */
export function amrapPlan(exerciseId, minutes = 5) {
  return { mode: 'amrap', durationMs: minutes * 60000, stages: [{ exerciseId }] };
}

/** A balanced default fitness test. */
export function fitnessTestPlan() {
  return {
    mode: 'test',
    stages: [
      { exerciseId: 'squat', targetReps: 20 },
      { exerciseId: 'pushup', targetReps: 15 },
      { exerciseId: 'plank', durationMs: 45000 },
    ],
  };
}

/**
 * Lightweight recommendation: suggest the least-recently-trained category and
 * a difficulty nudge based on the user's last form score.
 * @param {import('../data/store.js').Store} store
 */
export function recommend(store) {
  const last = store.workouts[0];
  const all = ['squat', 'pushup', 'lunge', 'plank', 'jumpingjack', 'situp'];
  const trained = new Set(store.workouts.slice(0, 3).flatMap((w) => w.exercises.map((e) => e.id)));
  const fresh = all.find((id) => !trained.has(id)) ?? 'squat';
  let difficulty = 'balanced';
  if (last && last.avgFormScore >= 90) difficulty = 'harder';
  else if (last && last.avgFormScore < 70) difficulty = 'easier';
  return {
    exerciseId: fresh,
    difficulty,
    reason: last
      ? `Last session form was ${last.avgFormScore}%. Suggesting ${fresh} (${difficulty}).`
      : `Start with ${fresh} to establish a baseline.`,
  };
}
