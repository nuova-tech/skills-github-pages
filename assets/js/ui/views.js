/**
 * Pure HTML template builders for each screen. Keeping these as string builders
 * (rather than a framework) keeps the app dependency-free and tiny while still
 * being readable. The controller (app.js) wires up behaviour via [data-action].
 * @module ui/views
 */

import { listExercises } from '../exercises/registry.js';
import { MODES, recommend } from '../workout/modes.js';
import { levelFromXp, rankFor, medalFor, ACHIEVEMENTS } from '../game/gamification.js';

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

/** @param {import('../data/store.js').Store} store */
export function homeView(store) {
  const p = store.profile;
  const lvl = levelFromXp(p.xp);
  const streak = store.currentStreak();
  const rec = recommend(store);
  const last = store.workouts[0];
  return `
  <section class="view view-home">
    <header class="home-hero card">
      <div class="hero-top">
        <div>
          <p class="muted">Welcome back</p>
          <h1>${esc(p.name)}</h1>
          <span class="rank-pill">${rankFor(p.level)} · Lvl ${p.level}</span>
        </div>
        <canvas class="rings" id="homeRings" width="120" height="120" aria-label="activity rings"></canvas>
      </div>
      <div class="xpbar"><div class="xpbar-fill" style="width:${lvl.pct}%"></div></div>
      <p class="muted small">${lvl.into} / ${lvl.span} XP to level ${lvl.level + 1}</p>
    </header>

    <div class="stat-grid">
      <div class="card stat"><span class="stat-num">${streak}🔥</span><span class="muted">Day streak</span></div>
      <div class="card stat"><span class="stat-num">${store.totalWorkouts()}</span><span class="muted">Workouts</span></div>
      <div class="card stat"><span class="stat-num">${store.totalReps()}</span><span class="muted">Total reps</span></div>
      <div class="card stat"><span class="stat-num">${p.achievements.length}</span><span class="muted">Badges</span></div>
    </div>

    <div class="card cta-card">
      <div>
        <h3>Recommended next</h3>
        <p class="muted small">${esc(rec.reason)}</p>
      </div>
      <button class="btn btn-primary" data-action="quickstart" data-ex="${rec.exerciseId}">Start</button>
    </div>

    <h3 class="section-title">Daily missions</h3>
    <div id="missionList" class="mission-list"></div>

    ${last ? `<h3 class="section-title">Last session</h3>
    <div class="card last-session">
      <div><span class="stat-num">${last.totalReps}</span><span class="muted">reps</span></div>
      <div><span class="stat-num">${last.avgFormScore}%</span><span class="muted">form</span></div>
      <div><span class="stat-num">${Math.round(last.calories)}</span><span class="muted">kcal</span></div>
      <div><span class="stat-num">+${last.xpEarned}</span><span class="muted">XP</span></div>
    </div>` : ''}

    <button class="btn btn-primary btn-block big" data-action="goto" data-view="train">Start a workout</button>
  </section>`;
}

/** @param {import('../data/store.js').Store} store */
export function trainView(store) {
  const modeCards = MODES.map((m) => `
    <button class="card mode-card" data-action="pick-mode" data-mode="${m.id}">
      <span class="mode-icon">${m.icon}</span>
      <span class="mode-name">${m.name}</span>
      <span class="muted small">${esc(m.desc)}</span>
    </button>`).join('');

  const exCards = listExercises().map((e) => {
    const pr = store.profile.prs[e.id];
    return `
    <button class="card ex-card" data-action="pick-exercise" data-ex="${e.id}">
      <span class="ex-icon">${e.icon}</span>
      <span class="ex-name">${e.name}</span>
      <span class="muted small">${e.category}${pr ? ` · PR ${pr}` : ''}</span>
    </button>`;
  }).join('');

  return `
  <section class="view view-train">
    <h1>Train</h1>
    <h3 class="section-title">Workout modes</h3>
    <div class="mode-grid">${modeCards}</div>
    <h3 class="section-title">Exercises <span class="muted small">(${listExercises().length} tracked)</span></h3>
    <div class="ex-grid">${exCards}</div>
  </section>`;
}

/** Live workout screen (camera + HUD). @param {import('../exercises/registry.js').ExerciseDef} ex @param {string} mode */
export function liveView(ex, mode, autoDetect) {
  return `
  <section class="view view-live">
    <div class="stage" id="stage">
      <video id="cam" playsinline muted></video>
      <canvas id="overlay"></canvas>
      <div class="hud">
        <div class="hud-top">
          <button class="icon-btn" data-action="end-workout" title="End">✕</button>
          <div class="hud-ex">
            <span class="hud-ex-icon">${ex.icon}</span>
            <span id="hudExName">${ex.name}</span>
            ${autoDetect ? '<span class="auto-pill">AUTO</span>' : ''}
          </div>
          <div class="hud-fps"><span id="fps">0</span> fps</div>
        </div>

        <div class="rep-display">
          <div class="rep-count" id="repCount">0</div>
          <div class="rep-label" id="repLabel">reps</div>
        </div>

        <div class="coach-banner" id="coachBanner" hidden></div>

        <div class="hud-metrics">
          <div class="metric"><span id="mTime">0:00</span><label>active</label></div>
          <div class="metric"><span id="mCal">0</span><label>kcal</label></div>
          <div class="metric"><span id="mForm">100%</span><label>form</label></div>
          <div class="metric"><span id="mStab">100</span><label>stability</label></div>
        </div>

        <div class="hud-status" id="hudStatus">Calibrating…</div>

        <div class="hud-bottom">
          <button class="btn btn-ghost" data-action="toggle-voice"><span id="voiceLabel">🔊 Voice</span></button>
          <button class="btn btn-primary" data-action="finish-workout">Finish</button>
          <button class="btn btn-ghost" data-action="switch-camera">🔄 Cam</button>
        </div>
      </div>
      <div class="calib-overlay" id="calibOverlay">
        <div class="calib-card">
          <div class="spinner"></div>
          <h3>Camera calibration</h3>
          <p class="muted" id="calibMsg">Stand back so your whole body is visible…</p>
        </div>
      </div>
    </div>
  </section>`;
}

/**
 * @param {import('../workout/session.js').SessionSummary} s
 * @param {{xpEarned:number, leveledUp:boolean, level:number, unlocked:any[]}} reward
 * @param {{headline:string, lines:string[]}} coach
 */
export function summaryView(s, reward, coach) {
  const medal = medalFor(s.overallScore);
  const exRows = s.exercises.map((e) => `
    <tr><td>${e.name}</td><td>${e.reps || (e.holdMs ? Math.round(e.holdMs / 1000) + 's' : 0)}</td>
    <td>${e.avgRom || '–'}${e.avgRom ? '%' : ''}</td><td>${e.avgForm || '–'}${e.avgForm ? '%' : ''}</td></tr>`).join('');
  const badges = reward.unlocked.map((a) => `<span class="badge-chip">${a.icon} ${esc(a.name)}</span>`).join('');
  return `
  <section class="view view-summary">
    <div class="summary-medal" style="--medal:${medal.color}">
      <div class="medal-icon">${medal.icon}</div>
      <h1>${medal.tier}</h1>
      <p class="muted">${esc(coach.headline)}</p>
    </div>

    <div class="score-grid">
      ${scoreCard('Overall', s.overallScore)}
      ${scoreCard('Form', s.avgFormScore)}
      ${scoreCard('Range', s.avgRom)}
      ${scoreCard('Stability', s.stabilityScore)}
      ${scoreCard('Endurance', s.enduranceScore)}
      ${scoreCard('Symmetry', s.avgSymmetry)}
    </div>

    <div class="card reward-card">
      <div class="reward-xp">+${reward.xpEarned} XP</div>
      ${reward.leveledUp ? `<div class="levelup">⬆️ Level ${reward.level}!</div>` : ''}
      ${badges ? `<div class="badge-row">${badges}</div>` : ''}
    </div>

    <div class="card">
      <h3>Coach feedback</h3>
      <ul class="coach-list">${coach.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>

    <div class="card">
      <h3>Breakdown</h3>
      <table class="data-table">
        <thead><tr><th>Exercise</th><th>Reps</th><th>ROM</th><th>Form</th></tr></thead>
        <tbody>${exRows}</tbody>
      </table>
    </div>

    <div class="summary-meta muted small">
      ${Math.round(s.durationMs / 1000)}s total · ${Math.round(s.activeMs / 1000)}s active · ${Math.round(s.calories)} kcal · ${s.totalReps} reps
    </div>

    <div class="btn-row">
      <button class="btn btn-ghost" data-action="share-summary">Share</button>
      <button class="btn btn-primary" data-action="goto" data-view="home">Done</button>
    </div>
  </section>`;
}

/** @param {string} label @param {number} v */
function scoreCard(label, v) {
  const m = medalFor(v);
  return `<div class="card score-card"><div class="score-ring" style="--p:${v};--c:${m.color}"><span>${v}</span></div><label>${label}</label></div>`;
}

/** @param {import('../data/store.js').Store} store */
export function statsView(store) {
  return `
  <section class="view view-stats">
    <h1>Analytics</h1>
    <div class="card">
      <h3>Reps over last sessions</h3>
      <canvas id="chartReps" class="chart"></canvas>
    </div>
    <div class="card">
      <h3>Form trend</h3>
      <canvas id="chartForm" class="chart"></canvas>
    </div>
    <div class="card">
      <h3>Reps by exercise</h3>
      <canvas id="chartByEx" class="chart"></canvas>
    </div>
    <div class="stat-grid">
      <div class="card stat"><span class="stat-num" id="fitAge">–</span><span class="muted">Fitness age</span></div>
      <div class="card stat"><span class="stat-num" id="consistency">–</span><span class="muted">Consistency</span></div>
    </div>
    <div class="card recovery-card">
      <h3>Recovery</h3>
      <p class="muted small" id="recoveryMsg">Train to get a recovery recommendation.</p>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" data-action="export-csv">Export CSV</button>
      <button class="btn btn-ghost" data-action="export-json">Export JSON</button>
    </div>
  </section>`;
}

/** @param {import('../data/store.js').Store} store */
export function awardsView(store) {
  const owned = new Set(store.profile.achievements);
  const cards = ACHIEVEMENTS.map((a) => `
    <div class="card achievement ${owned.has(a.id) ? 'unlocked' : 'locked'}">
      <span class="ach-icon">${a.icon}</span>
      <div><strong>${esc(a.name)}</strong><p class="muted small">${esc(a.desc)}</p></div>
      ${owned.has(a.id) ? '<span class="ach-check">✓</span>' : '<span class="ach-lock">🔒</span>'}
    </div>`).join('');
  const prRows = Object.entries(store.profile.prs).map(([id, reps]) => {
    const ex = listExercises().find((e) => e.id === id);
    return `<div class="pr-row"><span>${ex ? ex.icon + ' ' + ex.name : id}</span><strong>${reps}</strong></div>`;
  }).join('') || '<p class="muted small">No personal records yet.</p>';
  return `
  <section class="view view-awards">
    <h1>Achievements</h1>
    <div class="card pr-card"><h3>Personal records</h3>${prRows}</div>
    <h3 class="section-title">Badges (${owned.size}/${ACHIEVEMENTS.length})</h3>
    <div class="ach-list">${cards}</div>
  </section>`;
}

/** @param {import('../data/store.js').Store} store */
export function profileView(store) {
  const p = store.profile;
  const s = store.settings;
  return `
  <section class="view view-profile">
    <h1>Profile</h1>
    <div class="card form-card">
      <label>Name<input id="pfName" value="${esc(p.name)}"></label>
      <div class="form-row">
        <label>Weight (kg)<input id="pfWeight" type="number" value="${p.weightKg}"></label>
        <label>Height (cm)<input id="pfHeight" type="number" value="${p.heightCm}"></label>
        <label>Age<input id="pfAge" type="number" value="${p.age}"></label>
      </div>
      <button class="btn btn-primary" data-action="save-profile">Save</button>
    </div>
    <div class="card">
      <h3>Settings</h3>
      ${toggle('setVoice', '🔊 Voice coaching', s.voice)}
      ${toggle('setSound', '🎵 Sound effects', s.sound)}
      ${toggle('setHaptics', '📳 Haptics', s.haptics)}
      ${toggle('setAuto', '🤖 Auto-detect exercise', s.autoDetect)}
    </div>
    <div class="card history-card">
      <h3>Workout history</h3>
      <div id="historyList"></div>
    </div>
    <div class="card danger-card">
      <button class="btn btn-ghost" data-action="export-json">Export data</button>
      <button class="btn btn-danger" data-action="reset-data">Reset all data</button>
    </div>
    <p class="muted small build-info">AI Fitness Coach · runs fully on-device · MediaPipe + TensorFlow.js</p>
  </section>`;
}

/** @param {string} id @param {string} label @param {boolean} on */
function toggle(id, label, on) {
  return `<label class="toggle"><span>${label}</span>
    <input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="switch"></span></label>`;
}

export function navBar(active) {
  const items = [
    ['home', '🏠', 'Home'], ['train', '🏃', 'Train'], ['stats', '📊', 'Stats'],
    ['awards', '🏆', 'Awards'], ['profile', '👤', 'Profile'],
  ];
  return `<nav class="bottom-nav">${items.map(([v, i, l]) =>
    `<button class="nav-btn ${active === v ? 'active' : ''}" data-action="goto" data-view="${v}">
      <span class="nav-icon">${i}</span><span class="nav-label">${l}</span></button>`).join('')}</nav>`;
}
