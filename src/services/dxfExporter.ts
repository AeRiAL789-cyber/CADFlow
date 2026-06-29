// src/services/dxfExporter.ts
import type { CadDocument, CadEntity } from '../types/cad';

const tag = (code: number, value: string | number) => `${code}\n${value}\n`;

function entityDxf(e: CadEntity, layerName: string): string {
  switch (e.type) {
    case 'line':
      return tag(0, 'LINE') + tag(8, layerName) +
        tag(10, e.start.x) + tag(20, e.start.y) + tag(30, e.start.z) +
        tag(11, e.end.x) + tag(21, e.end.y) + tag(31, e.end.z);
    case 'polyline': {
      let s = tag(0, 'LWPOLYLINE') + tag(8, layerName) +
        tag(90, e.vertices.length) + tag(70, e.closed ? 1 : 0);
      for (const v of e.vertices) s += tag(10, v.x) + tag(20, v.y);
      return s;
    }
    case 'circle':
      return tag(0, 'CIRCLE') + tag(8, layerName) +
        tag(10, e.center.x) + tag(20, e.center.y) + tag(30, e.center.z) + tag(40, e.radius);
    case 'arc':
      return tag(0, 'ARC') + tag(8, layerName) +
        tag(10, e.center.x) + tag(20, e.center.y) + tag(30, e.center.z) + tag(40, e.radius) +
        tag(50, (e.startAngle * 180) / Math.PI) + tag(51, (e.endAngle * 180) / Math.PI);
    case 'text':
      return tag(0, 'TEXT') + tag(8, layerName) +
        tag(10, e.position.x) + tag(20, e.position.y) + tag(30, e.position.z) +
        tag(40, e.height) + tag(1, e.value) + tag(50, (e.rotation * 180) / Math.PI);
    case 'dimension': {
      // R12 has no portable associative DIMENSION; decompose to the dimension
      // line plus a distance label so the geometry round-trips into any reader.
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const a2x = e.a.x + nx * e.offset, a2y = e.a.y + ny * e.offset;
      const b2x = e.b.x + nx * e.offset, b2y = e.b.y + ny * e.offset;
      const lineSeg = (x1: number, y1: number, x2: number, y2: number) =>
        tag(0, 'LINE') + tag(8, layerName) +
        tag(10, x1) + tag(20, y1) + tag(30, 0) + tag(11, x2) + tag(21, y2) + tag(31, 0);
      return lineSeg(e.a.x, e.a.y, a2x, a2y) +
        lineSeg(e.b.x, e.b.y, b2x, b2y) +
        lineSeg(a2x, a2y, b2x, b2y) +
        tag(0, 'TEXT') + tag(8, layerName) +
        tag(10, (a2x + b2x) / 2) + tag(20, (a2y + b2y) / 2) + tag(30, 0) +
        tag(40, Math.max(1, len * 0.05)) + tag(1, len.toFixed(2));
    }
  }
}

/** Serialize a CadDocument to DXF R12 text. */
export function toDxf(doc: CadDocument): string {
  const layerById = new Map(doc.layers.map((l) => [l.id, l.name]));
  let out = '';
  out += tag(0, 'SECTION') + tag(2, 'ENTITIES');
  for (const e of doc.entities) out += entityDxf(e, layerById.get(e.layerId) ?? '0');
  out += tag(0, 'ENDSEC') + tag(0, 'EOF');
  return out;
}

/** Save via the File System Access API, with an anchor-download fallback. */
export async function saveDxf(doc: CadDocument, suggestedName = 'drawing.dxf'): Promise<void> {
  const text = toDxf(doc);
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{
      createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };

  if (w.showSaveFilePicker) {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'DXF', accept: { 'application/dxf': ['.dxf'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  const blob = new Blob([text], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
}
