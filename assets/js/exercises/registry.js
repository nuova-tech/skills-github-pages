/**
 * Configurable exercise definitions. Each definition is data-driven so new
 * movements can be added without touching the rep-counting engine.
 *
 * A rep exercise exposes:
 *  - `metric(lm)` → a scalar that oscillates with the movement (e.g. knee angle)
 *  - `down` / `up` thresholds (with hysteresis) defining one rep cycle
 *  - `romRange` → [worst, best] metric values used to score range of motion
 *  - optional `left(lm)` / `right(lm)` metrics for symmetry analysis
 *  - `formChecks` → instant per-frame form validators that produce coaching cues
 *
 * A hold exercise exposes `holdTest(lm)` returning whether the position is valid.
 * @module exercises/registry
 */

import { LM, angleDeg, segmentAngleDeg, dist, mid } from '../pose/landmarks.js';

/**
 * @typedef {import('../pose/landmarks.js').Landmark} Landmark
 * @typedef {{ok:boolean, severity:'info'|'warn', cue:string, from?:number, to?:number}} FormResult
 * @typedef {{id:string, label:string, test:(lm:Landmark[])=>FormResult}} FormCheck
 * @typedef {Object} ExerciseDef
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {'lower'|'upper'|'core'|'cardio'|'full'} category
 * @property {string[]} muscles
 * @property {number} met metabolic equivalent for calorie estimation
 * @property {'rep'|'hold'} kind
 * @property {string} view camera angle hint
 * @property {number[]} required landmark indices that must be visible
 * @property {(lm:Landmark[])=>number} [metric]
 * @property {(lm:Landmark[])=>number} [left]
 * @property {(lm:Landmark[])=>number} [right]
 * @property {number} [down] threshold entering the bottom/active phase
 * @property {number} [up] threshold returning to the top/rest phase
 * @property {boolean} [invert] true when "down" means a larger metric value
 * @property {[number,number]} [romRange] [worst, best] for ROM scoring
 * @property {(lm:Landmark[])=>boolean} [holdTest]
 * @property {FormCheck[]} [formChecks]
 * @property {string[]} cues short instructional cues shown before the set
 */

const { LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST,
  RIGHT_WRIST, LEFT_HIP, RIGHT_HIP, LEFT_KNEE, RIGHT_KNEE, LEFT_ANKLE,
  RIGHT_ANKLE, NOSE } = LM;

/** Average of left/right joint angles, used for front-facing symmetric moves. */
const kneeAngleL = (/** @type {Landmark[]} */ lm) => angleDeg(lm[LEFT_HIP], lm[LEFT_KNEE], lm[LEFT_ANKLE]);
const kneeAngleR = (/** @type {Landmark[]} */ lm) => angleDeg(lm[RIGHT_HIP], lm[RIGHT_KNEE], lm[RIGHT_ANKLE]);
const elbowAngleL = (/** @type {Landmark[]} */ lm) => angleDeg(lm[LEFT_SHOULDER], lm[LEFT_ELBOW], lm[LEFT_WRIST]);
const elbowAngleR = (/** @type {Landmark[]} */ lm) => angleDeg(lm[RIGHT_SHOULDER], lm[RIGHT_ELBOW], lm[RIGHT_WRIST]);
const hipAngleL = (/** @type {Landmark[]} */ lm) => angleDeg(lm[LEFT_SHOULDER], lm[LEFT_HIP], lm[LEFT_KNEE]);
const hipAngleR = (/** @type {Landmark[]} */ lm) => angleDeg(lm[RIGHT_SHOULDER], lm[RIGHT_HIP], lm[RIGHT_KNEE]);

/** @param {Landmark[]} lm */
const torsoTilt = (lm) => Math.abs(segmentAngleDeg(mid(lm[LEFT_SHOULDER], lm[RIGHT_SHOULDER]), mid(lm[LEFT_HIP], lm[RIGHT_HIP])) + 90);

/** Knee valgus (collapsing inward) check shared by squats/lunges. @param {Landmark[]} lm @returns {FormResult} */
function kneeValgusCheck(lm) {
  const hipW = dist(lm[LEFT_HIP], lm[RIGHT_HIP]) || 0.001;
  const kneeW = dist(lm[LEFT_KNEE], lm[RIGHT_KNEE]);
  const ratio = kneeW / hipW;
  const ok = ratio > 0.6;
  return { ok, severity: 'warn', cue: 'Push your knees out — keep them over your toes', from: LEFT_KNEE, to: RIGHT_KNEE };
}

/** Rounded-back check via torso tilt for hinge/core moves. @param {Landmark[]} lm @returns {FormResult} */
function backRoundCheck(lm) {
  const tilt = torsoTilt(lm);
  return { ok: tilt < 45, severity: 'warn', cue: 'Keep your chest up and back flat' };
}

/** @type {ExerciseDef[]} */
export const EXERCISES = [
  {
    id: 'squat', name: 'Squats', icon: '🏋️', category: 'lower',
    muscles: ['quads', 'glutes', 'hamstrings'], met: 5.0, kind: 'rep', view: 'front/side',
    required: [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE, RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE],
    metric: (lm) => (kneeAngleL(lm) + kneeAngleR(lm)) / 2,
    left: kneeAngleL, right: kneeAngleR,
    down: 100, up: 160, romRange: [170, 70],
    cues: ['Feet shoulder-width', 'Sit back and down', 'Drive through heels'],
    formChecks: [
      { id: 'depth', label: 'Squat depth', test: (lm) => {
        const a = (kneeAngleL(lm) + kneeAngleR(lm)) / 2;
        return { ok: a < 110, severity: 'info', cue: 'Go deeper — aim for thighs parallel' };
      } },
      { id: 'valgus', label: 'Knee tracking', test: kneeValgusCheck },
    ],
  },
  {
    id: 'pushup', name: 'Push-ups', icon: '💪', category: 'upper',
    muscles: ['chest', 'triceps', 'shoulders'], met: 8.0, kind: 'rep', view: 'side',
    required: [LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST, RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST],
    metric: (lm) => (elbowAngleL(lm) + elbowAngleR(lm)) / 2,
    left: elbowAngleL, right: elbowAngleR,
    down: 95, up: 155, romRange: [165, 80],
    cues: ['Hands under shoulders', 'Lower chest to floor', 'Keep a straight line'],
    formChecks: [
      { id: 'depth', label: 'Push-up depth', test: (lm) => {
        const a = (elbowAngleL(lm) + elbowAngleR(lm)) / 2;
        return { ok: a < 100, severity: 'info', cue: 'Lower further — chest toward the floor' };
      } },
      { id: 'hips', label: 'Hip alignment', test: (lm) => {
        const tilt = torsoTilt(lm);
        return { ok: tilt > 55, severity: 'warn', cue: 'Keep hips in line — no sagging or piking' };
      } },
    ],
  },
  {
    id: 'situp', name: 'Sit-ups', icon: '🛌', category: 'core',
    muscles: ['abs', 'hip flexors'], met: 6.0, kind: 'rep', view: 'side',
    required: [LEFT_SHOULDER, LEFT_HIP, LEFT_KNEE],
    metric: (lm) => (hipAngleL(lm) + hipAngleR(lm)) / 2,
    left: hipAngleL, right: hipAngleR,
    down: 70, up: 120, romRange: [130, 55],
    cues: ['Knees bent', 'Curl up under control', 'Exhale at the top'],
    formChecks: [],
  },
  {
    id: 'crunch', name: 'Crunches', icon: '🔥', category: 'core',
    muscles: ['abs'], met: 4.0, kind: 'rep', view: 'side',
    required: [LEFT_SHOULDER, LEFT_HIP, LEFT_KNEE],
    metric: (lm) => (hipAngleL(lm) + hipAngleR(lm)) / 2,
    left: hipAngleL, right: hipAngleR,
    down: 100, up: 130, romRange: [135, 90],
    cues: ['Lower back stays down', 'Short controlled curl'],
    formChecks: [],
  },
  {
    id: 'lunge', name: 'Lunges', icon: '🦵', category: 'lower',
    muscles: ['quads', 'glutes'], met: 5.0, kind: 'rep', view: 'side',
    required: [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE, RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE],
    metric: (lm) => Math.min(kneeAngleL(lm), kneeAngleR(lm)),
    left: kneeAngleL, right: kneeAngleR,
    down: 100, up: 160, romRange: [170, 80],
    cues: ['Step forward', 'Drop back knee', 'Keep front knee over ankle'],
    formChecks: [
      { id: 'even', label: 'Even lunge', test: (lm) => {
        const diff = Math.abs(kneeAngleL(lm) - kneeAngleR(lm));
        return { ok: diff < 60, severity: 'info', cue: 'Balance the load between both legs' };
      } },
    ],
  },
  {
    id: 'jumpingjack', name: 'Jumping Jacks', icon: '⭐', category: 'cardio',
    muscles: ['shoulders', 'calves', 'full body'], met: 8.0, kind: 'rep', view: 'front',
    required: [LEFT_WRIST, RIGHT_WRIST, LEFT_ANKLE, RIGHT_ANKLE, LEFT_SHOULDER, RIGHT_SHOULDER],
    // Metric: wrists above shoulders + feet apart → "open". Use wrist height relative to shoulders.
    metric: (lm) => {
      const sY = (lm[LEFT_SHOULDER].y + lm[RIGHT_SHOULDER].y) / 2;
      const wY = (lm[LEFT_WRIST].y + lm[RIGHT_WRIST].y) / 2;
      return (sY - wY) * 100; // positive when hands above shoulders
    },
    invert: true, down: 10, up: -10, romRange: [-20, 30],
    cues: ['Arms overhead', 'Feet out and in', 'Stay light on your feet'],
    formChecks: [
      { id: 'fullarms', label: 'Full extension', test: (lm) => {
        const sY = (lm[LEFT_SHOULDER].y + lm[RIGHT_SHOULDER].y) / 2;
        const wY = (lm[LEFT_WRIST].y + lm[RIGHT_WRIST].y) / 2;
        return { ok: wY < sY - 0.05, severity: 'info', cue: 'Reach all the way overhead' };
      } },
    ],
  },
  {
    id: 'highknees', name: 'High Knees', icon: '🏃', category: 'cardio',
    muscles: ['hip flexors', 'quads', 'calves'], met: 8.0, kind: 'rep', view: 'front',
    required: [LEFT_HIP, RIGHT_HIP, LEFT_KNEE, RIGHT_KNEE],
    // Metric: highest knee relative to hip line (one count per knee raise).
    metric: (lm) => {
      const hipY = (lm[LEFT_HIP].y + lm[RIGHT_HIP].y) / 2;
      const kneeY = Math.min(lm[LEFT_KNEE].y, lm[RIGHT_KNEE].y);
      return (hipY - kneeY) * 100;
    },
    invert: true, down: 0, up: -8, romRange: [-15, 12],
    cues: ['Drive knees to hip height', 'Pump the arms', 'Quick cadence'],
    formChecks: [],
  },
  {
    id: 'burpee', name: 'Burpees', icon: '💥', category: 'full',
    muscles: ['full body'], met: 10.0, kind: 'rep', view: 'front',
    required: [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP, LEFT_KNEE, RIGHT_KNEE],
    // Metric: vertical span of the body (standing tall = large, on floor = small).
    metric: (lm) => {
      const headY = lm[NOSE].y;
      const ankleY = (lm[LEFT_ANKLE].y + lm[RIGHT_ANKLE].y) / 2;
      return (ankleY - headY) * 100;
    },
    down: 35, up: 55, romRange: [60, 25],
    cues: ['Squat, kick back, jump up', 'Full lockout at the top'],
    formChecks: [],
  },
  {
    id: 'mountainclimber', name: 'Mountain Climbers', icon: '⛰️', category: 'cardio',
    muscles: ['core', 'shoulders', 'hip flexors'], met: 8.0, kind: 'rep', view: 'side',
    required: [LEFT_HIP, RIGHT_HIP, LEFT_KNEE, RIGHT_KNEE],
    metric: (lm) => {
      const hipX = (lm[LEFT_HIP].x + lm[RIGHT_HIP].x) / 2;
      const kneeX = Math.min(Math.abs(lm[LEFT_KNEE].x - hipX), Math.abs(lm[RIGHT_KNEE].x - hipX));
      return kneeX * 100;
    },
    invert: true, down: 8, up: 18, romRange: [25, 5],
    cues: ['Plank position', 'Drive knees to chest', 'Hips low'],
    formChecks: [],
  },
  {
    id: 'calfraise', name: 'Calf Raises', icon: '🦶', category: 'lower',
    muscles: ['calves'], met: 4.0, kind: 'rep', view: 'side',
    required: [LEFT_HIP, RIGHT_HIP, LEFT_ANKLE, RIGHT_ANKLE],
    // Metric: hip height (rises when on toes).
    metric: (lm) => (1 - (lm[LEFT_HIP].y + lm[RIGHT_HIP].y) / 2) * 100,
    down: -1000, up: -1000, // dynamic — handled via relative peak detector in counter
    invert: true, romRange: [0, 5],
    cues: ['Rise onto your toes', 'Squeeze at the top', 'Lower slowly'],
    formChecks: [],
  },
  {
    id: 'tricepdip', name: 'Tricep Dips', icon: '🪑', category: 'upper',
    muscles: ['triceps', 'shoulders'], met: 6.0, kind: 'rep', view: 'side',
    required: [LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST, RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST],
    metric: (lm) => (elbowAngleL(lm) + elbowAngleR(lm)) / 2,
    left: elbowAngleL, right: elbowAngleR,
    down: 95, up: 155, romRange: [165, 80],
    cues: ['Hands behind you', 'Bend to 90°', 'Press back up'],
    formChecks: [],
  },
  {
    id: 'stepup', name: 'Step-ups', icon: '🪜', category: 'lower',
    muscles: ['quads', 'glutes'], met: 6.0, kind: 'rep', view: 'side',
    required: [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE, RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE],
    metric: (lm) => Math.max(kneeAngleL(lm), kneeAngleR(lm)),
    left: kneeAngleL, right: kneeAngleR,
    down: 110, up: 165, romRange: [170, 90],
    cues: ['Step up fully', 'Stand tall', 'Control the way down'],
    formChecks: [],
  },
  {
    id: 'skater', name: 'Skater Jumps', icon: '⛸️', category: 'cardio',
    muscles: ['glutes', 'quads', 'calves'], met: 8.0, kind: 'rep', view: 'front',
    required: [LEFT_HIP, RIGHT_HIP, LEFT_ANKLE, RIGHT_ANKLE],
    // Metric: lateral offset of hip midpoint from ankle midpoint (sway side to side).
    metric: (lm) => {
      const hipX = (lm[LEFT_HIP].x + lm[RIGHT_HIP].x) / 2;
      const ankX = (lm[LEFT_ANKLE].x + lm[RIGHT_ANKLE].x) / 2;
      return Math.abs(hipX - ankX) * 100;
    },
    invert: true, down: 4, up: 1, romRange: [0, 8],
    cues: ['Bound side to side', 'Land softly', 'Stay low'],
    formChecks: [],
  },
  {
    id: 'russiantwist', name: 'Russian Twists', icon: '🌀', category: 'core',
    muscles: ['obliques', 'abs'], met: 5.0, kind: 'rep', view: 'front',
    required: [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_WRIST, RIGHT_WRIST],
    // Metric: signed horizontal position of hands relative to body center.
    metric: (lm) => {
      const cx = (lm[LEFT_SHOULDER].x + lm[RIGHT_SHOULDER].x) / 2;
      const hx = (lm[LEFT_WRIST].x + lm[RIGHT_WRIST].x) / 2;
      return (hx - cx) * 100;
    },
    invert: true, down: 6, up: -6, romRange: [-12, 12],
    cues: ['Lean back slightly', 'Rotate fully each side', 'Controlled tempo'],
    formChecks: [],
  },
  // ---- Hold / isometric exercises ----
  {
    id: 'plank', name: 'Plank', icon: '🧱', category: 'core',
    muscles: ['core', 'shoulders'], met: 4.0, kind: 'hold', view: 'side',
    required: [LEFT_SHOULDER, LEFT_HIP, LEFT_ANKLE],
    holdTest: (lm) => {
      const tilt = torsoTilt(lm); // near 90 when body is horizontal
      const hipA = (hipAngleL(lm) + hipAngleR(lm)) / 2;
      return tilt > 55 && hipA > 150;
    },
    cues: ['Straight line head to heel', 'Brace your core', 'Don’t let hips drop'],
    formChecks: [
      { id: 'hips', label: 'Flat hips', test: (lm) => {
        const hipA = (hipAngleL(lm) + hipAngleR(lm)) / 2;
        return { ok: hipA > 150, severity: 'warn', cue: 'Lift your hips into a straight line' };
      } },
    ],
  },
  {
    id: 'sideplank', name: 'Side Plank', icon: '📐', category: 'core',
    muscles: ['obliques', 'shoulders'], met: 4.0, kind: 'hold', view: 'front',
    required: [LEFT_SHOULDER, LEFT_HIP, LEFT_ANKLE],
    holdTest: (lm) => {
      const bodyA = angleDeg(lm[LEFT_SHOULDER], lm[LEFT_HIP], lm[LEFT_ANKLE]);
      return bodyA > 155;
    },
    cues: ['Stack your hips', 'Straight body line', 'Reach the top arm up'],
    formChecks: [],
  },
  {
    id: 'wallsit', name: 'Wall Sit', icon: '🧗', category: 'lower',
    muscles: ['quads', 'glutes'], met: 4.5, kind: 'hold', view: 'side',
    required: [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE],
    holdTest: (lm) => {
      const k = (kneeAngleL(lm) + kneeAngleR(lm)) / 2;
      return k > 75 && k < 110;
    },
    cues: ['Thighs parallel to floor', 'Knees over ankles', 'Back flat on wall'],
    formChecks: [
      { id: 'depth', label: 'Sit depth', test: (lm) => {
        const k = (kneeAngleL(lm) + kneeAngleR(lm)) / 2;
        return { ok: k < 110, severity: 'info', cue: 'Lower until thighs are parallel' };
      } },
    ],
  },
];

/** @type {Map<string, ExerciseDef>} */
const byId = new Map(EXERCISES.map((e) => [e.id, e]));

/** @param {string} id */
export function getExercise(id) {
  const e = byId.get(id);
  if (!e) throw new Error(`Unknown exercise: ${id}`);
  return e;
}

export function listExercises() { return EXERCISES.slice(); }
