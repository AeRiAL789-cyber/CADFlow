// src/components/CadViewport.tsx
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useCadStore, POINT_TOOLS, computeOffset } from '../state/cadStore';
import type { CadDocument, CadEntity, LineType, Point3, SpaceMode } from '../types/cad';

export interface SnapResult { kind: 'Endpoint' | 'Midpoint' | 'Center'; world: THREE.Vector3; entityId: string; }
export interface CursorInfo { x: number; y: number; snap: SnapResult | null; }

interface Props {
  onCursor?: (c: CursorInfo) => void;
  snapPixelRadius?: number;
}

const ARC_SEGMENTS = 64;
const PREVIEW_COLOR = '#7cffb2';
const DIM_TEXT_H = 6;
const ARROW = 3;

const dist2 = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y);
const mid2 = (a: Point3, b: Point3): Point3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 });

function signedOffset(a: Point3, b: Point3, p: Point3): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return (p.x - a.x) * (-dy / len) + (p.y - a.y) * (dx / len);
}

function applyOrtho(ref: Point3, p: Point3): Point3 {
  const dx = p.x - ref.x, dy = p.y - ref.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: ref.y, z: 0 } : { x: ref.x, y: p.y, z: 0 };
}

// ---- snap candidates --------------------------------------------------------
function snapPointsOf(e: CadEntity): { kind: SnapResult['kind']; p: Point3 }[] {
  switch (e.type) {
    case 'line':
      return [{ kind: 'Endpoint', p: e.start }, { kind: 'Endpoint', p: e.end }, { kind: 'Midpoint', p: mid2(e.start, e.end) }];
    case 'polyline': {
      const pts: { kind: SnapResult['kind']; p: Point3 }[] = e.vertices.map((v) => ({ kind: 'Endpoint', p: v }));
      for (let i = 0; i < e.vertices.length - 1; i++) pts.push({ kind: 'Midpoint', p: mid2(e.vertices[i], e.vertices[i + 1]) });
      return pts;
    }
    case 'circle':
    case 'arc':       return [{ kind: 'Center', p: e.center }];
    case 'text':      return [{ kind: 'Endpoint', p: e.position }];
    case 'dimension': return [{ kind: 'Endpoint', p: e.a }, { kind: 'Endpoint', p: e.b }];
  }
}

// ---- THREE helpers ----------------------------------------------------------
const vec = (p: Point3) => new THREE.Vector3(p.x, p.y, 0);

function lineObj(pts: THREE.Vector3[], color: string): THREE.Line {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
}

function circlePoints(center: Point3, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const a = (i / ARC_SEGMENTS) * Math.PI * 2;
    pts.push(new THREE.Vector3(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, 0));
  }
  return pts;
}

function makeTextSprite(text: string, color: string, worldHeight: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontPx = 64;
  ctx.font = `${fontPx}px sans-serif`;
  const w = Math.max(1, ctx.measureText(text).width);
  canvas.width = w; canvas.height = Math.ceil(fontPx * 1.4);
  ctx.font = `${fontPx}px sans-serif`;
  ctx.fillStyle = color; ctx.textBaseline = 'top';
  ctx.fillText(text, 0, 0);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  const scale = worldHeight / fontPx;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}

/** Dimension-line endpoints (committed text drawn separately when withLabel). */
function dimEndpoints(a: Point3, b: Point3, offset: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return {
    len, ux: dx / len, uy: dy / len, nx, ny,
    a2: { x: a.x + nx * offset, y: a.y + ny * offset, z: 0 } as Point3,
    b2: { x: b.x + nx * offset, y: b.y + ny * offset, z: 0 } as Point3,
  };
}

/**
 * Aligned dimension geometry. `withLabel` adds the distance sprite — kept OFF
 * for per-frame previews/ghosts so we never compile a CanvasTexture on drag.
 */
function buildDimension(a: Point3, b: Point3, offset: number, color: string, withLabel: boolean): THREE.Group {
  const g = new THREE.Group();
  const { len, ux, uy, nx, ny, a2, b2 } = dimEndpoints(a, b, offset);
  g.add(lineObj([vec(a), vec(a2)], color));
  g.add(lineObj([vec(b), vec(b2)], color));
  g.add(lineObj([vec(a2), vec(b2)], color));
  const head = (tip: Point3, dir: number) => {
    const bx = tip.x - ux * ARROW * dir, by = tip.y - uy * ARROW * dir;
    g.add(lineObj([vec(tip), new THREE.Vector3(bx + nx * ARROW * 0.4, by + ny * ARROW * 0.4, 0)], color));
    g.add(lineObj([vec(tip), new THREE.Vector3(bx - nx * ARROW * 0.4, by - ny * ARROW * 0.4, 0)], color));
  };
  head(a2, 1); head(b2, -1);
  if (withLabel) {
    const label = makeTextSprite(len.toFixed(2), color, DIM_TEXT_H);
    const m = mid2(a2, b2);
    label.position.set(m.x, m.y + DIM_TEXT_H * 0.6, 0);
    g.add(label);
  }
  return g;
}

function buildObject(e: CadEntity, color: string, withLabel = true): THREE.Object3D | null {
  switch (e.type) {
    case 'line':
      return lineObj([vec(e.start), vec(e.end)], color);
    case 'polyline': {
      const pts = e.vertices.map(vec);
      if (e.closed && pts.length) pts.push(pts[0].clone());
      return lineObj(pts, color);
    }
    case 'circle':
      return lineObj(circlePoints(e.center, e.radius), color);
    case 'arc': {
      const pts: THREE.Vector3[] = [];
      let sweep = e.endAngle - e.startAngle;
      while (sweep <= 0) sweep += Math.PI * 2;
      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const a = e.startAngle + (i / ARC_SEGMENTS) * sweep;
        pts.push(new THREE.Vector3(e.center.x + Math.cos(a) * e.radius, e.center.y + Math.sin(a) * e.radius, 0));
      }
      return lineObj(pts, color);
    }
    case 'text': {
      if (!withLabel) return null;
      const sprite = makeTextSprite(e.value, color, e.height);
      sprite.position.set(e.position.x + sprite.scale.x / 2, e.position.y, 0);
      return sprite;
    }
    case 'dimension':
      return buildDimension(e.a, e.b, e.offset, color, withLabel);
  }
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    const any = o as THREE.Mesh & THREE.Line & THREE.Sprite;
    if (any.geometry) any.geometry.dispose();
    const m = any.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else if (m) m.dispose();
  });
  group.clear();
}

interface OverlayLabel { worldX: number; worldY: number; text: string; }

// ---- Properties palette helpers --------------------------------------------
const TAU = Math.PI * 2;

/** Computed engineering dimensions of an entity for the inspector. */
function describeEntity(e: CadEntity): { label: string; value: string }[] {
  const f = (n: number) => n.toFixed(3);
  switch (e.type) {
    case 'line': {
      const len = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
      const ang = (Math.atan2(e.end.y - e.start.y, e.end.x - e.start.x) * 180) / Math.PI;
      return [
        { label: 'Start', value: `${f(e.start.x)}, ${f(e.start.y)}` },
        { label: 'End', value: `${f(e.end.x)}, ${f(e.end.y)}` },
        { label: 'Length', value: f(len) },
        { label: 'Angle', value: `${ang.toFixed(2)}°` },
      ];
    }
    case 'polyline': {
      let len = 0;
      for (let i = 0; i < e.vertices.length - 1; i++) len += Math.hypot(e.vertices[i + 1].x - e.vertices[i].x, e.vertices[i + 1].y - e.vertices[i].y);
      let area = 0;
      if (e.closed) {
        for (let i = 0; i < e.vertices.length; i++) {
          const a = e.vertices[i], b = e.vertices[(i + 1) % e.vertices.length];
          area += a.x * b.y - b.x * a.y;
          len += i === e.vertices.length - 1 ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
        }
        area = Math.abs(area) / 2;
      }
      const rows = [{ label: 'Vertices', value: String(e.vertices.length) }, { label: 'Closed', value: e.closed ? 'Yes' : 'No' }, { label: 'Length', value: f(len) }];
      if (e.closed) rows.push({ label: 'Area', value: f(area) });
      return rows;
    }
    case 'circle':
      return [
        { label: 'Center', value: `${f(e.center.x)}, ${f(e.center.y)}` },
        { label: 'Radius', value: f(e.radius) },
        { label: 'Diameter', value: f(e.radius * 2) },
        { label: 'Circumference', value: f(TAU * e.radius) },
        { label: 'Area', value: f(Math.PI * e.radius * e.radius) },
      ];
    case 'arc': {
      let sweep = e.endAngle - e.startAngle;
      while (sweep <= 0) sweep += TAU;
      return [
        { label: 'Center', value: `${f(e.center.x)}, ${f(e.center.y)}` },
        { label: 'Radius', value: f(e.radius) },
        { label: 'Arc Length', value: f(sweep * e.radius) },
        { label: 'Sweep', value: `${((sweep * 180) / Math.PI).toFixed(2)}°` },
      ];
    }
    case 'text':
      return [
        { label: 'Position', value: `${f(e.position.x)}, ${f(e.position.y)}` },
        { label: 'Value', value: e.value },
        { label: 'Height', value: f(e.height) },
        { label: 'Rotation', value: `${((e.rotation * 180) / Math.PI).toFixed(2)}°` },
      ];
    case 'dimension':
      return [
        { label: 'A', value: `${f(e.a.x)}, ${f(e.a.y)}` },
        { label: 'B', value: `${f(e.b.x)}, ${f(e.b.y)}` },
        { label: 'Measured', value: f(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)) },
      ];
  }
}

function PropGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 rounded border border-white/5 bg-panel2 p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-accent/80">{title}</div>
      {children}
    </div>
  );
}

function PropRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-gray-500">{k}</span>
      <span className="truncate text-right font-mono text-gray-300">{v}</span>
    </div>
  );
}

export default function CadViewport({ onCursor, snapPixelRadius = 12 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const snapTagRef = useRef<HTMLDivElement>(null);
  const refs = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.OrthographicCamera | null,
    entityGroup: new THREE.Group(),
    previewGroup: new THREE.Group(),
    snapMarker: null as THREE.Mesh | null,
  });
  const labelsRef = useRef<OverlayLabel[]>([]);

  // Reactive reads for the surrounding HUD chrome; the canvas itself stays
  // driven by the imperative store subscription inside the effect below.
  const commandHistory = useCadStore((s) => s.commandHistory);
  const activeSpace = useCadStore((s) => s.doc.activeSpace);
  const selection = useCadStore((s) => s.selection);
  const entities = useCadStore((s) => s.doc.entities);
  const orthoMode = useCadStore((s) => s.orthoMode);
  const showGrid = useCadStore((s) => s.showGrid);
  const executeCommandString = useCadStore((s) => s.executeCommandString);
  const setSpaceMode = useCadStore((s) => s.setSpaceMode);
  const toggleOrtho = useCadStore((s) => s.toggleOrtho);
  const toggleGrid = useCadStore((s) => s.toggleGrid);
  const updateEntityProperty = useCadStore((s) => s.updateEntityProperty);

  const [cmdInput, setCmdInput] = useState('');
  const commandInputRef = useRef<HTMLInputElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => { historyEndRef.current?.scrollIntoView({ block: 'end' }); }, [commandHistory]);

  const selectedEntity = entities.find((e) => selection.has(e.id)) ?? null;
  const handleCmdSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!cmdInput.trim()) return;
    executeCommandString(cmdInput);
    setCmdInput('');
  };

  useEffect(() => {
    const wrap = wrapRef.current!;
    const mount = mountRef.current!;
    const input = inputRef.current!;
    const overlay = overlayRef.current!;
    const box = boxRef.current!;
    const snapTag = snapTagRef.current!;
    const width = mount.clientWidth, height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#12151b');

    const aspect = width / height;
    const frustum = 200;
    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2, (frustum * aspect) / 2, frustum / 2, -frustum / 2, 0.1, 2000,
    );
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(2000, 200, '#2a3140', '#1d2330');
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const snapMarker = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.2, 16),
      new THREE.MeshBasicMaterial({ color: '#ffe169', side: THREE.DoubleSide }),
    );
    snapMarker.visible = false;
    scene.add(snapMarker);
    scene.add(refs.current.entityGroup);
    scene.add(refs.current.previewGroup);
    Object.assign(refs.current, { renderer, camera, snapMarker });

    // UCS axis indicator (red X / green Y), pinned to the viewport's lower-left.
    const ucsGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 0, 0),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 16, 0),
    ]);
    ucsGeo.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array([1, 0.35, 0.35, 1, 0.35, 0.35, 0.4, 1, 0.45, 0.4, 1, 0.45]), 3));
    const ucs = new THREE.LineSegments(ucsGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
    scene.add(ucs);

    const get = useCadStore.getState;
    grid.visible = get().showGrid && get().doc.activeSpace === 'MODEL';
    scene.background = new THREE.Color(get().doc.activeSpace === 'MODEL' ? '#12151b' : '#f4f4f4');
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 1.5 };
    const ndc = new THREE.Vector2();
    let panning = false;
    let lastPan = { x: 0, y: 0 };
    let prevDrawing = false;

    // directional selection box (SELECT tool, empty-space drag)
    let boxActive = false, boxMoved = false, boxShift = false;
    let boxStart = { x: 0, y: 0 };

    const screenToWorld = (cx: number, cy: number): THREE.Vector3 => {
      const r = renderer.domElement.getBoundingClientRect();
      const nx = ((cx - r.left) / r.width) * 2 - 1;
      const ny = -((cy - r.top) / r.height) * 2 + 1;
      const v = new THREE.Vector3(nx, ny, 0).unproject(camera);
      v.z = 0;
      return v;
    };
    const worldToScreen = (w: THREE.Vector3) => {
      const r = renderer.domElement.getBoundingClientRect();
      const v = w.clone().project(camera);
      return { x: ((v.x + 1) / 2) * r.width + r.left, y: ((-v.y + 1) / 2) * r.height + r.top };
    };

    const findSnap = (cx: number, cy: number): SnapResult | null => {
      const doc = get().doc;
      let best: SnapResult | null = null;
      let bestPx = snapPixelRadius;
      for (const e of doc.entities) {
        if (doc.layers.find((l) => l.id === e.layerId)?.visible === false) continue;
        for (const { kind, p } of snapPointsOf(e)) {
          const s = worldToScreen(new THREE.Vector3(p.x, p.y, 0));
          const d = Math.hypot(s.x - cx, s.y - cy);
          if (d < bestPx) { bestPx = d; best = { kind, world: new THREE.Vector3(p.x, p.y, 0), entityId: e.id }; }
        }
      }
      return best;
    };

    const resolveWorld = (cx: number, cy: number, shift: boolean): { world: Point3; snap: SnapResult | null } => {
      const snap = findSnap(cx, cy);
      if (snap) return { world: { x: snap.world.x, y: snap.world.y, z: 0 }, snap };
      const raw = screenToWorld(cx, cy);
      const st = get();
      const anchor = st.basePoint ?? st.draftPoints[st.draftPoints.length - 1] ?? null;
      const world = (st.orthoMode || shift) && anchor ? applyOrtho(anchor, { x: raw.x, y: raw.y, z: 0 }) : { x: raw.x, y: raw.y, z: 0 };
      return { world, snap: null };
    };

    const raycastPick = (cx: number, cy: number): string | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((cx - r.left) / r.width) * 2 - 1;
      ndc.y = -((cy - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(refs.current.entityGroup.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.entityId) o = o.parent;
        if (o?.userData.entityId) return o.userData.entityId as string;
      }
      return null;
    };

    const handlePoint = (world: Point3) => {
      const st = get();
      switch (st.activeTool) {
        case 'DRAW_LINE':
          if (st.draftPoints.length === 0) st.pushPoint(world); else st.commitLine(st.draftPoints[0], world);
          break;
        case 'DRAW_POLYLINE':
          st.pushPoint(world);
          break;
        case 'DRAW_CIRCLE':
          if (st.draftPoints.length === 0) st.pushPoint(world); else st.commitCircle(st.draftPoints[0], dist2(st.draftPoints[0], world));
          break;
        case 'DRAW_RECTANGLE':
          if (st.draftPoints.length === 0) st.pushPoint(world); else st.commitRectangle(st.draftPoints[0], world);
          break;
        case 'MOVE_INTERACTIVE':
        case 'COPY_INTERACTIVE':
          if (!st.basePoint) { if (st.selection.size > 0) st.setBasePoint(world); }
          else st.commitMoveCopy({ x: world.x - st.basePoint.x, y: world.y - st.basePoint.y, z: 0 }, st.activeTool === 'COPY_INTERACTIVE');
          break;
        case 'SCALE_INTERACTIVE':
          if (!st.basePoint) { if (st.selection.size > 0) st.setBasePoint(world); }
          else {
            const ref = st.transformRef;
            const f = ref && ref > 1e-6 ? dist2(st.basePoint, world) / ref : 1;
            st.scaleSelection(st.basePoint, f);
            st.resetDraft();
          }
          break;
        case 'ROTATE_INTERACTIVE':
          if (!st.basePoint) { if (st.selection.size > 0) st.setBasePoint(world); }
          else {
            const ang = Math.atan2(world.y - st.basePoint.y, world.x - st.basePoint.x) - (st.transformRef ?? 0);
            st.rotateSelection(st.basePoint, ang);
            st.resetDraft();
          }
          break;
        case 'MEASURE':
          if (st.draftPoints.length === 0) st.pushPoint(world); else st.resetDraft();
          break;
        case 'DIMENSION':
          if (st.draftPoints.length < 2) st.pushPoint(world);
          else st.addDimension(st.draftPoints[0], st.draftPoints[1], signedOffset(st.draftPoints[0], st.draftPoints[1], world));
          break;
        default: break;
      }
      // A command that just finished releases the dynamic-input focus so the
      // keyboard (Esc → SELECT, command aliases) works without a mouse move.
      const after = get();
      if (after.draftPoints.length === 0 && !after.basePoint) {
        input.style.display = 'none';
        if (prevDrawing) input.blur();
        prevDrawing = false;
      }
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button === 2) { panning = true; lastPan = { x: ev.clientX, y: ev.clientY }; return; }
      if (ev.button !== 0) return;
      const { world } = resolveWorld(ev.clientX, ev.clientY, ev.shiftKey);
      const st = get();

      if (st.activeTool === 'SELECT') {
        const id = raycastPick(ev.clientX, ev.clientY);
        if (id) { st.select([id], ev.shiftKey); boxActive = false; return; }
        // empty space → begin a directional marquee
        boxActive = true; boxMoved = false; boxShift = ev.shiftKey; boxStart = { x: ev.clientX, y: ev.clientY };
        return;
      }
      if (st.activeTool === 'TRIM') { const id = raycastPick(ev.clientX, ev.clientY); if (id) st.trimEntity(id, world); return; }
      if (st.activeTool === 'OFFSET') {
        if (!st.pendingEntityId) { const id = raycastPick(ev.clientX, ev.clientY); if (id) st.setPendingEntity(id); }
        else st.offsetEntity(st.pendingEntityId, st.offsetDistance, world);
        return;
      }
      if (POINT_TOOLS.includes(st.activeTool)) handlePoint(world);
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (panning) {
        const dx = ev.clientX - lastPan.x, dy = ev.clientY - lastPan.y;
        lastPan = { x: ev.clientX, y: ev.clientY };
        const r = renderer.domElement.getBoundingClientRect();
        const wpp = (camera.right - camera.left) / camera.zoom / r.width;
        camera.position.x -= dx * wpp;
        camera.position.y += dy * wpp;
        return;
      }

      const wr = wrap.getBoundingClientRect();

      // update marquee box
      if (boxActive) {
        if (Math.hypot(ev.clientX - boxStart.x, ev.clientY - boxStart.y) > 3) boxMoved = true;
        const crossing = ev.clientX < boxStart.x; // right-to-left → green crossing
        const x0 = Math.min(ev.clientX, boxStart.x) - wr.left;
        const y0 = Math.min(ev.clientY, boxStart.y) - wr.top;
        box.style.display = boxMoved ? 'block' : 'none';
        box.style.left = `${x0}px`;
        box.style.top = `${y0}px`;
        box.style.width = `${Math.abs(ev.clientX - boxStart.x)}px`;
        box.style.height = `${Math.abs(ev.clientY - boxStart.y)}px`;
        box.style.border = `1px ${crossing ? 'dashed' : 'solid'} ${crossing ? '#5dff96' : '#4d9dff'}`;
        box.style.background = crossing ? 'rgba(93,255,150,0.10)' : 'rgba(77,157,255,0.10)';
      }

      const { world, snap } = resolveWorld(ev.clientX, ev.clientY, ev.shiftKey);
      const marker = refs.current.snapMarker!;
      if (snap) { marker.visible = true; marker.position.copy(snap.world); } else marker.visible = false;

      const st = get();
      st.setCursor(world);
      onCursor?.({ x: world.x - st.doc.origin.x, y: world.y - st.doc.origin.y, snap });
      if (coordsRef.current) coordsRef.current.textContent = `${(world.x - st.doc.origin.x).toFixed(3)}, ${(world.y - st.doc.origin.y).toFixed(3)}`;

      // Capture the scale/rotate reference once the cursor leaves the base point.
      if ((st.activeTool === 'SCALE_INTERACTIVE' || st.activeTool === 'ROTATE_INTERACTIVE') && st.basePoint && st.transformRef === null) {
        const b = st.basePoint;
        if (st.activeTool === 'ROTATE_INTERACTIVE') st.setTransformRef(Math.atan2(world.y - b.y, world.x - b.x));
        else { const d = Math.hypot(world.x - b.x, world.y - b.y); if (d > 1e-6) st.setTransformRef(d); }
      }

      // OSNAP tag: name the lock target next to the cursor.
      if (snap) {
        snapTag.style.display = 'block';
        snapTag.style.left = `${ev.clientX - wr.left + 14}px`;
        snapTag.style.top = `${ev.clientY - wr.top - 22}px`;
        snapTag.textContent = snap.kind;
      } else {
        snapTag.style.display = 'none';
      }

      const drawing = POINT_TOOLS.includes(st.activeTool) && (st.draftPoints.length > 0 || st.basePoint !== null);
      if (drawing) {
        input.style.display = 'block';
        input.style.left = `${ev.clientX - wr.left + 16}px`;
        input.style.top = `${ev.clientY - wr.top + 8}px`;
        if (!prevDrawing) { input.value = ''; input.focus(); }
      } else {
        input.style.display = 'none';
        if (prevDrawing) input.blur(); // hand focus back to the canvas/keyboard
      }
      prevDrawing = drawing;
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.button === 2) { panning = false; return; }
      if (ev.button !== 0 || !boxActive) return;
      boxActive = false;
      box.style.display = 'none';
      const st = get();
      if (!boxMoved) { if (!boxShift) st.clearSelection(); return; }
      const w1 = screenToWorld(boxStart.x, boxStart.y);
      const w2 = screenToWorld(ev.clientX, ev.clientY);
      const min = { x: Math.min(w1.x, w2.x), y: Math.min(w1.y, w2.y), z: 0 };
      const max = { x: Math.max(w1.x, w2.x), y: Math.max(w1.y, w2.y), z: 0 };
      st.selectInRect(min, max, ev.clientX < boxStart.x, boxShift);
    };

    const onContextMenu = (e: Event) => e.preventDefault();
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const before = screenToWorld(ev.clientX, ev.clientY);
      camera.zoom = THREE.MathUtils.clamp(camera.zoom / (ev.deltaY > 0 ? 1.1 : 1 / 1.1), 0.02, 500);
      camera.updateProjectionMatrix();
      const after = screenToWorld(ev.clientX, ev.clientY);
      camera.position.x += before.x - after.x;
      camera.position.y += before.y - after.y;
    };
    const onDblClick = () => {
      const st = get();
      if (st.activeTool === 'DRAW_POLYLINE') st.commitPolyline(st.draftPoints, false);
    };

    const commitDistance = (value: number) => {
      const st = get();
      // Scale/Rotate read the typed value as a factor / degrees, not a length.
      if (st.activeTool === 'SCALE_INTERACTIVE') { if (st.basePoint) { st.scaleSelection(st.basePoint, value); st.resetDraft(); } return; }
      if (st.activeTool === 'ROTATE_INTERACTIVE') { if (st.basePoint) { st.rotateSelection(st.basePoint, (value * Math.PI) / 180); st.resetDraft(); } return; }
      const anchor = st.basePoint ?? st.draftPoints[st.draftPoints.length - 1];
      if (!anchor || !st.cursorWorld) return;
      let hx = st.cursorWorld.x - anchor.x, hy = st.cursorWorld.y - anchor.y;
      const hl = Math.hypot(hx, hy);
      if (hl < 1e-9) { hx = 1; hy = 0; } else { hx /= hl; hy /= hl; }
      handlePoint({ x: anchor.x + hx * value, y: anchor.y + hy * value, z: 0 });
    };
    const onInputKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault(); ev.stopPropagation();
        const v = parseFloat(input.value);
        if (input.value.trim() !== '' && Number.isFinite(v)) {
          commitDistance(v);
        } else {
          // Empty Enter = finish the active command (e.g. close a polyline run).
          const st = get();
          if (st.activeTool === 'DRAW_POLYLINE') st.commitPolyline(st.draftPoints, false);
          else st.resetDraft();
        }
        input.value = '';
        const a = get();
        if (a.draftPoints.length === 0 && !a.basePoint) { input.style.display = 'none'; input.blur(); prevDrawing = false; }
      } else if (ev.key === 'Escape') {
        ev.preventDefault(); ev.stopPropagation();
        get().resetDraft(); input.value = '';
        input.style.display = 'none'; input.blur(); prevDrawing = false;
      }
    };

    // ---- command-alias parser (L / M / O / TR) ----------------------------
    const CMD: Record<string, () => void> = {
      L: () => get().setTool('DRAW_LINE'),
      M: () => get().setTool('MOVE_INTERACTIVE'),
      O: () => get().setTool('OFFSET'),
      TR: () => get().setTool('TRIM'),
    };
    const CMD_KEYS = Object.keys(CMD);
    let cmdBuf = '';
    let cmdTimer = 0;
    const feedCmd = (ch: string) => {
      cmdBuf += ch;
      if (cmdTimer) { clearTimeout(cmdTimer); cmdTimer = 0; }
      if (CMD[cmdBuf]) { CMD[cmdBuf](); cmdBuf = ''; return; }
      if (CMD_KEYS.some((k) => k.startsWith(cmdBuf))) { cmdTimer = window.setTimeout(() => { cmdBuf = ''; }, 800); return; }
      cmdBuf = ch; // current char wasn't a continuation — restart the buffer with it
      if (CMD[cmdBuf]) { CMD[cmdBuf](); cmdBuf = ''; }
      else if (CMD_KEYS.some((k) => k.startsWith(cmdBuf))) cmdTimer = window.setTimeout(() => { cmdBuf = ''; }, 800);
      else cmdBuf = '';
    };

    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (isTyping()) return;
      const st = get();
      if (ev.ctrlKey || ev.metaKey) {
        const k = ev.key.toLowerCase();
        if (k === 'z') { ev.preventDefault(); ev.shiftKey ? st.redo() : st.undo(); }
        else if (k === 'y') { ev.preventDefault(); st.redo(); }
        return;
      }
      if (ev.key === 'Escape') {
        cmdBuf = '';
        st.resetDraft();
        if (st.activeTool !== 'SELECT') st.setTool('SELECT'); else st.clearSelection();
        return;
      }
      if (ev.key === 'Enter') { if (st.activeTool === 'DRAW_POLYLINE') st.commitPolyline(st.draftPoints, false); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (st.activeTool === 'SELECT' && st.selection.size) st.deleteSelection();
        return;
      }
      if (ev.key === 'g' || ev.key === 'G') { st.toggleGrid(); return; } // grid on/off
      if (/^[a-zA-Z]$/.test(ev.key)) feedCmd(ev.key.toUpperCase());
    };

    const el = renderer.domElement;
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);
    input.addEventListener('keydown', onInputKey);

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight, a = w / h;
      camera.left = (-frustum * a) / 2; camera.right = (frustum * a) / 2;
      camera.top = frustum / 2; camera.bottom = -frustum / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // ---- scene synchronisation --------------------------------------------
    const rebuildEntities = (doc: CadDocument, selection: Set<string>) => {
      disposeGroup(refs.current.entityGroup);
      for (const e of doc.entities) {
        const layer = doc.layers.find((l) => l.id === e.layerId);
        if (layer && !layer.visible) continue;
        const base = e.colorOverride ?? layer?.color ?? '#ffffff';
        const obj = buildObject(e, selection.has(e.id) ? '#ff4d6d' : base, true);
        if (!obj) continue;
        obj.userData.entityId = e.id;
        refs.current.entityGroup.add(obj);
      }
    };

    // Preview never builds text sprites; live distances go to the HTML overlay.
    const rebuildPreview = (st: ReturnType<typeof get>) => {
      const g = refs.current.previewGroup;
      disposeGroup(g);
      const labels: OverlayLabel[] = [];
      const { activeTool: tool, draftPoints: dp, cursorWorld: cur, doc } = st;

      if (cur) {
        if (tool === 'DRAW_LINE' && dp.length === 1) g.add(lineObj([vec(dp[0]), vec(cur)], PREVIEW_COLOR));
        else if (tool === 'DRAW_POLYLINE' && dp.length >= 1) g.add(lineObj([...dp.map(vec), vec(cur)], PREVIEW_COLOR));
        else if (tool === 'DRAW_CIRCLE' && dp.length === 1) g.add(lineObj(circlePoints(dp[0], dist2(dp[0], cur)), PREVIEW_COLOR));
        else if (tool === 'DRAW_RECTANGLE' && dp.length === 1) {
          const a = dp[0];
          g.add(lineObj([vec(a), new THREE.Vector3(cur.x, a.y, 0), vec(cur), new THREE.Vector3(a.x, cur.y, 0), vec(a)], PREVIEW_COLOR));
        } else if ((tool === 'MOVE_INTERACTIVE' || tool === 'COPY_INTERACTIVE') && st.basePoint) {
          const d = { x: cur.x - st.basePoint.x, y: cur.y - st.basePoint.y };
          g.add(lineObj([vec(st.basePoint), vec(cur)], PREVIEW_COLOR));
          for (const e of doc.entities) {
            if (!st.selection.has(e.id)) continue;
            const ghost = buildObject(translate(e, d.x, d.y), PREVIEW_COLOR, false);
            if (ghost) g.add(ghost);
          }
        } else if (tool === 'SCALE_INTERACTIVE' && st.basePoint) {
          const base = st.basePoint;
          const f = st.transformRef && st.transformRef > 1e-6 ? dist2(base, cur) / st.transformRef : 1;
          g.add(lineObj([vec(base), vec(cur)], PREVIEW_COLOR));
          for (const e of doc.entities) {
            if (!st.selection.has(e.id)) continue;
            const ghost = buildObject(scaleEntity(e, base, f), PREVIEW_COLOR, false);
            if (ghost) g.add(ghost);
          }
          labels.push({ worldX: cur.x, worldY: cur.y, text: `×${f.toFixed(2)}` });
        } else if (tool === 'ROTATE_INTERACTIVE' && st.basePoint) {
          const base = st.basePoint;
          const ang = Math.atan2(cur.y - base.y, cur.x - base.x) - (st.transformRef ?? 0);
          g.add(lineObj([vec(base), vec(cur)], PREVIEW_COLOR));
          for (const e of doc.entities) {
            if (!st.selection.has(e.id)) continue;
            const ghost = buildObject(rotateEntity(e, base, ang), PREVIEW_COLOR, false);
            if (ghost) g.add(ghost);
          }
          labels.push({ worldX: cur.x, worldY: cur.y, text: `${((ang * 180) / Math.PI).toFixed(1)}°` });
        } else if (tool === 'MEASURE' && dp.length === 1) {
          g.add(lineObj([vec(dp[0]), vec(cur)], PREVIEW_COLOR));
          const m = mid2(dp[0], cur);
          labels.push({ worldX: m.x, worldY: m.y, text: `${dist2(dp[0], cur).toFixed(2)} mm` });
        } else if (tool === 'DIMENSION') {
          if (dp.length === 1) g.add(lineObj([vec(dp[0]), vec(cur)], PREVIEW_COLOR));
          else if (dp.length === 2) {
            const off = signedOffset(dp[0], dp[1], cur);
            g.add(buildDimension(dp[0], dp[1], off, PREVIEW_COLOR, false));
            const { a2, b2, len } = dimEndpoints(dp[0], dp[1], off);
            const m = mid2(a2, b2);
            labels.push({ worldX: m.x, worldY: m.y, text: len.toFixed(2) });
          }
        } else if (tool === 'OFFSET' && st.pendingEntityId) {
          const src = doc.entities.find((e) => e.id === st.pendingEntityId);
          const preview = src && computeOffset(src, st.offsetDistance, cur, 'preview');
          const obj = preview && buildObject(preview, PREVIEW_COLOR, false);
          if (obj) g.add(obj);
        }
      }
      labelsRef.current = labels;
    };

    // HTML overlay labels — reconciled against a div pool, projected each frame.
    const labelPool: HTMLDivElement[] = [];
    const renderLabels = () => {
      const labels = labelsRef.current;
      while (labelPool.length < labels.length) {
        const d = document.createElement('div');
        Object.assign(d.style, {
          position: 'absolute', transform: 'translate(-50%,-120%)', pointerEvents: 'none',
          font: '11px monospace', color: PREVIEW_COLOR, background: 'rgba(18,21,27,0.85)',
          padding: '1px 4px', borderRadius: '3px', whiteSpace: 'nowrap',
        } as CSSStyleDeclaration);
        overlay.appendChild(d);
        labelPool.push(d);
      }
      const wr = wrap.getBoundingClientRect();
      for (let i = 0; i < labelPool.length; i++) {
        const d = labelPool[i];
        if (i < labels.length) {
          const s = worldToScreen(new THREE.Vector3(labels[i].worldX, labels[i].worldY, 0));
          d.style.display = 'block';
          d.style.left = `${s.x - wr.left}px`;
          d.style.top = `${s.y - wr.top}px`;
          d.textContent = labels[i].text;
        } else {
          d.style.display = 'none';
        }
      }
    };

    let prevDoc = get().doc;
    let prevSel = get().selection;
    rebuildEntities(prevDoc, prevSel);
    rebuildPreview(get());
    const unsub = useCadStore.subscribe((s) => {
      if (s.doc !== prevDoc || s.selection !== prevSel) {
        prevDoc = s.doc; prevSel = s.selection;
        rebuildEntities(s.doc, s.selection);
      }
      const wantGrid = s.showGrid && s.doc.activeSpace === 'MODEL';
      if (grid.visible !== wantGrid) grid.visible = wantGrid;
      (scene.background as THREE.Color).set(s.doc.activeSpace === 'MODEL' ? '#12151b' : '#f4f4f4');
      rebuildPreview(s);
    });

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (refs.current.snapMarker) refs.current.snapMarker.scale.setScalar(1 / camera.zoom);
      // Pin the UCS widget to the lower-left of the live viewport each frame.
      const r = renderer.domElement.getBoundingClientRect();
      const ucsW = screenToWorld(r.left + 36, r.bottom - 30);
      ucs.position.set(ucsW.x, ucsW.y, 0);
      ucs.scale.setScalar(1 / camera.zoom);
      renderLabels();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      if (cmdTimer) clearTimeout(cmdTimer);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKey);
      input.removeEventListener('keydown', onInputKey);
      window.removeEventListener('resize', onResize);
      labelPool.forEach((d) => d.remove());
      disposeGroup(refs.current.entityGroup);
      disposeGroup(refs.current.previewGroup);
      renderer.dispose();
      mount.removeChild(el);
    };
  }, [onCursor, snapPixelRadius]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">

        {/* Model / Paper-space tabs */}
        <div className="flex border-b border-white/5 bg-panel text-xs text-ink">
          {(['MODEL', 'LAYOUT1', 'LAYOUT2'] as SpaceMode[]).map((mode) => (
            <button
              key={mode}
              className={`border-r border-white/5 px-4 py-1.5 font-medium tracking-wide transition-colors ${
                activeSpace === mode ? 'border-b border-b-accent bg-panel2 text-accent' : 'text-ink/70 hover:bg-panel2/50'}`}
              onClick={() => setSpaceMode(mode)}
            >{mode}</button>
          ))}
        </div>

        {/* Canvas + engine overlays (unchanged engine) */}
        <div ref={wrapRef} className="relative min-h-0 flex-1">
          <div ref={mountRef} className="absolute inset-0" />
          <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden">
            <div ref={boxRef} className="absolute hidden" style={{ display: 'none' }} />
            <div
              ref={snapTagRef}
              className="pointer-events-none absolute z-10 rounded bg-[#ffe169] px-1.5 py-0.5 text-[10px] font-medium text-black"
              style={{ display: 'none' }}
            />
          </div>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            placeholder="dist ⏎"
            className="absolute z-10 hidden w-24 rounded border border-accent/60 bg-panel2/95 px-2 py-1 font-mono text-xs text-ink outline-none"
            style={{ display: 'none' }}
          />
        </div>

        {/* Docked command-line console */}
        <div className="flex flex-col border-t border-white/5 bg-panel p-2 font-mono text-xs">
          <div className="mb-1 h-24 space-y-0.5 overflow-y-auto pr-2">
            {commandHistory.map((log, i) => (
              <div key={i} className="whitespace-pre-wrap leading-relaxed text-gray-400">{log}</div>
            ))}
            <div ref={historyEndRef} />
          </div>
          <form
            onSubmit={handleCmdSubmit}
            className="flex items-center rounded border border-white/10 bg-panel2 px-2 focus-within:border-accent"
          >
            <span className="mr-2 select-none font-semibold text-accent">COMMAND:</span>
            <input
              ref={commandInputRef}
              type="text"
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              className="flex-1 border-0 bg-transparent p-1 font-mono tracking-wide text-ink outline-none"
              placeholder="Type a command — LINE, TRIM, OFFSET, MOVE, REGEN, CLEAR…"
            />
          </form>
        </div>

        {/* Status-bar assist tray */}
        <div className="flex items-center justify-between border-t border-white/5 bg-[#1a1d24] px-3 py-1.5 font-mono text-[11px] text-gray-400 select-none">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleGrid}
              className={`rounded px-2 py-0.5 font-bold ${showGrid ? 'border border-accent/30 bg-accent/20 text-accent' : 'border border-white/5 bg-panel text-gray-500'}`}
            >GRID</button>
            <button
              onClick={toggleOrtho}
              className={`rounded px-2 py-0.5 font-bold ${orthoMode ? 'border border-accent/30 bg-accent/20 text-accent' : 'border border-white/5 bg-panel text-gray-500'}`}
            >ORTHO</button>
            <span className="ml-1 tracking-wider text-gray-600">{activeSpace}</span>
          </div>
          <div className="rounded border border-white/5 bg-panel2 px-2 py-0.5 tracking-wider">
            X,Y: <span ref={coordsRef} className="text-ink">0.000, 0.000</span>
          </div>
        </div>
      </div>

      {/* Contextual Properties palette */}
      <div className="flex w-72 shrink-0 flex-col border-l border-white/5 bg-panel p-3 text-xs text-ink">
        <h3 className="mb-3 border-b border-white/10 pb-2 text-xs font-bold uppercase tracking-wider text-accent">Properties</h3>
        {selectedEntity ? (
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            <PropGroup title="General">
              <PropRow k="ID" v={selectedEntity.id} />
              <PropRow k="Type" v={selectedEntity.type} />
              <PropRow k="Layer" v={selectedEntity.layerId} />
            </PropGroup>
            <PropGroup title="Geometry">
              {describeEntity(selectedEntity).map((m) => <PropRow key={m.label} k={m.label} v={m.value} />)}
            </PropGroup>
            <PropGroup title="Formatting">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Line Type</span>
                <select
                  value={selectedEntity.lineType ?? 'Continuous'}
                  onChange={(e) => updateEntityProperty(selectedEntity.id, { lineType: e.target.value as LineType })}
                  className="rounded border border-white/10 bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink"
                >
                  <option value="Continuous">Continuous</option>
                  <option value="Dashed">Dashed</option>
                  <option value="Dotted">Dotted</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Lineweight</span>
                <input
                  type="number" step={0.05} min={0.05}
                  value={selectedEntity.lineWeight ?? 0.25}
                  onChange={(e) => updateEntityProperty(selectedEntity.id, { lineWeight: Number(e.target.value) })}
                  className="w-16 rounded border border-white/10 bg-panel px-1.5 py-0.5 text-right font-mono text-[11px] text-ink"
                />
              </div>
            </PropGroup>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center text-gray-600">
            No selection.<br />Pick an entity to inspect its geometry.
          </div>
        )}
      </div>
    </div>
  );
}

function mapEntity(e: CadEntity, fn: (p: Point3) => Point3): CadEntity {
  switch (e.type) {
    case 'line':      return { ...e, start: fn(e.start), end: fn(e.end) };
    case 'polyline':  return { ...e, vertices: e.vertices.map(fn) };
    case 'circle':    return { ...e, center: fn(e.center) };
    case 'arc':       return { ...e, center: fn(e.center) };
    case 'text':      return { ...e, position: fn(e.position) };
    case 'dimension': return { ...e, a: fn(e.a), b: fn(e.b) };
  }
}

/** Translate every coordinate of an entity (for ghost previews). */
function translate(e: CadEntity, dx: number, dy: number): CadEntity {
  return mapEntity(e, (p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }));
}

/** Scale an entity about a pivot — mirrors the store's scaleSelection per entity. */
function scaleEntity(e: CadEntity, c: Point3, f: number): CadEntity {
  const moved = mapEntity(e, (p) => ({ x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f, z: p.z }));
  if (moved.type === 'circle' || moved.type === 'arc') return { ...moved, radius: moved.radius * f };
  if (moved.type === 'text') return { ...moved, height: moved.height * f };
  return moved;
}

/** Rotate an entity about a pivot — mirrors the store's rotateSelection. */
function rotateEntity(e: CadEntity, c: Point3, r: number): CadEntity {
  const cos = Math.cos(r), sin = Math.sin(r);
  const moved = mapEntity(e, (p) => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
    z: p.z,
  }));
  if (moved.type === 'text') return { ...moved, rotation: moved.rotation + r };
  if (moved.type === 'arc') return { ...moved, startAngle: moved.startAngle + r, endAngle: moved.endAngle + r };
  return moved;
}
