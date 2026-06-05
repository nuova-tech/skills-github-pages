/**
 * MediaPipe Pose landmark indices, skeleton topology, and geometry helpers.
 * All angle math works on normalized [0..1] landmark coordinates; because we
 * use angles (ratios) rather than pixel distances, results are resolution- and
 * aspect-independent which keeps rep counting stable across cameras.
 * @module pose/landmarks
 */

/** @typedef {{x:number,y:number,z:number,visibility:number}} Landmark */

/** The 33 MediaPipe Pose landmarks, by name. */
export const LM = /** @type {const} */ ({
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
});

/** Bone connections for drawing the skeleton overlay. */
export const POSE_CONNECTIONS = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP], [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE], [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE], [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL], [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL], [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
];

/**
 * Interior angle ABC (at vertex B) in degrees.
 * @param {Landmark} a @param {Landmark} b @param {Landmark} c
 * @returns {number} 0..180
 */
export function angleDeg(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return 180;
  let cos = dot / (magAb * magCb);
  cos = Math.min(1, Math.max(-1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle of segment AB measured from the positive x-axis, in degrees (-180..180).
 * Useful for "is the torso horizontal" checks.
 * @param {Landmark} a @param {Landmark} b
 */
export function segmentAngleDeg(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Euclidean distance in normalized space. @param {Landmark} a @param {Landmark} b */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of two landmarks. @param {Landmark} a @param {Landmark} b @returns {Landmark} */
export function mid(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

/**
 * Whether the listed landmarks are all confidently visible.
 * @param {Landmark[]} landmarks
 * @param {number[]} indices
 * @param {number} [minVis]
 */
export function visible(landmarks, indices, minVis = 0.5) {
  return indices.every((i) => landmarks[i] && landmarks[i].visibility >= minVis);
}

/**
 * Average visibility across given indices — used as a per-frame quality signal.
 * @param {Landmark[]} landmarks @param {number[]} indices
 */
export function avgVisibility(landmarks, indices) {
  if (!indices.length) return 0;
  let s = 0;
  for (const i of indices) s += landmarks[i]?.visibility ?? 0;
  return s / indices.length;
}
