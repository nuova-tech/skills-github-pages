/**
 * Lightweight leveled logger with an in-memory ring buffer so the UI can
 * surface recent diagnostics and we can export them for bug reports.
 * @module core/logger
 */

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */

const LEVELS = /** @type {const} */ ({ debug: 10, info: 20, warn: 30, error: 40 });
const RING_SIZE = 500;

/** @type {Array<{t:number, level:LogLevel, scope:string, msg:string, data?:unknown}>} */
const ring = [];

let threshold = LEVELS.info;

/** @param {LogLevel} level */
export function setLogLevel(level) {
  threshold = LEVELS[level] ?? LEVELS.info;
}

/**
 * @param {LogLevel} level
 * @param {string} scope
 * @param {string} msg
 * @param {unknown} [data]
 */
function emit(level, scope, msg, data) {
  const entry = { t: Date.now(), level, scope, msg, data };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  if (LEVELS[level] < threshold) return;
  const line = `[${scope}] ${msg}`;
  const fn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'debug' ? console.debug
    : console.log;
  if (data !== undefined) fn(line, data); else fn(line);
}

/**
 * Create a scoped logger. Keeps call sites terse: `const log = createLogger('pose')`.
 * @param {string} scope
 */
export function createLogger(scope) {
  return {
    debug: (/** @type {string} */ m, /** @type {unknown=} */ d) => emit('debug', scope, m, d),
    info: (/** @type {string} */ m, /** @type {unknown=} */ d) => emit('info', scope, m, d),
    warn: (/** @type {string} */ m, /** @type {unknown=} */ d) => emit('warn', scope, m, d),
    error: (/** @type {string} */ m, /** @type {unknown=} */ d) => emit('error', scope, m, d),
  };
}

/** @returns {ReadonlyArray<{t:number, level:LogLevel, scope:string, msg:string}>} */
export function getLogBuffer() {
  return ring.map(({ t, level, scope, msg }) => ({ t, level, scope, msg }));
}

export function exportLogs() {
  return ring
    .map((e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase()} [${e.scope}] ${e.msg}`)
    .join('\n');
}
