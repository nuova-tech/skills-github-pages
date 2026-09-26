/**
 * Gamification engine: XP & leveling, performance medals, achievement badges,
 * daily missions, and streak rewards. Pure logic over the {@link Store} so it's
 * easy to unit test and reuse.
 * @module game/gamification
 */

/** XP required to reach level N uses a gentle quadratic curve. @param {number} level */
export function xpForLevel(level) {
  return Math.round(50 * level * level + 50 * level);
}

/** Resolve a total XP value into a level + progress to next. @param {number} xp */
export function levelFromXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level)) level++;
  const prev = level > 1 ? xpForLevel(level - 1) : 0;
  const next = xpForLevel(level);
  return { level, prev, next, into: xp - prev, span: next - prev, pct: Math.round(((xp - prev) / (next - prev)) * 100) };
}

/** Medal tiers from a 0..100 performance score. @param {number} score */
export function medalFor(score) {
  if (score >= 95) return { tier: 'Diamond', icon: '💎', color: '#67e8f9' };
  if (score >= 88) return { tier: 'Platinum', icon: '🏆', color: '#e5e7eb' };
  if (score >= 78) return { tier: 'Gold', icon: '🥇', color: '#fbbf24' };
  if (score >= 65) return { tier: 'Silver', icon: '🥈', color: '#cbd5e1' };
  return { tier: 'Bronze', icon: '🥉', color: '#d97706' };
}

/** Rank progression from cumulative level. @param {number} level */
export function rankFor(level) {
  const ranks = ['Rookie', 'Bronze', 'Silver', 'Gold', 'Elite', 'Champion', 'Legend'];
  return ranks[Math.min(ranks.length - 1, Math.floor(level / 5))];
}

/** @type {Array<{id:string,name:string,desc:string,icon:string,test:(s:import('../data/store.js').Store)=>boolean}>} */
export const ACHIEVEMENTS = [
  { id: 'first-workout', name: 'First Steps', desc: 'Complete your first workout', icon: '🎯', test: (s) => s.totalWorkouts() >= 1 },
  { id: 'reps-100', name: 'Century', desc: 'Log 100 total reps', icon: '💯', test: (s) => s.totalReps() >= 100 },
  { id: 'reps-1000', name: 'Machine', desc: 'Log 1,000 total reps', icon: '⚙️', test: (s) => s.totalReps() >= 1000 },
  { id: 'streak-3', name: 'On a Roll', desc: '3-day streak', icon: '🔥', test: (s) => s.currentStreak() >= 3 },
  { id: 'streak-7', name: 'Unstoppable', desc: '7-day streak', icon: '⚡', test: (s) => s.currentStreak() >= 7 },
  { id: 'level-5', name: 'Rising Star', desc: 'Reach level 5', icon: '⭐', test: (s) => s.profile.level >= 5 },
  { id: 'level-10', name: 'Veteran', desc: 'Reach level 10', icon: '🎖️', test: (s) => s.profile.level >= 10 },
  { id: 'perfect-form', name: 'Textbook', desc: 'Finish a workout with 95%+ form', icon: '📐', test: (s) => s.workouts.some((w) => w.avgFormScore >= 95) },
  { id: 'workouts-10', name: 'Committed', desc: 'Complete 10 workouts', icon: '🏅', test: (s) => s.totalWorkouts() >= 10 },
];

export class Gamification {
  /** @param {import('../data/store.js').Store} store */
  constructor(store) { this.store = store; }

  /**
   * Award XP for a completed workout. Returns level-up info + newly unlocked.
   * XP = reps * formMultiplier + duration bonus + streak bonus.
   * @param {import('../workout/session.js').SessionSummary} summary
   */
  awardWorkout(summary) {
    const formMult = 0.8 + (summary.avgFormScore / 100) * 0.7; // 0.8..1.5
    const repXp = Math.round(summary.totalReps * 5 * formMult);
    const timeXp = Math.round((summary.durationMs / 60000) * 10);
    const streakBonus = Math.round(this.store.currentStreak() * 15);
    const xpEarned = repXp + timeXp + streakBonus;

    const before = this.store.profile.level;
    const newXp = this.store.profile.xp + xpEarned;
    const lvl = levelFromXp(newXp);
    this.store.updateProfile({ xp: newXp, level: lvl.level });

    const unlocked = this._checkAchievements();
    return { xpEarned, repXp, timeXp, streakBonus, leveledUp: lvl.level > before, level: lvl.level, unlocked };
  }

  /** @returns {Array<{id:string,name:string,icon:string,desc:string}>} */
  _checkAchievements() {
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (this.store.profile.achievements.includes(a.id)) continue;
      if (a.test(this.store)) {
        this.store.unlockAchievement(a.id);
        newly.push({ id: a.id, name: a.name, icon: a.icon, desc: a.desc });
      }
    }
    return newly;
  }

  /**
   * Deterministic daily missions seeded by the date, so they're stable for a
   * day and refresh automatically. Progress is computed from today's workouts.
   */
  dailyMissions() {
    const seed = new Date();
    const dayNum = Math.floor(seed.getTime() / 86400000);
    const pool = [
      { id: 'm-reps', label: 'Complete 50 reps today', goal: 50, kind: 'reps', xp: 100 },
      { id: 'm-squats', label: 'Do 20 squats', goal: 20, kind: 'ex:squat', xp: 80 },
      { id: 'm-time', label: 'Train for 10 minutes', goal: 10, kind: 'minutes', xp: 120 },
      { id: 'm-form', label: 'Hit 85% average form', goal: 85, kind: 'form', xp: 150 },
      { id: 'm-pushups', label: 'Do 15 push-ups', goal: 15, kind: 'ex:pushup', xp: 80 },
    ];
    const picks = [pool[dayNum % pool.length], pool[(dayNum + 2) % pool.length], pool[(dayNum + 4) % pool.length]];
    const todays = this.store.workouts.filter((w) => sameDay(w.date, seed.getTime()));
    return picks.map((m) => ({ ...m, progress: this._missionProgress(m, todays) }));
  }

  /** @param {{kind:string,goal:number}} m @param {import('../data/store.js').WorkoutRecord[]} todays */
  _missionProgress(m, todays) {
    let val = 0;
    if (m.kind === 'reps') val = todays.reduce((s, w) => s + w.totalReps, 0);
    else if (m.kind === 'minutes') val = Math.round(todays.reduce((s, w) => s + w.durationMs, 0) / 60000);
    else if (m.kind === 'form') val = todays.length ? Math.round(todays.reduce((s, w) => s + w.avgFormScore, 0) / todays.length) : 0;
    else if (m.kind.startsWith('ex:')) {
      const id = m.kind.slice(3);
      val = todays.reduce((s, w) => s + (w.exercises.find((e) => e.id === id)?.reps ?? 0), 0);
    }
    return { value: val, done: val >= m.goal, pct: Math.min(100, Math.round((val / m.goal) * 100)) };
  }
}

/** @param {number} a @param {number} b */
function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
