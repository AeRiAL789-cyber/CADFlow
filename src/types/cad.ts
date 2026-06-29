// src/types/cad.ts
//
// Internal JSON schema for a CADFlow document.
// Every positional value is a Point3 so the 2D engine and a future 3D engine
// share one schema. In the 2D phase z is always 0; nothing else must change
// when Vector3 geometry is introduced.

export interface Point2 {
  x: number;
  y: number;
}

/** Canonical positional type. z defaults to 0 in the 2D phase. */
export interface Point3 extends Point2 {
  z: number;
}

export type EntityType = 'line' | 'polyline' | 'circle' | 'arc' | 'text' | 'dimension';

export interface BaseEntity {
  id: string;
  type: EntityType;
  layerId: string;
  /** Per-entity colour override; falls back to the layer colour when null. */
  colorOverride: string | null;
  /** Free-form provenance: source PDF op index, original CTM, etc. */
  meta?: Record<string, unknown>;
}

export interface LineEntity extends BaseEntity {
  type: 'line';
  start: Point3;
  end: Point3;
}

export interface PolylineEntity extends BaseEntity {
  type: 'polyline';
  vertices: Point3[];
  closed: boolean;
}

export interface CircleEntity extends BaseEntity {
  type: 'circle';
  center: Point3;
  radius: number;
}

export interface ArcEntity extends BaseEntity {
  type: 'arc';
  center: Point3;
  radius: number;
  /** Radians, CCW, measured in the XY plane. */
  startAngle: number;
  endAngle: number;
}

export interface TextEntity extends BaseEntity {
  type: 'text';
  position: Point3;
  value: string;
  /** Cap height in document units. */
  height: number;
  /** Radians, CCW in the XY plane. */
  rotation: number;
}

export interface DimensionEntity extends BaseEntity {
  type: 'dimension';
  /** Measured points. */
  a: Point3;
  b: Point3;
  /** Signed perpendicular distance of the dimension line from segment a→b. */
  offset: number;
}

export type CadEntity =
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | TextEntity
  | DimensionEntity;

export interface Layer {
  id: string;
  name: string;
  color: string;   // hex, e.g. "#7fd1ff"
  visible: boolean;
  locked: boolean;
}

export type DocumentUnits = 'mm' | 'in';

export interface CadDocument {
  version: string;
  units: DocumentUnits;
  /** User-defined origin. The coordinate overlay reports positions relative to this. */
  origin: Point3;
  layers: Layer[];
  entities: CadEntity[];
}

/** Default structural layers assigned to imported PDF content. */
export const DEFAULT_LAYERS: Layer[] = [
  { id: 'pdf_geometry', name: 'PDF_Geometry', color: '#7fd1ff', visible: true, locked: false },
  { id: 'pdf_text',     name: 'PDF_Text',     color: '#ffd479', visible: true, locked: false },
];

export function createEmptyDocument(): CadDocument {
  return {
    version: '1.0',
    units: 'mm',
    origin: { x: 0, y: 0, z: 0 },
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    entities: [],
  };
}

export const pt = (x: number, y: number, z = 0): Point3 => ({ x, y, z });
