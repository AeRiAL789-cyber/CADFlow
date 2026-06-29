// src/math/selection.ts
//
// Pure window/crossing selection tests for directional marquee selection.
// Window (blue, L→R): an entity is selected only if it lies 100% inside the box.
// Crossing (green, R→L): selected if it is inside OR touches the box.

import type { CadDocument, CadEntity, Point2 } from '../types/cad';
import { segmentSegment } from './intersections';

export interface Rect { minX: number; minY: number; maxX: number; maxY: number; }

export function rectFrom(a: Point2, b: Point2): Rect {
  return {
    minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y),
  };
}

const inRect = (p: Point2, r: Rect) =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

const rectsOverlap = (a: Rect, b: Rect) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Defining vertices of an entity (for containment testing). */
function pointsOf(e: CadEntity): Point2[] {
  switch (e.type) {
    case 'line':      return [e.start, e.end];
    case 'polyline':  return e.vertices;
    case 'circle':
    case 'arc':       return [
      { x: e.center.x - e.radius, y: e.center.y - e.radius },
      { x: e.center.x + e.radius, y: e.center.y + e.radius },
    ];
    case 'text':      return [e.position];
    case 'dimension': return [e.a, e.b];
  }
}

/** Straight segments of an entity (for crossing-edge testing). */
function segmentsOf(e: CadEntity): [Point2, Point2][] {
  switch (e.type) {
    case 'line':      return [[e.start, e.end]];
    case 'dimension': return [[e.a, e.b]];
    case 'polyline': {
      const segs: [Point2, Point2][] = [];
      const n = e.vertices.length;
      for (let i = 0; i < n - 1; i++) segs.push([e.vertices[i], e.vertices[i + 1]]);
      if (e.closed && n > 2) segs.push([e.vertices[n - 1], e.vertices[0]]);
      return segs;
    }
    default: return []; // circles/arcs/text fall back to bbox overlap
  }
}

function bboxOf(e: CadEntity): Rect {
  const pts = pointsOf(e);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function segCrossesRect(a: Point2, b: Point2, r: Rect): boolean {
  const corners: Point2[] = [
    { x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentSegment(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

export function selectIdsInRect(doc: CadDocument, a: Point2, b: Point2, crossing: boolean): string[] {
  const rect = rectFrom(a, b);
  const ids: string[] = [];

  for (const e of doc.entities) {
    if (doc.layers.find((l) => l.id === e.layerId)?.visible === false) continue;
    const pts = pointsOf(e);

    if (!crossing) {
      // Window: every defining point inside the box.
      if (pts.every((p) => inRect(p, rect))) ids.push(e.id);
      continue;
    }

    // Crossing: a point inside, an edge crossing the box, or (for shapes
    // without explicit edges) overlapping bounding boxes.
    const segs = segmentsOf(e);
    const hit =
      pts.some((p) => inRect(p, rect)) ||
      segs.some(([p, q]) => segCrossesRect(p, q, rect)) ||
      (segs.length === 0 && rectsOverlap(bboxOf(e), rect));
    if (hit) ids.push(e.id);
  }
  return ids;
}
