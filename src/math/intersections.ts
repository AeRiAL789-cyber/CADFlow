// src/math/intersections.ts
//
// Pure 2D intersection primitives for the Trim / Offset engines.
// Everything operates on {x,y}; callers pass Point3 freely (z is ignored here).
// No allocation beyond the returned hit objects, no external dependencies.

import type { Point2 } from '../types/cad';

export const EPS = 1e-9;

export interface SegHit {
  point: Point2;
  /** Parameter along the first segment a1→a2, in [0,1]. */
  t: number;
  /** Parameter along the second segment b1→b2, in [0,1]. */
  u: number;
}

const x = (p: Point2) => p.x;
const y = (p: Point2) => p.y;

/**
 * Segment ∩ segment. Returns the crossing point with both parameters, or null
 * when parallel/non-overlapping. `bounded` (default true) clamps the hit to the
 * extent of both segments; pass false to treat the second pair as an infinite
 * cutting line while keeping the first bounded.
 */
export function segmentSegment(
  a1: Point2, a2: Point2, b1: Point2, b2: Point2,
  bounded = true,
): SegHit | null {
  const dax = x(a2) - x(a1), day = y(a2) - y(a1);
  const dbx = x(b2) - x(b1), dby = y(b2) - y(b1);

  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < EPS) return null; // parallel or degenerate

  const rx = x(b1) - x(a1), ry = y(b1) - y(a1);
  const t = (rx * dby - ry * dbx) / denom;
  const u = (rx * day - ry * dax) / denom;

  if (t < -EPS || t > 1 + EPS) return null;
  if (bounded && (u < -EPS || u > 1 + EPS)) return null;

  return { point: { x: x(a1) + t * dax, y: y(a1) + t * day }, t, u };
}

/**
 * Segment ∩ circle. Returns 0–2 hits ordered by ascending t along a1→a2,
 * each carrying the parameter t in [0,1].
 */
export function segmentCircle(
  a1: Point2, a2: Point2, center: Point2, radius: number,
): { point: Point2; t: number }[] {
  const dx = x(a2) - x(a1), dy = y(a2) - y(a1);
  const fx = x(a1) - x(center), fy = y(a1) - y(center);

  const a = dx * dx + dy * dy;
  if (a < EPS) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  disc = Math.sqrt(disc);

  const out: { point: Point2; t: number }[] = [];
  for (const t of [(-b - disc) / (2 * a), (-b + disc) / (2 * a)]) {
    if (t < -EPS || t > 1 + EPS) continue;
    out.push({ point: { x: x(a1) + t * dx, y: y(a1) + t * dy }, t });
  }
  return out.sort((p, q) => p.t - q.t);
}

/**
 * Circle ∩ circle. Returns 0 (separate/contained/concentric), 1 (tangent),
 * or 2 intersection points. Pure radical-line solution.
 */
export function circleCircle(c1: Point2, r1: number, c2: Point2, r2: number): Point2[] {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS) return [];                              // concentric
  if (d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return []; // disjoint / nested

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const xm = c1.x + (a * dx) / d, ym = c1.y + (a * dy) / d;
  if (h < EPS) return [{ x: xm, y: ym }];              // tangent

  const ox = (-dy / d) * h, oy = (dx / d) * h;
  return [{ x: xm + ox, y: ym + oy }, { x: xm - ox, y: ym - oy }];
}

/**
 * Project p onto the (infinite) line through a→b and return the clamped
 * parameter in [0,1]. Used to locate a raycast hit along a trim target.
 */
export function paramOnSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = x(b) - x(a), dy = y(b) - y(a);
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return 0;
  const t = ((x(p) - x(a)) * dx + (y(p) - y(a)) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

/** Point at parameter t along a→b. */
export function pointAt(a: Point2, b: Point2, t: number): Point2 {
  return { x: x(a) + (x(b) - x(a)) * t, y: y(a) + (y(b) - y(a)) * t };
}

/**
 * Given a target segment a→b, the sorted cut parameters along it, and the
 * parameter under the cursor, return the sub-spans to KEEP (the span containing
 * the cursor is dropped). Endpoints 0 and 1 always bound the result.
 */
export function keptSpansAfterTrim(
  cuts: number[], hitT: number,
): { t0: number; t1: number }[] {
  const breaks = Array.from(new Set([0, 1, ...cuts]))
    .filter((t) => t > -EPS && t < 1 + EPS)
    .sort((p, q) => p - q);

  const spans: { t0: number; t1: number }[] = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const t0 = breaks[i], t1 = breaks[i + 1];
    if (t1 - t0 < 1e-6) continue;                 // ignore zero-length slivers
    if (hitT >= t0 - EPS && hitT <= t1 + EPS) continue; // the span under the cursor
    spans.push({ t0, t1 });
  }
  return spans;
}
