/**
 * Canvas overlay renderer drawn on top of the camera feed: skeleton, joint
 * angle readouts, motion trails, live correction arrows, and a rep progress
 * bar. Coordinates are normalized [0..1] and scaled to the canvas; the video is
 * mirrored, so we mirror here too for a natural "mirror" experience.
 * @module ui/overlay
 */

import { POSE_CONNECTIONS, LM, angleDeg } from '../pose/landmarks.js';

const GOOD = '#22d3ee';
const BONE = '#e2e8f0';
const WARN = '#f43f5e';
const JOINT = '#a78bfa';

export class OverlayRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    /** @type {Array<{x:number,y:number,t:number}>} trail of a tracked point */
    this.trail = [];
    this.showSkeleton = true;
    this.showAngles = true;
    this.showTrail = true;
    /** @type {number} landmark index to trail (e.g. wrist) */
    this.trailPoint = LM.RIGHT_WRIST;
  }

  /** @param {number} w @param {number} h */
  resize(w, h) { this.canvas.width = w; this.canvas.height = h; }

  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  /**
   * @param {import('../pose/poseEngine.js').PoseFrame} frame
   * @param {{arrows?:Array<{from:number,to:number}>, faultJoints?:number[], progress?:number, angles?:Array<[number,number,number]>}} [hud]
   */
  draw(frame, hud = {}) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W, 0); ctx.scale(-1, 1); // mirror to match selfie view

    const lm = frame.landmarks;
    const px = (/** @type {number} */ x) => x * W;
    const py = (/** @type {number} */ y) => y * H;
    const faults = new Set(hud.faultJoints ?? []);

    if (this.showSkeleton) {
      ctx.lineWidth = Math.max(3, W * 0.005);
      ctx.lineCap = 'round';
      for (const [a, b] of POSE_CONNECTIONS) {
        const pa = lm[a], pb = lm[b];
        if (!pa || !pb || pa.visibility < 0.4 || pb.visibility < 0.4) continue;
        ctx.strokeStyle = (faults.has(a) || faults.has(b)) ? WARN : BONE;
        ctx.beginPath();
        ctx.moveTo(px(pa.x), py(pa.y));
        ctx.lineTo(px(pb.x), py(pb.y));
        ctx.stroke();
      }
      for (let i = 0; i < lm.length; i++) {
        const p = lm[i];
        if (!p || p.visibility < 0.4) continue;
        if (i <= 10) continue; // skip dense face points for clarity
        ctx.fillStyle = faults.has(i) ? WARN : JOINT;
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.y), Math.max(4, W * 0.006), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Motion trail of the tracked point.
    if (this.showTrail) {
      const tp = lm[this.trailPoint];
      if (tp && tp.visibility > 0.5) {
        this.trail.push({ x: tp.x, y: tp.y, t: frame.tMs });
        while (this.trail.length && frame.tMs - this.trail[0].t > 700) this.trail.shift();
      }
      if (this.trail.length > 1) {
        ctx.lineWidth = Math.max(2, W * 0.004);
        for (let i = 1; i < this.trail.length; i++) {
          const a = this.trail[i - 1], b = this.trail[i];
          ctx.strokeStyle = `rgba(34,211,238,${i / this.trail.length})`;
          ctx.beginPath();
          ctx.moveTo(px(a.x), py(a.y));
          ctx.lineTo(px(b.x), py(b.y));
          ctx.stroke();
        }
      }
    }

    // Joint angle readouts.
    if (this.showAngles && hud.angles) {
      ctx.font = `${Math.max(12, W * 0.018)}px ui-sans-serif, system-ui`;
      for (const [a, b, c] of hud.angles) {
        const va = lm[a], vb = lm[b], vc = lm[c];
        if (!va || !vb || !vc || vb.visibility < 0.5) continue;
        const ang = Math.round(angleDeg(va, vb, vc));
        // un-mirror text by drawing in mirrored space then flipping the glyphs
        ctx.save();
        ctx.translate(px(vb.x), py(vb.y));
        ctx.scale(-1, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(6, -10, 38, 20);
        ctx.fillStyle = GOOD;
        ctx.fillText(`${ang}°`, 9, 5);
        ctx.restore();
      }
    }

    // Correction arrows showing how to fix form.
    if (hud.arrows) {
      ctx.strokeStyle = WARN; ctx.fillStyle = WARN;
      ctx.lineWidth = Math.max(4, W * 0.006);
      for (const ar of hud.arrows) {
        const from = lm[ar.from], to = lm[ar.to];
        if (!from || !to) continue;
        this._arrow(px(from.x), py(from.y), px(to.x), py(to.y));
      }
    }

    ctx.restore();

    // Rep progress bar (drawn un-mirrored, screen space).
    if (typeof hud.progress === 'number') {
      const p = Math.max(0, Math.min(1, hud.progress));
      const barW = W * 0.5, barH = Math.max(8, H * 0.012);
      const x = (W - barW) / 2, y = H - barH - 16;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      this._roundRect(x, y, barW, barH, barH / 2); ctx.fill();
      ctx.fillStyle = GOOD;
      this._roundRect(x, y, barW * p, barH, barH / 2); ctx.fill();
    }
  }

  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  _arrow(x1, y1, x2, y2) {
    const { ctx } = this;
    const head = 14;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill();
  }

  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
  _roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
