/**
 * Tiny synchronous event bus used to decouple the pose pipeline, the workout
 * session, gamification, and the UI. Listeners never throw into the emitter.
 * @module core/events
 */

import { createLogger } from './logger.js';

const log = createLogger('events');

/** @template {Record<string, any>} E */
export class EventBus {
  constructor() {
    /** @type {Map<keyof E, Set<(payload:any)=>void>>} */
    this._handlers = new Map();
  }

  /**
   * @template {keyof E} K
   * @param {K} type
   * @param {(payload: E[K]) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(type, handler) {
    let set = this._handlers.get(type);
    if (!set) { set = new Set(); this._handlers.set(type, set); }
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * @template {keyof E} K
   * @param {K} type
   * @param {(payload: E[K]) => void} handler
   */
  once(type, handler) {
    const off = this.on(type, (p) => { off(); handler(p); });
    return off;
  }

  /**
   * @template {keyof E} K
   * @param {K} type
   * @param {E[K]} payload
   */
  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const h of set) {
      try { h(payload); } catch (err) { log.error(`handler for "${String(type)}" threw`, err); }
    }
  }
}
