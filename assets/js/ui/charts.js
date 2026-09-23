/**
 * Dependency-free canvas charts for the analytics dashboard: line/area trend,
 * bar chart, and circular activity rings. Kept tiny and theme-aware.
 * @module ui/charts
 */

const ACCENT = '#ff6a00';
const ACCENT2 = '#ff9d3c';
const GRID = 'rgba(255,255,255,0.08)';
const TEXT = '#9a9aa4';

/** @param {HTMLCanvasElement} canvas */
function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}

/**
 * Area/line trend chart.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values
 * @param {{labels?:string[], color?:string}} [opts]
 */
export function lineChart(canvas, values, opts = {}) {
  const { ctx, w, h } = setup(canvas);
  const color = opts.color ?? ACCENT;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 28, r: 8, t: 12, b: 20 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  if (!values.length) { empty(ctx, w, h); return; }
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (/** @type {number} */ i) => pad.l + (values.length === 1 ? cw / 2 : (i / (values.length - 1)) * cw);
  const y = (/** @type {number} */ v) => pad.t + ch - ((v - min) / span) * ch;

  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const gy = pad.t + (g / 3) * ch;
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
  }

  // area fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
  ctx.beginPath();
  values.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.lineTo(x(values.length - 1), pad.t + ch); ctx.lineTo(x(0), pad.t + ch); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath();
  values.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

  values.forEach((v, i) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, Math.PI * 2); ctx.fill(); });

  ctx.fillStyle = TEXT; ctx.font = '10px ui-sans-serif, system-ui';
  ctx.fillText(String(Math.round(max)), 2, pad.t + 4);
  ctx.fillText(String(Math.round(min)), 2, pad.t + ch);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{label:string, value:number}[]} data
 */
export function barChart(canvas, data) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!data.length) { empty(ctx, w, h); return; }
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = cw / data.length * 0.6;
  const gap = cw / data.length;
  data.forEach((d, i) => {
    const bh = (d.value / max) * ch;
    const x = pad.l + i * gap + (gap - bw) / 2;
    const y = pad.t + ch - bh;
    const grad = ctx.createLinearGradient(0, y, 0, y + bh);
    grad.addColorStop(0, ACCENT); grad.addColorStop(1, ACCENT2);
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, bw, bh, 4); ctx.fill();
    ctx.fillStyle = TEXT; ctx.font = '9px ui-sans-serif, system-ui'; ctx.textAlign = 'center';
    ctx.fillText(d.label, x + bw / 2, h - 8);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(String(d.value), x + bw / 2, y - 3);
  });
  ctx.textAlign = 'left';
}

/**
 * Concentric activity rings (move / active / reps style).
 * @param {HTMLCanvasElement} canvas
 * @param {{value:number, goal:number, color:string}[]} rings
 */
export function activityRings(canvas, rings) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 6;
  const thickness = maxR / (rings.length + 1.2);
  rings.forEach((r, i) => {
    const radius = maxR - i * (thickness + 3);
    const pct = Math.max(0, Math.min(1, r.value / r.goal));
    ctx.lineWidth = thickness; ctx.lineCap = 'round';
    ctx.strokeStyle = r.color + '33';
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = r.color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
  });
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function empty(ctx, w, h) {
  ctx.fillStyle = TEXT; ctx.font = '12px ui-sans-serif, system-ui'; ctx.textAlign = 'center';
  ctx.fillText('No data yet — finish a workout', w / 2, h / 2);
  ctx.textAlign = 'left';
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
