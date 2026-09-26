/**
 * Minimal zero-dependency test harness so the suite runs anywhere Node is
 * available (and in CI) without pulling in a framework.
 */
let passed = 0, failed = 0;
/** @type {string[]} */
const failures = [];

/** @param {string} name @param {() => void} fn */
export function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; failures.push(`${name}: ${err.message}`); console.error(`  ✗ ${name}\n      ${err.message}`); }
}

/** @param {string} title @param {() => void} fn */
export function describe(title, fn) { console.log(`\n${title}`); fn(); }

export const assert = {
  /** @param {any} c @param {string} [m] */
  ok(c, m) { if (!c) throw new Error(m || `expected truthy, got ${c}`); },
  /** @param {any} a @param {any} b @param {string} [m] */
  equal(a, b, m) { if (a !== b) throw new Error(m || `expected ${b}, got ${a}`); },
  /** @param {number} a @param {number} b @param {number} [eps] */
  close(a, b, eps = 1e-6) { if (Math.abs(a - b) > eps) throw new Error(`expected ~${b}, got ${a}`); },
  /** @param {number} a @param {number} b */
  gt(a, b) { if (!(a > b)) throw new Error(`expected ${a} > ${b}`); },
};

export function report() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { process.exitCode = 1; }
}
