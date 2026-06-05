/**
 * Application controller. Owns navigation, the live-workout pipeline (pose →
 * session → coach → gamification → UI), and the analytics views. Wires the
 * dependency-free modules together via their event buses.
 * @module app
 */

import { createLogger, setLogLevel } from './core/logger.js';
import { Store } from './data/store.js';
import { PoseEngine } from './pose/poseEngine.js';
import { OverlayRenderer } from './ui/overlay.js';
import { WorkoutSession } from './workout/session.js';
import { freePlan, circuitPlan, amrapPlan, fitnessTestPlan } from './workout/modes.js';
import { getExercise } from './exercises/registry.js';
import { ExerciseRecognizer } from './exercises/recognizer.js';
import { Coach } from './coach/coach.js';
import { Gamification, levelFromXp } from './game/gamification.js';
import { LM } from './pose/landmarks.js';
import * as views from './ui/views.js';
import * as charts from './ui/charts.js';
import { confetti, sound, haptic } from './ui/celebrate.js';

const log = createLogger('app');

class App {
  constructor() {
    this.store = new Store();
    this.pose = new PoseEngine();
    this.coach = new Coach({ voice: this.store.settings.voice });
    this.game = new Gamification(this.store);
    this.recognizer = new ExerciseRecognizer();
    sound.enabled = this.store.settings.sound;

    /** @type {string} */ this.view = 'home';
    /** @type {string} */ this.selectedMode = 'free';
    /** @type {string} */ this.selectedExercise = 'squat';
    /** @type {WorkoutSession|null} */ this.session = null;
    /** @type {OverlayRenderer|null} */ this.overlay = null;
    /** @type {string[]} */ this.currentCameras = [];
    this.cameraIdx = 0;
    /** @type {string[]} */ this.lastFaultJoints = [];
    this._unsub = [];

    this.root = /** @type {HTMLElement} */ (document.getElementById('app'));
    this.nav = /** @type {HTMLElement} */ (document.getElementById('nav'));

    this.coach.onCue = (cue) => this._showCoachBanner(cue);
    document.addEventListener('click', (e) => this._onClick(e));
    document.addEventListener('change', (e) => this._onChange(e));
    window.addEventListener('resize', () => this._resizeOverlay());
  }

  start() {
    setLogLevel('info');
    this.render('home');
    log.info('app ready');
  }

  /** @param {string} view */
  render(view) {
    if (view !== 'live') this._teardownWorkout();
    this.view = view;
    const map = {
      home: () => views.homeView(this.store),
      train: () => views.trainView(this.store),
      stats: () => views.statsView(this.store),
      awards: () => views.awardsView(this.store),
      profile: () => views.profileView(this.store),
    };
    this.root.innerHTML = (map[view] || map.home)();
    this.nav.innerHTML = view === 'live' ? '' : views.navBar(view);
    this.nav.hidden = view === 'live';

    if (view === 'home') this._afterHome();
    if (view === 'stats') this._afterStats();
    if (view === 'profile') this._afterProfile();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- events
  /** @param {MouseEvent} e */
  _onClick(e) {
    const btn = /** @type {HTMLElement} */ (e.target instanceof HTMLElement ? e.target.closest('[data-action]') : null);
    if (!btn) return;
    const a = btn.dataset.action;
    const d = btn.dataset;
    const actions = {
      goto: () => this.render(d.view),
      quickstart: () => { this.selectedMode = 'free'; this.selectedExercise = d.ex; this._startWorkout(); },
      'pick-mode': () => this._pickMode(d.mode),
      'pick-exercise': () => { this.selectedMode = this.selectedMode || 'free'; this.selectedExercise = d.ex; this._startWorkout(); },
      'end-workout': () => { this._teardownWorkout(); this.render('home'); },
      'finish-workout': () => this._finishWorkout(),
      'toggle-voice': () => this._toggleVoice(),
      'switch-camera': () => this._switchCamera(),
      'export-csv': () => this._download('workouts.csv', this.store.exportCSV(), 'text/csv'),
      'export-json': () => this._download('aifit-data.json', this.store.exportJSON(), 'application/json'),
      'save-profile': () => this._saveProfile(),
      'reset-data': () => this._resetData(),
      'share-summary': () => this._share(),
    };
    if (actions[a]) { e.preventDefault(); actions[a](); }
  }

  /** @param {Event} e */
  _onChange(e) {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (!t.id) return;
    const map = {
      setVoice: () => { this.store.updateSettings({ voice: t.checked }); this.coach.setVoice(t.checked); },
      setSound: () => { this.store.updateSettings({ sound: t.checked }); sound.enabled = t.checked; },
      setHaptics: () => this.store.updateSettings({ haptics: t.checked }),
      setAuto: () => this.store.updateSettings({ autoDetect: t.checked }),
    };
    if (map[t.id]) map[t.id]();
  }

  // ---------------------------------------------------------------- home
  _afterHome() {
    const ringsEl = /** @type {HTMLCanvasElement} */ (document.getElementById('homeRings'));
    if (ringsEl) {
      const today = this.store.workouts.filter((w) => sameDay(w.date, Date.now()));
      const reps = today.reduce((s, w) => s + w.totalReps, 0);
      const minutes = Math.round(today.reduce((s, w) => s + w.durationMs, 0) / 60000);
      const cals = Math.round(today.reduce((s, w) => s + w.calories, 0));
      charts.activityRings(ringsEl, [
        { value: reps, goal: 50, color: '#22d3ee' },
        { value: minutes, goal: 20, color: '#a78bfa' },
        { value: cals, goal: 200, color: '#f43f5e' },
      ]);
    }
    const list = document.getElementById('missionList');
    if (list) {
      const missions = this.game.dailyMissions();
      list.innerHTML = missions.map((m) => `
        <div class="card mission ${m.progress.done ? 'done' : ''}">
          <div class="mission-top"><span>${m.label}</span><span class="muted small">+${m.xp} XP</span></div>
          <div class="progress"><div class="progress-fill" style="width:${m.progress.pct}%"></div></div>
          <span class="muted small">${m.progress.value}/${m.goal}${m.progress.done ? ' ✓' : ''}</span>
        </div>`).join('');
    }
  }

  // ---------------------------------------------------------------- train
  /** @param {string} mode */
  _pickMode(mode) {
    this.selectedMode = mode;
    if (mode === 'test') { this._startWorkout(); return; }
    if (mode === 'circuit' || mode === 'hiit') { this.selectedExercise = 'squat'; this._startWorkout(); return; }
    // For other modes, prompt exercise selection by scrolling to the grid.
    const grid = document.querySelector('.ex-grid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth' });
    this._toast(`Pick an exercise to start a ${mode.toUpperCase()} workout`);
  }

  // ---------------------------------------------------------------- workout
  _buildPlan() {
    switch (this.selectedMode) {
      case 'circuit': return circuitPlan(['squat', 'pushup', 'lunge', 'jumpingjack'], { reps: 12, rounds: 3 });
      case 'hiit': return circuitPlan(['jumpingjack', 'highknees', 'mountainclimber', 'burpee'], { reps: 20, rounds: 4, restMs: 10000 });
      case 'amrap': return amrapPlan(this.selectedExercise, 5);
      case 'test': return fitnessTestPlan();
      default: return freePlan(this.selectedExercise);
    }
  }

  async _startWorkout() {
    const plan = this._buildPlan();
    const ex = getExercise(plan.stages[0].exerciseId);
    const autoDetect = this.selectedMode === 'free' && this.store.settings.autoDetect;
    this.view = 'live';
    this.root.innerHTML = views.liveView(ex, this.selectedMode, autoDetect);
    this.nav.hidden = true; this.nav.innerHTML = '';

    const video = /** @type {HTMLVideoElement} */ (document.getElementById('cam'));
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('overlay'));
    this.overlay = new OverlayRenderer(canvas);
    this.recognizer.reset();
    this.lastFaultJoints = [];

    this.session = new WorkoutSession({ mode: this.selectedMode, stages: plan.stages, weightKg: this.store.profile.weightKg });
    this._wireSession(autoDetect);

    try {
      this.currentCameras = (await this.pose.listCameras()).map((c) => c.deviceId);
      await this.pose.start(video, { facingMode: 'user' });
      video.addEventListener('loadedmetadata', () => this._resizeOverlay(), { once: true });
      this._resizeOverlay();
      this._wirePose(autoDetect);

      // Calibrate, then begin.
      const calib = await this.pose.calibrate({ frames: 15, timeoutMs: 7000 });
      const msg = document.getElementById('calibMsg');
      if (msg) msg.textContent = calib.message;
      setTimeout(() => {
        const ov = document.getElementById('calibOverlay');
        if (ov) ov.classList.add('hide');
        this.session?.start();
        this.coach.say(`Let's go. ${ex.cues[0]}.`, { force: true });
      }, 900);
    } catch (err) {
      log.error('failed to start workout', err);
      this._cameraError(err);
    }
  }

  /** @param {boolean} autoDetect */
  _wirePose(autoDetect) {
    this._unsub.push(this.pose.bus.on('pose', (frame) => {
      if (!this.overlay || !this.session) return;
      this.session.onFrame(frame);
      if (autoDetect) {
        this.recognizer.feed(frame.landmarks);
        const guess = this.recognizer.best();
        if (guess && guess.confidence > 0.6 && guess.id !== this.session.currentStage.exerciseId) {
          this.session.switchExercise(guess.id);
        }
      }
      const ex = this.session.currentExercise;
      const hud = {
        angles: this._anglesFor(ex),
        faultJoints: this.lastFaultJoints,
        progress: this._repProgress(ex),
      };
      this.overlay.draw(frame, hud);
    }));

    this._unsub.push(this.pose.bus.on('fps', (fps) => {
      const el = document.getElementById('fps'); if (el) el.textContent = String(fps);
    }));

    this._unsub.push(this.pose.bus.on('status', (s) => {
      const el = document.getElementById('hudStatus');
      if (!el) return;
      if (s.state === 'no-user') { el.textContent = '⏸ ' + (s.detail || 'Paused'); el.classList.add('warn'); }
      else if (s.state === 'running') { el.textContent = ''; el.classList.remove('warn'); }
      else el.textContent = s.detail || s.state;
    }));
  }

  /** @param {boolean} autoDetect */
  _wireSession(autoDetect) {
    const s = this.session; if (!s) return;
    this._unsub.push(s.bus.on('rep', ({ rep, total }) => {
      const rc = document.getElementById('repCount'); if (rc) { rc.textContent = String(rep.index); rc.classList.remove('pop'); void rc.offsetWidth; rc.classList.add('pop'); }
      sound.rep();
      haptic(30, this.store.settings.haptics);
      this.coach.onRep(rep, total);
    }));

    this._unsub.push(s.bus.on('hold', ({ holdMs, valid }) => {
      const rc = document.getElementById('repCount');
      const rl = document.getElementById('repLabel');
      if (rc) rc.textContent = (holdMs / 1000).toFixed(1);
      if (rl) rl.textContent = valid ? 'seconds held' : 'hold position';
    }));

    this._unsub.push(s.bus.on('form', ({ faults, faultJoints }) => {
      this.lastFaultJoints = faultJoints;
      if (faults.length) { this.coach.say(faults[0], { key: faults[0], severity: 'warn' }); sound.fault(); }
    }));

    this._unsub.push(s.bus.on('stage', ({ stage }) => {
      const ex = getExercise(stage.exerciseId);
      const nameEl = document.getElementById('hudExName');
      if (nameEl) nameEl.textContent = ex.name;
      this.coach.say(`Next: ${ex.name}. ${ex.cues[0]}.`, { force: true });
    }));

    this._unsub.push(s.bus.on('tick', ({ metrics }) => this._updateMetrics(metrics)));
    this._unsub.push(s.bus.on('finish', (summary) => this._onSessionFinish(summary)));
  }

  /** @param {import('./workout/session.js').LiveMetrics} m */
  _updateMetrics(m) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('mTime', fmtClock(m.activeMs));
    set('mCal', String(Math.round(m.calories)));
    set('mStab', String(m.stability));
    if (this.session) {
      const t = this.session.tallies.get(this.session.currentExercise.id);
      set('mForm', `${t?.avgForm || 100}%`);
    }
  }

  /** @param {import('./exercises/registry.js').ExerciseDef} ex */
  _anglesFor(ex) {
    if (ex.category === 'upper') {
      return [[LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST], [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST]];
    }
    if (ex.category === 'core') {
      return [[LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE]];
    }
    return [[LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE], [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE]];
  }

  /** Progress 0..1 through the current rep based on the live metric. @param {import('./exercises/registry.js').ExerciseDef} ex */
  _repProgress(ex) {
    if (!this.session?.counter || !ex.romRange) return 0;
    const [worst, best] = ex.romRange;
    const v = this.session.counter.lastVal;
    return Math.max(0, Math.min(1, (v - worst) / (best - worst)));
  }

  _finishWorkout() { this.session?.finish(); }

  /** @param {import('./workout/session.js').SessionSummary} summary */
  _onSessionFinish(summary) {
    this.pose.stop();
    sound.finish();
    const reward = this.game.awardWorkout(summary);
    /** @type {import('./data/store.js').WorkoutRecord} */
    const rec = {
      id: 'w' + Date.now(), date: Date.now(), durationMs: summary.durationMs,
      totalReps: summary.totalReps, calories: summary.calories, avgFormScore: summary.avgFormScore,
      xpEarned: reward.xpEarned, mode: summary.mode,
      exercises: summary.exercises.map((e) => ({ id: e.id, name: e.name, reps: e.reps, avgRom: e.avgRom, avgForm: e.avgForm, bestSymmetry: e.bestSymmetry, holdMs: e.holdMs })),
    };
    this.store.addWorkout(rec);
    // re-check achievements now that the workout is persisted
    const lateUnlocks = this.game._checkAchievements();
    reward.unlocked = [...reward.unlocked, ...lateUnlocks];

    const coachSummary = this.coach.summarize(summary);
    this._teardownPose();
    this.view = 'live';
    this.root.innerHTML = views.summaryView(summary, reward, coachSummary);
    this.nav.hidden = false; this.nav.innerHTML = views.navBar('home');

    confetti({ count: reward.leveledUp ? 200 : 120 });
    if (reward.leveledUp) { sound.levelUp(); haptic([0, 60, 40, 60], this.store.settings.haptics); }
    if (reward.unlocked.length) { sound.achievement(); reward.unlocked.forEach((a, i) => setTimeout(() => this._toast(`${a.icon} ${a.name} unlocked!`), 600 + i * 800)); }
    this._lastSummary = { summary, reward };
  }

  // ---------------------------------------------------------------- stats
  _afterStats() {
    const w = this.store.workouts.slice(0, 12).reverse();
    const repsCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('chartReps'));
    const formCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('chartForm'));
    const exCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('chartByEx'));
    if (repsCanvas) charts.lineChart(repsCanvas, w.map((x) => x.totalReps), { color: '#22d3ee' });
    if (formCanvas) charts.lineChart(formCanvas, w.map((x) => x.avgFormScore), { color: '#a78bfa' });
    if (exCanvas) {
      /** @type {Record<string, number>} */ const byEx = {};
      for (const wk of this.store.workouts) for (const e of wk.exercises) byEx[e.name] = (byEx[e.name] || 0) + e.reps;
      const data = Object.entries(byEx).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label: label.split(' ')[0], value }));
      charts.barChart(exCanvas, data);
    }
    this._renderAnalytics();
  }

  _renderAnalytics() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const wk = this.store.workouts;
    // consistency: workouts in last 14 days vs target of 8
    const recent = wk.filter((x) => Date.now() - x.date < 14 * 86400000).length;
    const consistency = Math.min(100, Math.round((recent / 8) * 100));
    set('consistency', `${consistency}%`);
    // fitness age: based on avg form + endurance vs profile age
    const age = this.store.profile.age;
    const avgForm = wk.length ? wk.slice(0, 8).reduce((s, x) => s + x.avgFormScore, 0) / Math.min(8, wk.length) : 60;
    const fitAge = Math.max(16, Math.round(age - (avgForm - 70) / 5 - consistency / 20));
    set('fitAge', wk.length ? String(fitAge) : '–');
    const rec = document.getElementById('recoveryMsg');
    if (rec && wk.length) {
      const lastT = wk[0].date;
      const hrs = Math.round((Date.now() - lastT) / 3600000);
      rec.textContent = hrs < 12
        ? 'Recent intense session — prioritise hydration, protein, and 7–9h sleep before training the same muscles.'
        : 'You look recovered. A balanced session today is a good idea. Warm up first.';
    }
  }

  // ---------------------------------------------------------------- profile
  _afterProfile() {
    const list = document.getElementById('historyList');
    if (!list) return;
    if (!this.store.workouts.length) { list.innerHTML = '<p class="muted small">No workouts yet.</p>'; return; }
    list.innerHTML = this.store.workouts.slice(0, 20).map((w) => `
      <div class="history-row">
        <div><strong>${new Date(w.date).toLocaleDateString()}</strong><span class="muted small"> · ${w.mode}</span></div>
        <div class="muted small">${w.totalReps} reps · ${w.avgFormScore}% form · +${w.xpEarned} XP</div>
      </div>`).join('');
  }

  _saveProfile() {
    const get = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
    this.store.updateProfile({
      name: get('pfName').value || 'Athlete',
      weightKg: Number(get('pfWeight').value) || 70,
      heightCm: Number(get('pfHeight').value) || 175,
      age: Number(get('pfAge').value) || 30,
    });
    this._toast('Profile saved');
  }

  _resetData() {
    if (confirm('Erase all profile data, workouts, and achievements? This cannot be undone.')) {
      this.store.reset(); this.render('home'); this._toast('All data reset');
    }
  }

  // ---------------------------------------------------------------- helpers
  _toggleVoice() {
    const on = !this.coach.voiceEnabled;
    this.coach.setVoice(on);
    this.store.updateSettings({ voice: on });
    const el = document.getElementById('voiceLabel');
    if (el) el.textContent = on ? '🔊 Voice' : '🔇 Muted';
  }

  async _switchCamera() {
    if (this.currentCameras.length < 2) { this._toast('No other camera found'); return; }
    this.cameraIdx = (this.cameraIdx + 1) % this.currentCameras.length;
    const video = /** @type {HTMLVideoElement} */ (document.getElementById('cam'));
    try {
      this.pose.stop();
      await this.pose.start(video, { deviceId: this.currentCameras[this.cameraIdx] });
      this._resizeOverlay();
    } catch (err) { this._cameraError(err); }
  }

  _resizeOverlay() {
    const stage = document.getElementById('stage');
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('overlay'));
    if (!stage || !canvas || !this.overlay) return;
    this.overlay.resize(stage.clientWidth, stage.clientHeight);
  }

  /** @param {{text:string, severity:string}} cue */
  _showCoachBanner(cue) {
    const el = document.getElementById('coachBanner');
    if (!el) return;
    el.textContent = cue.text;
    el.className = `coach-banner show ${cue.severity}`;
    el.hidden = false;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { el.classList.remove('show'); }, 2600);
  }

  _cameraError(err) {
    const ov = document.getElementById('calibOverlay');
    if (ov) ov.innerHTML = `<div class="calib-card"><h3>Camera unavailable</h3>
      <p class="muted">${err && err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow access and try again.' : 'Could not access a camera. Check that one is connected and not in use.'}</p>
      <button class="btn btn-primary" data-action="goto" data-view="train">Back</button></div>`;
  }

  async _share() {
    if (!this._lastSummary) return;
    const { summary } = this._lastSummary;
    const text = `I just crushed a workout on AI Fitness Coach! 💪\n${summary.totalReps} reps · ${summary.avgFormScore}% form · ${Math.round(summary.calories)} kcal · ${summary.overallScore}/100 overall`;
    try {
      if (navigator.share) await navigator.share({ title: 'AI Fitness Coach', text });
      else { await navigator.clipboard.writeText(text); this._toast('Summary copied to clipboard'); }
    } catch { /* user cancelled */ }
  }

  /** @param {string} filename @param {string} content @param {string} type */
  _download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this._toast(`Exported ${filename}`);
  }

  /** @param {string} msg */
  _toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2400);
  }

  _teardownPose() {
    for (const off of this._unsub) off();
    this._unsub = [];
  }

  _teardownWorkout() {
    this._teardownPose();
    if (this.pose.running || this.pose.stream) this.pose.stop();
    this.coach.cancel();
    this.session = null;
    this.overlay = null;
  }
}

/** @param {number} ms */
function fmtClock(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** @param {number} a @param {number} b */
function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

const app = new App();
app.start();
// expose for debugging / e2e
/** @type {any} */ (window).__app = app;
