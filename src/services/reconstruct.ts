// src/services/reconstruct.ts
import type { CadEntity, LineEntity, Point3 } from '../types/cad';
import {
  dist, fitCircle, angleOf, totalTurning, to3, near,
} from '../math/geometry';

let _id = 0;
const nid = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(_id++).toString(36)}`;

export interface ReconstructOptions {
  /** Vertices closer than this are treated as the same point (document units, e.g. mm). */
  weldTolerance: number;     // default 0.05
  /** Max RMS chord deviation allowed for an arc/circle fit (document units). */
  arcRmsTolerance: number;   // default 0.05
  /** Minimum segments in a chain before arc detection is attempted. */
  minArcSegments: number;    // default 4
}

export const DEFAULT_RECONSTRUCT: ReconstructOptions = {
  weldTolerance: 0.05,
  arcRmsTolerance: 0.05,
  minArcSegments: 4,
};

interface Chain {
  vertices: Point3[];
  layerId: string;
  closed: boolean;
}

/**
 * Stage 1 — healing.
 * Greedily chain LINE entities whose endpoints coincide within weldTolerance
 * into ordered vertex runs. Each line is consumed once; chains may extend from
 * either end. Non-line entities pass through untouched.
 */
function chainSegments(lines: LineEntity[], tol: number): Chain[] {
  const used = new Array(lines.length).fill(false);
  const chains: Chain[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const seed = lines[i];
    const verts: Point3[] = [seed.start, seed.end];
    const layerId = seed.layerId;

    let extended = true;
    while (extended) {
      extended = false;
      const head = verts[0];
      const tail = verts[verts.length - 1];

      for (let j = 0; j < lines.length; j++) {
        if (used[j] || lines[j].layerId !== layerId) continue;
        const { start, end } = lines[j];

        if (near(tail, start, tol))      { verts.push(end);   used[j] = true; extended = true; }
        else if (near(tail, end, tol))   { verts.push(start); used[j] = true; extended = true; }
        else if (near(head, end, tol))   { verts.unshift(start); used[j] = true; extended = true; }
        else if (near(head, start, tol)) { verts.unshift(end);   used[j] = true; extended = true; }
        if (extended) break;
      }
    }

    const closed = verts.length > 2 && near(verts[0], verts[verts.length - 1], tol);
    if (closed) verts.pop();
    chains.push({ vertices: verts, layerId, closed });
  }
  return chains;
}

/**
 * Stage 2 — arc/circle detection on a single chain.
 * A chain of many short chords with smooth, consistent turning and a low-RMS
 * circle fit is collapsed into a CircleEntity (closed, ~2π turning) or an
 * ArcEntity (open). Returns null when the chain is genuinely polygonal.
 */
function detectCurve(chain: Chain, opt: ReconstructOptions): CadEntity | null {
  const v = chain.vertices;
  if (v.length < opt.minArcSegments) return null;

  const fit = fitCircle(v);
  if (!fit || fit.rms > opt.arcRmsTolerance) return null;

  const turning = totalTurning(v);

  // Reject polygons: real arcs turn smoothly, so per-vertex turning is small
  // and monotone in sign. A square's corners spike the turning at 4 vertices.
  const maxStep = (() => {
    let m = 0;
    for (let i = 1; i < v.length; i++) {
      const a = angleOf(fit.center, v[i - 1]);
      const b = angleOf(fit.center, v[i]);
      let d = Math.abs(b - a);
      if (d > Math.PI) d = 2 * Math.PI - d;
      m = Math.max(m, d);
    }
    return m;
  })();
  if (maxStep > Math.PI / 3) return null; // a single chord spans >60° → not a fitted arc

  const center = to3(fit.center);

  if (chain.closed && turning > Math.PI * 1.5) {
    return {
      id: nid('circle'), type: 'circle', layerId: chain.layerId,
      colorOverride: null, center, radius: fit.radius,
      meta: { reconstructed: true, rms: fit.rms },
    };
  }

  const startAngle = angleOf(fit.center, v[0]);
  const endAngle = angleOf(fit.center, v[v.length - 1]);
  return {
    id: nid('arc'), type: 'arc', layerId: chain.layerId,
    colorOverride: null, center, radius: fit.radius,
    startAngle, endAngle,
    meta: { reconstructed: true, rms: fit.rms },
  };
}

/**
 * Full reconstruction pass: heal raw line soup into polylines, then promote
 * smooth chains to circles/arcs. Pre-existing non-line entities (text, already
 * fitted circles) pass through unchanged.
 */
export function reconstruct(
  entities: CadEntity[],
  options: Partial<ReconstructOptions> = {},
): CadEntity[] {
  const opt = { ...DEFAULT_RECONSTRUCT, ...options };

  const lines = entities.filter((e): e is LineEntity => e.type === 'line');
  const passthrough = entities.filter((e) => e.type !== 'line');

  const chains = chainSegments(lines, opt.weldTolerance);
  const out: CadEntity[] = [...passthrough];

  for (const chain of chains) {
    const curve = detectCurve(chain, opt);
    if (curve) { out.push(curve); continue; }

    if (chain.vertices.length === 2 && !chain.closed) {
      out.push({
        id: nid('line'), type: 'line', layerId: chain.layerId,
        colorOverride: null, start: chain.vertices[0], end: chain.vertices[1],
      });
    } else {
      out.push({
        id: nid('pl'), type: 'polyline', layerId: chain.layerId,
        colorOverride: null, vertices: chain.vertices, closed: chain.closed,
        meta: { healed: true },
      });
    }
  }
  return out;
}

export { dist };
