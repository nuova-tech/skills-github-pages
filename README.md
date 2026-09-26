# 🏋️ AI Fitness Coach

A professional, AI-powered fitness application — inspired by HomeCourt, DribbleUp,
Peloton, and Nike Training Club — that uses **real-time computer vision and pose
estimation** to track workouts, coach your form, and gamify your training.

It runs **entirely in your browser, on-device** (no servers, no uploads). That's
also what makes it deployable to **GitHub Pages** with zero build step.

> Open the deployed site, allow camera access, and start a workout. Everything —
> pose estimation, rep counting, form analysis, coaching, and your data — stays
> on your device.

---

## ✨ Highlights

- **Real-time pose estimation** with [MediaPipe Pose](https://developers.google.com/mediapipe)
  (33 landmarks) at 30+ FPS, with **One Euro filtering** to kill jitter.
- **17 tracked exercises** with rep counting, range-of-motion analysis, tempo &
  time-under-tension, left/right symmetry, and depth detection.
- **AI coaching**: live voice + on-screen cues, visual correction arrows, and
  detection of common faults (knee valgus, shallow depth, sagging hips, uneven
  lunges, incomplete reps).
- **Smart exercise recognition** that auto-detects the movement in free mode.
- **Gamification**: XP & levels, ranks, performance medals (Bronze → Diamond),
  achievement badges, daily missions, streaks, confetti, sound & haptics.
- **Pro metrics**: active/rest time, calories, estimated power, stability,
  explosiveness, endurance, and an overall session score.
- **Workout modes**: Free, Guided, Circuit, HIIT, AMRAP, EMOM, Timed Challenge,
  and a Fitness Test.
- **Analytics dashboard**: progress charts, reps-by-exercise, consistency score,
  fitness-age estimate, and recovery recommendations.
- **PWA**: installable, offline-capable, mobile-first responsive UI.
- **Privacy-first**: all data is stored locally (`localStorage`); export to
  **CSV/JSON** any time.

## 🧠 Tech & Architecture

| Concern | Technology |
| --- | --- |
| Pose estimation | MediaPipe Pose (CDN, WASM) |
| ML runtime | TensorFlow.js (CDN) — available for the classifier path |
| Rendering | Canvas 2D overlay + charts (no chart library) |
| Persistence | `localStorage` (versioned schema) |
| App | Vanilla **ES modules + JSDoc types**, no bundler |

Modular, event-driven design (`assets/js/`):

```
core/        logger, event bus
pose/        landmarks/geometry, One Euro smoothing, MediaPipe engine
exercises/   configurable definitions, rep-counting state machine, recognizer
coach/       voice + text coaching, post-workout summaries
game/        XP/levels/medals/achievements/missions
data/        local persistence, history, PRs, CSV/JSON export
workout/     session orchestrator + workout modes
ui/          canvas overlay, charts, view templates, celebration effects
app.js       controller wiring it all together
```

Exercises are **data-driven** — add a new movement by appending a definition in
[`assets/js/exercises/registry.js`](assets/js/exercises/registry.js); the
rep-counting engine, coaching, and UI pick it up automatically.

## 🚀 Run locally

```bash
# any static server works; the app needs HTTPS or localhost for camera access
npm run serve         # python3 -m http.server 8080
# then open http://localhost:8080
```

## ✅ Tests

Pure-logic unit tests (geometry, smoothing, rep counting, gamification, store)
run in Node with no dependencies:

```bash
npm test
```

## 🌐 Deploy to GitHub Pages

1. Push to your default branch.
2. **Settings → Pages → Deploy from a branch**, choose the branch and `/ (root)`.
3. A `.nojekyll` file is included so the `assets/` directory is served as-is.

> Camera access requires a secure context — GitHub Pages serves over HTTPS, so
> it works out of the box.

## 📏 Tracked exercises

Squats · Push-ups · Sit-ups · Crunches · Lunges · Jumping Jacks · Burpees ·
Mountain Climbers · High Knees · Calf Raises · Tricep Dips · Step-ups ·
Skater Jumps · Russian Twists · Plank · Side Plank · Wall Sit

## ⚠️ Notes & scope

This is a polished, fully client-side foundation. Hardware/cloud-only features
from the original spec (live wearable HR sync, cloud account sync, real-time
multiplayer) are intentionally out of scope for static hosting, but the
architecture leaves clean seams for them (e.g. the `Store` API mirrors a future
sync adapter; the recognizer interface accepts a TF.js model drop-in). Pose-based
calorie/power figures are **estimates**, not medical measurements.

## 📄 License

[MIT](LICENSE)
