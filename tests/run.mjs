/**
 * Test entry point. Run with `npm test` or `node tests/run.mjs`.
 * Covers the pure-logic core: geometry, smoothing, rep counting, gamification,
 * and the data store (with a localStorage stub).
 */
import { describe, test, assert, report } from './harness.mjs';

// ---- localStorage / window stubs so browser-targeted modules import in Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { angleDeg, dist, mid } = await import('../assets/js/pose/landmarks.js');
const { LandmarkSmoother } = await import('../assets/js/pose/smoothing.js');
const { getExercise } = await import('../assets/js/exercises/registry.js');
const { RepCounter } = await import('../assets/js/exercises/repCounter.js');
const { levelFromXp, medalFor, xpForLevel, rankFor } = await import('../assets/js/game/gamification.js');
const { Store } = await import('../assets/js/data/store.js');

/** @param {number} x @param {number} y */
const pt = (x, y) => ({ x, y, z: 0, visibility: 1 });

describe('geometry: angleDeg', () => {
  test('right angle is 90°', () => assert.close(angleDeg(pt(0, 1), pt(0, 0), pt(1, 0)), 90, 1e-3));
  test('straight line is 180°', () => assert.close(angleDeg(pt(0, 0), pt(1, 0), pt(2, 0)), 180, 1e-3));
  test('collapsed points default to 180°', () => assert.equal(angleDeg(pt(0, 0), pt(0, 0), pt(1, 0)), 180));
  test('dist & mid', () => { assert.close(dist(pt(0, 0), pt(3, 4)), 5); assert.close(mid(pt(0, 0), pt(2, 2)).x, 1); });
});

describe('smoothing: One Euro filter', () => {
  test('reduces variance of a noisy constant signal', () => {
    const s = new LandmarkSmoother();
    let lastY = 0;
    for (let i = 0; i < 60; i++) {
      const noise = (Math.sin(i * 7.13) * 0.5 + 0.5) * 0.1 - 0.05;
      const out = s.smooth([{ x: 0.5 + noise, y: 0.5, z: 0, visibility: 1 }], i * 33);
      lastY = out[0].x;
    }
    assert.ok(Math.abs(lastY - 0.5) < 0.04, `settled near 0.5, got ${lastY}`);
  });
});

describe('rep counting: synthetic squats', () => {
  test('counts 5 squat reps from an oscillating knee angle', () => {
    const def = getExercise('squat');
    const counter = new RepCounter(def);
    let reps = 0;
    // Build landmarks where knee angle oscillates 170° (up) <-> 80° (down).
    for (let r = 0; r < 5; r++) {
      for (const ang of [170, 130, 90, 80, 90, 130, 170]) {
        const lm = squatLandmarks(ang);
        const res = counter.update(lm, performance.now() + r * 1000 + ang);
        if (res) reps++;
      }
    }
    assert.equal(reps, 5, `expected 5 reps, counted ${reps}`);
  });

  test('does not count shallow partial reps', () => {
    const def = getExercise('squat');
    const counter = new RepCounter(def);
    let reps = 0;
    for (const ang of [170, 150, 140, 150, 170]) { // never crosses down threshold (100)
      const res = counter.update(squatLandmarks(ang), performance.now() + ang);
      if (res) reps++;
    }
    assert.equal(reps, 0);
  });
});

describe('gamification: levels & medals', () => {
  test('xpForLevel increases monotonically', () => assert.gt(xpForLevel(3), xpForLevel(2)));
  test('level 1 at 0 xp', () => assert.equal(levelFromXp(0).level, 1));
  test('higher xp gives higher level', () => assert.gt(levelFromXp(5000).level, levelFromXp(100).level));
  test('progress pct within 0..100', () => { const l = levelFromXp(321); assert.ok(l.pct >= 0 && l.pct <= 100); });
  test('medal tiers', () => {
    assert.equal(medalFor(99).tier, 'Diamond');
    assert.equal(medalFor(80).tier, 'Gold');
    assert.equal(medalFor(10).tier, 'Bronze');
  });
  test('rank progression', () => assert.equal(rankFor(0), 'Rookie'));
});

describe('store: persistence, streak, exports', () => {
  test('persists and reloads a workout', () => {
    mem.clear();
    const s = new Store();
    s.addWorkout(mkWorkout(Date.now(), 30));
    const s2 = new Store();
    assert.equal(s2.totalWorkouts(), 1);
    assert.equal(s2.totalReps(), 30);
  });
  test('tracks personal records', () => {
    mem.clear();
    const s = new Store();
    s.addWorkout(mkWorkout(Date.now(), 10));
    s.addWorkout(mkWorkout(Date.now(), 25));
    assert.equal(s.profile.prs.squat, 25);
  });
  test('current streak counts consecutive days', () => {
    mem.clear();
    const s = new Store();
    const day = 86400000;
    s.addWorkout(mkWorkout(Date.now(), 5));
    s.addWorkout(mkWorkout(Date.now() - day, 5));
    s.addWorkout(mkWorkout(Date.now() - 2 * day, 5));
    assert.equal(s.currentStreak(), 3);
  });
  test('CSV export has a header and one row per workout', () => {
    mem.clear();
    const s = new Store();
    s.addWorkout(mkWorkout(Date.now(), 12));
    const lines = s.exportCSV().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith('date,mode'));
  });
});

report();

// --------------------------------------------------------------- fixtures
/** Construct a landmark array where both knees form `ang` degrees. @param {number} ang */
function squatLandmarks(ang) {
  const lm = Array.from({ length: 33 }, () => pt(0.5, 0.5));
  // Place hip-knee-ankle so the interior knee angle equals `ang`.
  const rad = (ang * Math.PI) / 180;
  const set = (hip, knee, ankle) => {
    lm[hip] = pt(0.5, 0.3);
    lm[knee] = pt(0.5, 0.5);
    // ankle direction rotated by `rad` from the thigh (pointing up)
    lm[ankle] = pt(0.5 + Math.sin(rad) * 0.2, 0.5 + Math.cos(Math.PI - rad) * 0.2 + 0.2);
  };
  // left: 23,25,27  right: 24,26,28
  set(23, 25, 27); set(24, 26, 28);
  // Recompute ankle to hit the angle precisely using vector from knee.
  for (const [hip, knee, ankle] of [[23, 25, 27], [24, 26, 28]]) {
    const hv = { x: lm[hip].x - lm[knee].x, y: lm[hip].y - lm[knee].y };
    const base = Math.atan2(hv.y, hv.x);
    const a = base - rad; // rotate by angle
    lm[ankle] = pt(lm[knee].x + Math.cos(a) * 0.25, lm[knee].y + Math.sin(a) * 0.25);
  }
  return lm;
}

/** @param {number} date @param {number} reps */
function mkWorkout(date, reps) {
  return {
    id: 'w' + date + Math.random(), date, durationMs: 60000, totalReps: reps,
    calories: 50, avgFormScore: 88, xpEarned: 100, mode: 'free',
    exercises: [{ id: 'squat', name: 'Squats', reps, avgRom: 85, avgForm: 88, bestSymmetry: 95 }],
  };
}
