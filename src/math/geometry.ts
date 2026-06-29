// src/math/geometry.ts
import type { Point2, Point3 } from '../types/cad';

export const EPS = 1e-9;

export const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Point2, s: number): Point2 => ({ x: a.x * s, y: a.y * s });

export const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;

export const len = (a: Point2): number => Math.hypot(a.x, a.y);
export const dist = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a: Point2, b: Point2, t: number): Point2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const mid = (a: Point2, b: Point2): Point2 => lerp(a, b, 0.5);

/** True when two points coincide within tolerance. */
export const near = (a: Point2, b: Point2, tol: number): boolean => dist(a, b) <= tol;

/** Perpendicular distance from p to the infinite line through a→b. */
export function distToLine(p: Point2, a: Point2, b: Point2): number {
  const ab = sub(b, a);
  const L = len(ab);
  if (L < EPS) return dist(p, a);
  return Math.abs(cross(ab, sub(p, a))) / L;
}

/** Closest point on segment a→b to p, clamped to the segment ends. */
export function closestOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  if (L2 < EPS) return { ...a };
  let t = dot(sub(p, a), ab) / L2;
  t = Math.max(0, Math.min(1, t));
  return add(a, scale(ab, t));
}

/**
 * Fit a circle to >=3 points via Kåsa algebraic least squares.
 * Robust, allocation-light, and good enough to seed an arc reconstruction;
 * returns null for near-collinear clusters (singular normal matrix).
 */
export function fitCircle(points: Point2[]): { center: Point2; radius: number; rms: number } | null {
  const n = points.length;
  if (n < 3) return null;

  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const cx0 = sx / n, cy0 = sy / n; // centroid-shift for numerical stability

  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of points) {
    const u = p.x - cx0, v = p.y - cy0;
    const uu = u * u, vv = v * v;
    Suu += uu; Svv += vv; Suv += u * v;
    Suuu += uu * u; Svvv += vv * v;
    Suvv += u * vv; Svuu += v * uu;
  }

  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < EPS) return null;

  const b1 = 0.5 * (Suuu + Suvv);
  const b2 = 0.5 * (Svvv + Svuu);
  const uc = (b1 * Svv - b2 * Suv) / det;
  const vc = (b2 * Suu - b1 * Suv) / det;

  const center = { x: uc + cx0, y: vc + cy0 };
  const radius = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);

  let err = 0;
  for (const p of points) {
    const d = dist(p, center) - radius;
    err += d * d;
  }
  return { center, radius, rms: Math.sqrt(err / n) };
}

export const angleOf = (c: Point2, p: Point2): number => Math.atan2(p.y - c.y, p.x - c.x);

/** Total absolute turning across a vertex list — distinguishes arcs from straight runs. */
export function totalTurning(points: Point2[]): number {
  let turn = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = sub(points[i], points[i - 1]);
    const b = sub(points[i + 1], points[i]);
    if (len(a) < EPS || len(b) < EPS) continue;
    turn += Math.abs(Math.atan2(cross(a, b), dot(a, b)));
  }
  return turn;
}

export const to3 = (p: Point2, z = 0): Point3 => ({ x: p.x, y: p.y, z });
