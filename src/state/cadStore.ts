// src/state/cadStore.ts
import { create } from 'zustand';
import type {
  ActiveGripState, CadDocument, CadEntity, CircleEntity, Layer, Point3, PolylineEntity, SpaceMode,
} from '../types/cad';
import { createEmptyDocument } from '../types/cad';
import {
  segmentSegment, segmentCircle, circleCircle, paramOnSegment, pointAt, keptSpansAfterTrim,
} from '../math/intersections';
import { closestOnSegment, dist } from '../math/geometry';
import { selectIdsInRect } from '../math/selection';

export type Tool =
  | 'SELECT'
  | 'DRAW_LINE'
  | 'DRAW_POLYLINE'
  | 'DRAW_CIRCLE'
  | 'DRAW_RECTANGLE'
  | 'MOVE_INTERACTIVE'
  | 'COPY_INTERACTIVE'
  | 'SCALE_INTERACTIVE'
  | 'ROTATE_INTERACTIVE'
  | 'TRIM'
  | 'OFFSET'
  | 'MEASURE'
  | 'DIMENSION';

/** Tools that build geometry from a sequence of click points. */
export const POINT_TOOLS: Tool[] = [
  'DRAW_LINE', 'DRAW_POLYLINE', 'DRAW_CIRCLE', 'DRAW_RECTANGLE',
  'MOVE_INTERACTIVE', 'COPY_INTERACTIVE', 'SCALE_INTERACTIVE', 'ROTATE_INTERACTIVE',
  'MEASURE', 'DIMENSION',
];

const HISTORY_MAX = 50;
const MITER_LIMIT = 4; // cap on offset miter length to avoid concave-corner spikes

let _gid = 0;
const genId = (p = 'e'): string => `${p}_${Date.now().toString(36)}_${(_gid++).toString(36)}`;

const v3 = (x: number, y: number, z = 0): Point3 => ({ x, y, z });

function mapPoints(e: CadEntity, fn: (p: Point3) => Point3): CadEntity {
  switch (e.type) {
    case 'line':      return { ...e, start: fn(e.start), end: fn(e.end) };
    case 'polyline':  return { ...e, vertices: e.vertices.map(fn) };
    case 'circle':    return { ...e, center: fn(e.center) };
    case 'arc':       return { ...e, center: fn(e.center) };
    case 'text':      return { ...e, position: fn(e.position) };
    case 'dimension': return { ...e, a: fn(e.a), b: fn(e.b) };
  }
}

const rotPt = (p: Point3, c: Point3, r: number): Point3 => {
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos, z: p.z };
};

/**
 * Pure parallel-offset of an entity at `distance`, biased toward the side the
 * reference point sits on. Polylines use a miter join with a length limit so
 * tight concave corners bevel instead of spiking into self-intersection.
 */
export function computeOffset(
  src: CadEntity, distance: number, sideRef: Point3, newId: string,
): CadEntity | null {
  if (src.type === 'line') {
    const dx = src.end.x - src.start.x, dy = src.end.y - src.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const mid = { x: (src.start.x + src.end.x) / 2, y: (src.start.y + src.end.y) / 2 };
    const side = Math.sign((sideRef.x - mid.x) * nx + (sideRef.y - mid.y) * ny) || 1;
    const ox = nx * distance * side, oy = ny * distance * side;
    return {
      id: newId, type: 'line', layerId: src.layerId, colorOverride: src.colorOverride,
      start: { x: src.start.x + ox, y: src.start.y + oy, z: src.start.z },
      end: { x: src.end.x + ox, y: src.end.y + oy, z: src.end.z },
    };
  }
  if (src.type === 'circle') {
    const dToCenter = Math.hypot(sideRef.x - src.center.x, sideRef.y - src.center.y);
    const r = dToCenter < src.radius ? src.radius - distance : src.radius + distance;
    return r > 1e-6 ? { ...src, id: newId, radius: r } : null;
  }
  if (src.type === 'polyline') {
    const vs = src.vertices;
    const n = vs.length;
    if (n < 2) return null;

    // Unit normal of the edge starting at vertex k (wraps when closed).
    const edgeNormal = (k: number) => {
      const j = (k + 1) % n;
      const dx = vs[j].x - vs[k].x, dy = vs[j].y - vs[k].y;
      const len = Math.hypot(dx, dy) || 1;
      return { nx: -dy / len, ny: dx / len };
    };

    const mid0 = { x: (vs[0].x + vs[1].x) / 2, y: (vs[0].y + vs[1].y) / 2 };
    const n0 = edgeNormal(0);
    const side = Math.sign((sideRef.x - mid0.x) * n0.nx + (sideRef.y - mid0.y) * n0.ny) || 1;

    const moved = vs.map((v, i) => {
      const inc = (i > 0 || src.closed) ? edgeNormal((i - 1 + n) % n) : null;
      const out = (i < n - 1 || src.closed) ? edgeNormal(i) : null;

      let Mx: number, My: number;
      if (inc && out) {
        const denom = 1 + (inc.nx * out.nx + inc.ny * out.ny);
        if (Math.abs(denom) < 1e-6) {
          // Edges fold back ~180°: a true miter is infinite — bevel to one side.
          Mx = out.nx; My = out.ny;
        } else {
          // (n1+n2)/(1+n1·n2) is the exact miter vector (length 1/cos(half-angle)).
          Mx = (inc.nx + out.nx) / denom;
          My = (inc.ny + out.ny) / denom;
          const mlen = Math.hypot(Mx, My);
          // Miter limit exceeded on a tight corner → truncate to a clean bevel:
          // cap the offset at `distance` along the bisector instead of spiking.
          if (mlen > MITER_LIMIT) { Mx /= mlen; My /= mlen; }
        }
      } else {
        const nrm = (inc ?? out)!;
        Mx = nrm.nx; My = nrm.ny;
      }
      return { x: v.x + Mx * distance * side, y: v.y + My * distance * side, z: v.z };
    });
    return { ...src, id: newId, vertices: moved };
  }
  return null;
}

const TAU = Math.PI * 2;
const norm = (a: number) => (a < 0 ? a + TAU : a);
const lerpPt = (a: Point3, b: Point3, t: number): Point3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z });
const dedupePts = (pts: Point3[]): Point3[] => {
  const out: Point3[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
  }
  return out;
};

/**
 * Trim a polyline: locate the clicked segment, find the nearest cut on either
 * side of the click, drop that span, and split the path into open polyline(s).
 * `cutOnSeg` returns the intersection parameters of other geometry along a→b.
 */
function trimPolyline(pl: PolylineEntity, hit: Point3, cutOnSeg: (a: Point3, b: Point3) => number[]): CadEntity[] | null {
  const vs = pl.vertices, n = vs.length;
  const segCount = pl.closed ? n : n - 1;
  if (segCount < 1) return null;

  let k = 0, best = Infinity;
  for (let i = 0; i < segCount; i++) {
    const d = dist(hit, closestOnSegment(hit, vs[i], vs[(i + 1) % n]));
    if (d < best) { best = d; k = i; }
  }
  const a = vs[k], b = vs[(k + 1) % n];
  const cuts = cutOnSeg(a, b);
  if (!cuts.length) return null;

  const hitT = paramOnSegment(hit, a, b);
  let lo = 0, hi = 1;
  for (const t of cuts) {
    if (t <= hitT + 1e-9 && t > lo) lo = t;
    if (t >= hitT - 1e-9 && t < hi) hi = t;
  }
  if (hi - lo < 1e-6) return null;

  const A = lerpPt(a, b, lo), B = lerpPt(a, b, hi);
  const mk = (verts: Point3[]): CadEntity => ({
    id: genId('pl'), type: 'polyline', layerId: pl.layerId, colorOverride: pl.colorOverride,
    vertices: verts, closed: false,
  });

  const out: CadEntity[] = [];
  if (pl.closed) {
    // Removing one span on a closed loop leaves a single open run B → … → A.
    const path: Point3[] = [B];
    for (let j = 1; j <= n; j++) path.push(vs[(k + j) % n]);
    path.push(A);
    const cleaned = dedupePts(path);
    if (cleaned.length >= 2) out.push(mk(cleaned));
  } else {
    const left = dedupePts([...vs.slice(0, k + 1), A]);
    const right = dedupePts([B, ...vs.slice(k + 1)]);
    if (left.length >= 2) out.push(mk(left));
    if (right.length >= 2) out.push(mk(right));
  }
  return out.length ? out : null;
}

/**
 * Trim a circle: collect every intersection angle from cutting geometry, drop
 * the arc span under the cursor, and re-emit the remaining spans as arc entities.
 */
function trimCircle(circle: CircleEntity, hit: Point3, others: CadEntity[]): CadEntity[] | null {
  const c = circle.center, r = circle.radius;
  const pts: { x: number; y: number }[] = [];
  for (const o of others) {
    if (o.type === 'line') {
      for (const h of segmentCircle(o.start, o.end, c, r)) pts.push(h.point);
    } else if (o.type === 'polyline') {
      for (let i = 0; i < o.vertices.length - (o.closed ? 0 : 1); i++) {
        for (const h of segmentCircle(o.vertices[i], o.vertices[(i + 1) % o.vertices.length], c, r)) pts.push(h.point);
      }
    } else if (o.type === 'circle') {
      pts.push(...circleCircle(c, r, o.center, o.radius));
    }
  }
  if (pts.length < 2) return null;

  const angles = pts.map((p) => norm(Math.atan2(p.y - c.y, p.x - c.x))).sort((x, y) => x - y);
  const uniq: number[] = [];
  for (const ag of angles) if (!uniq.length || Math.abs(ag - uniq[uniq.length - 1]) > 1e-6) uniq.push(ag);
  if (uniq.length > 1 && Math.abs(uniq[0] + TAU - uniq[uniq.length - 1]) < 1e-6) uniq.pop();
  if (uniq.length < 2) return null;

  const clickA = norm(Math.atan2(hit.y - c.y, hit.x - c.x));
  const m = uniq.length;
  let removed = 0;
  for (let i = 0; i < m; i++) {
    const sA = uniq[i], eA = uniq[(i + 1) % m];
    const inside = sA < eA ? (clickA >= sA && clickA <= eA) : (clickA >= sA || clickA <= eA);
    if (inside) { removed = i; break; }
  }

  const arcs: CadEntity[] = [];
  for (let i = 0; i < m; i++) {
    if (i === removed) continue;
    arcs.push({
      id: genId('arc'), type: 'arc', layerId: circle.layerId, colorOverride: circle.colorOverride,
      center: { ...c }, radius: r, startAngle: uniq[i], endAngle: uniq[(i + 1) % m],
    });
  }
  return arcs.length ? arcs : null;
}

interface CadState {
  doc: CadDocument;
  selection: Set<string>;
  activeLayerId: string;

  // undo/redo history (deep-copied document JSON snapshots)
  past: string[];
  future: string[];

  // tool state machine
  activeTool: Tool;
  draftPoints: Point3[];
  basePoint: Point3 | null;
  pendingEntityId: string | null;
  cursorWorld: Point3 | null;
  /** Reference magnitude captured after the base point for scale/rotate drags
   *  (initial base→cursor distance for scale, initial angle for rotate). */
  transformRef: number | null;

  // drafting constraints
  orthoMode: boolean;
  offsetDistance: number;
  showGrid: boolean;

  // AutoCAD command-line console log (most recent last)
  commandHistory: string[];

  // grip editing
  activeGrip: ActiveGripState | null;
  setActiveGrip: (grip: ActiveGripState | null) => void;
  moveGripToPosition: (entityId: string, gripId: string, target: Point3) => void;

  setDocument: (doc: CadDocument) => void;
  clearDocument: () => void;
  undo: () => void;
  redo: () => void;

  // command line + properties + paper space
  addCommandLog: (msg: string) => void;
  executeCommandString: (input: string) => void;
  updateEntityProperty: (id: string, patch: Partial<CadEntity>) => void;
  setSpaceMode: (mode: SpaceMode) => void;
  /** Public history snapshot (alias of the internal recordHistory). */
  saveHistorySnapshot: () => void;

  setTool: (t: Tool) => void;
  setCursor: (p: Point3 | null) => void;
  pushPoint: (p: Point3) => void;
  setBasePoint: (p: Point3 | null) => void;
  setPendingEntity: (id: string | null) => void;
  setTransformRef: (n: number | null) => void;
  resetDraft: () => void;
  toggleOrtho: () => void;
  setOrtho: (b: boolean) => void;
  setOffsetDistance: (d: number) => void;
  toggleGrid: () => void;
  setShowGrid: (b: boolean) => void;

  select: (ids: string[], additive?: boolean) => void;
  selectInRect: (min: Point3, max: Point3, crossing: boolean, additive: boolean) => void;
  clearSelection: () => void;

  addEntity: (e: CadEntity) => void;
  commitLine: (a: Point3, b: Point3) => void;
  commitPolyline: (vertices: Point3[], closed: boolean) => void;
  commitCircle: (center: Point3, radius: number) => void;
  commitRectangle: (a: Point3, b: Point3) => void;
  addDimension: (a: Point3, b: Point3, offset: number) => void;

  commitMoveCopy: (delta: Point3, copy: boolean) => void;
  translateSelection: (dx: number, dy: number) => void;
  rotateSelection: (pivot: Point3, radians: number) => void;
  scaleSelection: (pivot: Point3, factor: number) => void;
  deleteSelection: () => void;

  trimEntity: (targetId: string, hit: Point3) => void;
  offsetEntity: (sourceId: string, distance: number, sideRef: Point3) => void;

  setEntityPoint: (id: string, key: string, p: Point3) => void;
  setCircleRadius: (id: string, radius: number) => void;
  setText: (id: string, value: string) => void;

  addLayer: (name: string, color: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
}

export const useCadStore = create<CadState>((set, get) => {
  // Snapshot the CURRENT document onto the undo stack before a mutation runs.
  // Called at the head of every committing action; clears the redo stack.
  const recordHistory = () => {
    const s = get();
    set({ past: [...s.past, JSON.stringify(s.doc)].slice(-HISTORY_MAX), future: [] });
  };

  return {
    doc: createEmptyDocument(),
    selection: new Set(),
    activeLayerId: 'pdf_geometry',

    past: [],
    future: [],

    activeTool: 'SELECT',
    draftPoints: [],
    basePoint: null,
    pendingEntityId: null,
    cursorWorld: null,
    transformRef: null,

    orthoMode: false,
    offsetDistance: 10,
    showGrid: true,

    commandHistory: [
      'CADFlow engine initialized.',
      'Type a command (LINE, TRIM, OFFSET, REGEN, CLEAR) or use shortcuts (L, TR, O, M).',
    ],

    activeGrip: null,
    setActiveGrip: (activeGrip) => set({ activeGrip }),

    // Grip-drag mutation. Runs every frame during a stretch — NOT snapshotted
    // here; saveHistorySnapshot() fires once on grip pointerdown instead.
    moveGripToPosition: (entityId, gripId, target) => set((s) => ({
      doc: {
        ...s.doc,
        entities: s.doc.entities.map((e) => {
          if (e.id !== entityId) return e;
          switch (e.type) {
            case 'line':
              if (gripId === 'start') return { ...e, start: target };
              if (gripId === 'end') return { ...e, end: target };
              if (gripId === 'mid') {
                const dx = target.x - (e.start.x + e.end.x) / 2;
                const dy = target.y - (e.start.y + e.end.y) / 2;
                return {
                  ...e,
                  start: { x: e.start.x + dx, y: e.start.y + dy, z: e.start.z },
                  end: { x: e.end.x + dx, y: e.end.y + dy, z: e.end.z },
                };
              }
              return e;
            case 'polyline':
              if (gripId.startsWith('vertex_')) {
                const idx = parseInt(gripId.slice(7), 10);
                if (idx >= 0 && idx < e.vertices.length) {
                  const vertices = e.vertices.slice();
                  vertices[idx] = target;
                  return { ...e, vertices };
                }
              }
              return e;
            case 'circle':
              if (gripId === 'center') return { ...e, center: target };
              if (gripId === 'radius') return { ...e, radius: Math.max(1e-6, Math.hypot(target.x - e.center.x, target.y - e.center.y)) };
              return e;
            case 'arc':
              if (gripId === 'center') return { ...e, center: target };
              return e;
            case 'text':
              if (gripId === 'position') return { ...e, position: target };
              return e;
            case 'dimension':
              if (gripId === 'a') return { ...e, a: target };
              if (gripId === 'b') return { ...e, b: target };
              return e;
            default:
              return e;
          }
        }),
      },
    })),

    setDocument: (doc) => set({
      doc, selection: new Set(), draftPoints: [], basePoint: null,
      past: [], future: [], // a fresh import starts a clean history
    }),

    saveHistorySnapshot: () => recordHistory(),

    addCommandLog: (msg) => set((s) => ({ commandHistory: [...s.commandHistory.slice(-199), msg] })),

    // Route a typed command/alias to the real tool state machine + actions.
    executeCommandString: (input) => {
      const raw = input.trim();
      if (!raw) return;
      const cmd = raw.toLowerCase();
      const log = get().addCommandLog;
      log(`Command: ${raw}`);

      const toolMap: Record<string, Tool> = {
        l: 'DRAW_LINE', line: 'DRAW_LINE',
        pl: 'DRAW_POLYLINE', polyline: 'DRAW_POLYLINE', pline: 'DRAW_POLYLINE',
        c: 'DRAW_CIRCLE', circle: 'DRAW_CIRCLE',
        rec: 'DRAW_RECTANGLE', rectangle: 'DRAW_RECTANGLE', rectang: 'DRAW_RECTANGLE',
        m: 'MOVE_INTERACTIVE', move: 'MOVE_INTERACTIVE',
        co: 'COPY_INTERACTIVE', copy: 'COPY_INTERACTIVE',
        sc: 'SCALE_INTERACTIVE', scale: 'SCALE_INTERACTIVE',
        ro: 'ROTATE_INTERACTIVE', rotate: 'ROTATE_INTERACTIVE',
        tr: 'TRIM', trim: 'TRIM',
        o: 'OFFSET', offset: 'OFFSET',
        di: 'DIMENSION', dim: 'DIMENSION', dimension: 'DIMENSION',
        mea: 'MEASURE', measure: 'MEASURE', dist: 'MEASURE',
      };

      if (toolMap[cmd]) {
        get().setTool(toolMap[cmd]);
        log(`→ ${toolMap[cmd]} active.`);
        return;
      }
      switch (cmd) {
        case 'e': case 'erase': case 'delete':
          get().deleteSelection(); log('Erased current selection.'); break;
        case 'u': case 'undo':
          get().undo(); log('Undo.'); break;
        case 'redo':
          get().redo(); log('Redo.'); break;
        case 'regen': case 're':
          set((s) => ({ doc: { ...s.doc } })); // new ref forces a full viewport rebuild
          log('Regenerating model — graphics rebuilt.'); break;
        case 'clear': case 'clr':
          get().clearDocument(); log('Drawing purged. Origin reset to (0,0,0).'); break;
        case 'grid':
          get().toggleGrid(); log(`Grid ${get().showGrid ? 'ON' : 'OFF'}.`); break;
        case 'ortho':
          get().toggleOrtho(); log(`Ortho ${get().orthoMode ? 'ON' : 'OFF'}.`); break;
        case 'sel': case 'select':
          get().setTool('SELECT'); log('→ SELECT active.'); break;
        default:
          log(`Unknown command: "${raw}". Try LINE, TRIM, OFFSET, MOVE, REGEN, CLEAR.`); break;
      }
    },

    // Properties palette mutation. Not snapshotted per keystroke (would flood the
    // history ring); use Undo before the edit if you need to revert a batch.
    updateEntityProperty: (id, patch) => set((s) => ({
      doc: {
        ...s.doc,
        entities: s.doc.entities.map((e) => (e.id === id ? ({ ...e, ...patch } as CadEntity) : e)),
      },
    })),

    setSpaceMode: (activeSpace) => {
      get().addCommandLog(`Switched to ${activeSpace}.`);
      set((s) => ({
        doc: { ...s.doc, activeSpace, viewportScale: activeSpace === 'MODEL' ? 1.0 : 0.02 },
      }));
    },

    // REGEN / Clear Layout: wipe geometry, selection, draft, and reset origin.
    // Undoable — the pre-clear document is snapshotted onto the history ring.
    clearDocument: () => {
      recordHistory();
      set((s) => ({
        doc: { ...s.doc, entities: [], origin: { x: 0, y: 0, z: 0 } },
        selection: new Set(),
        draftPoints: [], basePoint: null, pendingEntityId: null, transformRef: null,
      }));
    },

    undo: () => set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        doc: JSON.parse(prev) as CadDocument,
        past: s.past.slice(0, -1),
        future: [JSON.stringify(s.doc), ...s.future].slice(0, HISTORY_MAX),
        selection: new Set(), draftPoints: [], basePoint: null, pendingEntityId: null, transformRef: null,
      };
    }),

    redo: () => set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return {
        doc: JSON.parse(next) as CadDocument,
        future: s.future.slice(1),
        past: [...s.past, JSON.stringify(s.doc)].slice(-HISTORY_MAX),
        selection: new Set(), draftPoints: [], basePoint: null, pendingEntityId: null, transformRef: null,
      };
    }),

    // --- tool / draft lifecycle --------------------------------------------
    setTool: (activeTool) =>
      set({ activeTool, draftPoints: [], basePoint: null, pendingEntityId: null, transformRef: null }),
    setCursor: (cursorWorld) => set({ cursorWorld }),
    pushPoint: (p) => set((s) => ({ draftPoints: [...s.draftPoints, p] })),
    setBasePoint: (basePoint) => set({ basePoint }),
    setPendingEntity: (pendingEntityId) => set({ pendingEntityId }),
    setTransformRef: (transformRef) => set({ transformRef }),
    resetDraft: () => set({ draftPoints: [], basePoint: null, pendingEntityId: null, transformRef: null }),
    toggleOrtho: () => set((s) => ({ orthoMode: !s.orthoMode })),
    setOrtho: (orthoMode) => set({ orthoMode }),
    setOffsetDistance: (offsetDistance) => set({ offsetDistance }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    setShowGrid: (showGrid) => set({ showGrid }),

    // --- selection ----------------------------------------------------------
    select: (ids, additive = false) => set((s) => {
      const next = new Set(additive ? s.selection : []);
      ids.forEach((id) => next.add(id));
      return { selection: next };
    }),
    selectInRect: (min, max, crossing, additive) => set((s) => {
      const ids = selectIdsInRect(s.doc, { x: min.x, y: min.y }, { x: max.x, y: max.y }, crossing);
      const next = new Set(additive ? s.selection : []);
      ids.forEach((id) => next.add(id));
      return { selection: next };
    }),
    clearSelection: () => set({ selection: new Set() }),

    // --- entity creation ----------------------------------------------------
    addEntity: (e) => {
      recordHistory();
      set((s) => ({
        doc: { ...s.doc, entities: [...s.doc.entities, e] },
        draftPoints: [], basePoint: null, pendingEntityId: null,
      }));
    },

    commitLine: (a, b) => get().addEntity({
      id: genId('line'), type: 'line', layerId: get().activeLayerId,
      colorOverride: null, start: a, end: b,
    }),

    commitPolyline: (vertices, closed) => {
      if (vertices.length < 2) { get().resetDraft(); return; }
      get().addEntity({
        id: genId('pl'), type: 'polyline', layerId: get().activeLayerId,
        colorOverride: null, vertices, closed,
      });
    },

    commitCircle: (center, radius) => {
      if (radius < 1e-6) { get().resetDraft(); return; }
      get().addEntity({
        id: genId('circle'), type: 'circle', layerId: get().activeLayerId,
        colorOverride: null, center, radius,
      });
    },

    commitRectangle: (a, b) => get().addEntity({
      id: genId('rect'), type: 'polyline', layerId: get().activeLayerId,
      colorOverride: null, closed: true,
      vertices: [v3(a.x, a.y), v3(b.x, a.y), v3(b.x, b.y), v3(a.x, b.y)],
    }),

    addDimension: (a, b, offset) => get().addEntity({
      id: genId('dim'), type: 'dimension', layerId: get().activeLayerId,
      colorOverride: null, a, b, offset,
    }),

    // --- interactive transforms --------------------------------------------
    commitMoveCopy: (delta, copy) => {
      recordHistory();
      set((s) => {
        const move = (e: CadEntity): CadEntity =>
          mapPoints(e, (p) => ({ x: p.x + delta.x, y: p.y + delta.y, z: p.z }));
        if (!copy) {
          return {
            doc: { ...s.doc, entities: s.doc.entities.map((e) => (s.selection.has(e.id) ? move(e) : e)) },
            draftPoints: [], basePoint: null,
          };
        }
        const clones = s.doc.entities
          .filter((e) => s.selection.has(e.id))
          .map((e) => ({ ...move(e), id: genId(e.type) }));
        return {
          doc: { ...s.doc, entities: [...s.doc.entities, ...clones] },
          selection: new Set(clones.map((c) => c.id)),
          draftPoints: [], basePoint: null,
        };
      });
    },

    translateSelection: (dx, dy) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          entities: s.doc.entities.map((e) =>
            s.selection.has(e.id) ? mapPoints(e, (p) => ({ x: p.x + dx, y: p.y + dy, z: p.z })) : e),
        },
      }));
    },

    rotateSelection: (pivot, radians) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          entities: s.doc.entities.map((e) => {
            if (!s.selection.has(e.id)) return e;
            const moved = mapPoints(e, (p) => rotPt(p, pivot, radians));
            if (moved.type === 'text') return { ...moved, rotation: moved.rotation + radians };
            if (moved.type === 'arc') return { ...moved, startAngle: moved.startAngle + radians, endAngle: moved.endAngle + radians };
            return moved;
          }),
        },
      }));
    },

    scaleSelection: (pivot, factor) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          entities: s.doc.entities.map((e) => {
            if (!s.selection.has(e.id)) return e;
            const moved = mapPoints(e, (p) => ({
              x: pivot.x + (p.x - pivot.x) * factor,
              y: pivot.y + (p.y - pivot.y) * factor,
              z: p.z,
            }));
            if (moved.type === 'circle' || moved.type === 'arc') return { ...moved, radius: moved.radius * factor };
            if (moved.type === 'text') return { ...moved, height: moved.height * factor };
            return moved;
          }),
        },
      }));
    },

    deleteSelection: () => {
      if (!get().selection.size) return;
      recordHistory();
      set((s) => ({
        doc: { ...s.doc, entities: s.doc.entities.filter((e) => !s.selection.has(e.id)) },
        selection: new Set(),
      }));
    },

    // --- Trim engine --------------------------------------------------------
    // Line targets split into line spans; polyline targets split the clicked
    // segment (and the path); circle targets break into arc entities. In every
    // case the span/arc under the cursor is dropped and the rest survives.
    trimEntity: (targetId, hit) => {
      const s0 = get();
      const target = s0.doc.entities.find((e) => e.id === targetId);
      if (!target) return;
      const visible = (id: string) => s0.doc.layers.find((l) => l.id === id)?.visible !== false;
      const others = s0.doc.entities.filter((e) => e.id !== targetId && visible(e.layerId));

      // Intersection parameters of all other geometry along a finite segment a→b.
      const cutOnSeg = (a: Point3, b: Point3): number[] => {
        const ts: number[] = [];
        for (const o of others) {
          if (o.type === 'line') { const h = segmentSegment(a, b, o.start, o.end); if (h) ts.push(h.t); }
          else if (o.type === 'polyline') {
            for (let i = 0; i < o.vertices.length - (o.closed ? 0 : 1); i++) {
              const h = segmentSegment(a, b, o.vertices[i], o.vertices[(i + 1) % o.vertices.length]);
              if (h) ts.push(h.t);
            }
          } else if (o.type === 'circle') {
            for (const h of segmentCircle(a, b, o.center, o.radius)) ts.push(h.t);
          }
        }
        return ts;
      };

      let replacement: CadEntity[] | null = null;
      if (target.type === 'line') {
        const a = target.start, b = target.end;
        const cuts = cutOnSeg(a, b);
        if (!cuts.length) return;
        replacement = keptSpansAfterTrim(cuts, paramOnSegment(hit, a, b)).map((sp) => ({
          id: genId('line'), type: 'line', layerId: target.layerId, colorOverride: target.colorOverride,
          start: { ...pointAt(a, b, sp.t0), z: a.z },
          end: { ...pointAt(a, b, sp.t1), z: b.z },
        }));
      } else if (target.type === 'polyline') {
        replacement = trimPolyline(target, hit, cutOnSeg);
      } else if (target.type === 'circle') {
        replacement = trimCircle(target, hit, others);
      }
      if (!replacement) return; // arcs/text/dimensions, or nothing crosses the target

      recordHistory();
      set((s) => ({
        doc: { ...s.doc, entities: [...s.doc.entities.filter((e) => e.id !== targetId), ...replacement!] },
        selection: new Set(),
      }));
    },

    // --- Offset engine ------------------------------------------------------
    offsetEntity: (sourceId, distance, sideRef) => {
      const src = get().doc.entities.find((e) => e.id === sourceId);
      if (!src) return;
      const created = computeOffset(src, distance, sideRef, genId(src.type));
      if (!created) return;
      recordHistory();
      set((s) => ({
        doc: { ...s.doc, entities: [...s.doc.entities, created] },
        pendingEntityId: null,
      }));
    },

    // --- grip / direct editing ---------------------------------------------
    setEntityPoint: (id, key, p) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          entities: s.doc.entities.map((e) => {
            if (e.id !== id) return e;
            if (e.type === 'line' && (key === 'start' || key === 'end')) return { ...e, [key]: p };
            if (e.type === 'polyline') {
              const idx = Number(key);
              if (!Number.isNaN(idx)) {
                const vertices = e.vertices.slice();
                vertices[idx] = p;
                return { ...e, vertices };
              }
            }
            if ((e.type === 'circle' || e.type === 'arc') && key === 'center') return { ...e, center: p };
            if (e.type === 'text' && key === 'position') return { ...e, position: p };
            if (e.type === 'dimension' && (key === 'a' || key === 'b')) return { ...e, [key]: p };
            return e;
          }),
        },
      }));
    },

    setCircleRadius: (id, radius) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          entities: s.doc.entities.map((e) =>
            e.id === id && (e.type === 'circle' || e.type === 'arc')
              ? { ...e, radius: Math.max(1e-6, radius) } : e),
        },
      }));
    },

    setText: (id, value) => {
      recordHistory();
      set((s) => ({
        doc: {
          ...s.doc,
          entities: s.doc.entities.map((e) => (e.id === id && e.type === 'text' ? { ...e, value } : e)),
        },
      }));
    },

    // --- layers -------------------------------------------------------------
    addLayer: (name, color) => set((s) => ({
      doc: {
        ...s.doc,
        layers: [...s.doc.layers, {
          id: `layer_${Date.now().toString(36)}`, name, color, visible: true, locked: false,
        }],
      },
    })),

    updateLayer: (id, patch) => set((s) => ({
      doc: { ...s.doc, layers: s.doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
    })),

    removeLayer: (id) => set((s) => ({
      doc: {
        ...s.doc,
        layers: s.doc.layers.filter((l) => l.id !== id),
        entities: s.doc.entities.filter((e) => e.layerId !== id),
      },
    })),

    setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  };
});
