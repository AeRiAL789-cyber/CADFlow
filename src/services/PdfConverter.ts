// src/services/PdfConverter.ts
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves the worker to a hashed URL; pdfjs needs it set before any load.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

import type { CadDocument, CadEntity, LineEntity, TextEntity, Point2, Point3 } from '../types/cad';
import { createEmptyDocument, pt } from '../types/cad';
import { reconstruct, type ReconstructOptions } from './reconstruct';

/** 1 PDF point = 1/72 inch = 0.352777… mm. */
const PT_TO_MM = 25.4 / 72;

type Matrix = [number, number, number, number, number, number]; // [a,b,c,d,e,f]

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Apply a PDF transform matrix to a point in PDF user space. */
const apply = (m: Matrix, x: number, y: number): Point2 => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

export interface ConvertOptions {
  pageNumber: number;           // 1-based
  /** Document units per PDF point. Default maps points → millimetres. */
  unitsPerPoint: number;
  /** Flatten bézier curves to this many line segments before reconstruction. */
  bezierSteps: number;
  reconstruct: Partial<ReconstructOptions>;
}

export const DEFAULT_CONVERT: ConvertOptions = {
  pageNumber: 1,
  unitsPerPoint: PT_TO_MM,
  bezierSteps: 12,
  reconstruct: {},
};

let _seq = 0;
const nid = (p: string): string => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

/** Cubic bézier sampling — keeps curve fidelity for the reconstruction stage. */
function sampleBezier(p0: Point2, p1: Point2, p2: Point2, p3: Point2, steps: number): Point2[] {
  const out: Point2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return out;
}

export class PdfConverter {
  /** Page count of a PDF without converting it (drives the page selector). */
  static async getPageCount(data: ArrayBuffer): Promise<number> {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const n = pdf.numPages;
    pdf.destroy();
    return n;
  }

  /** Convert one page of a PDF (as ArrayBuffer) into a CadDocument. */
  static async convert(
    data: ArrayBuffer,
    options: Partial<ConvertOptions> = {},
  ): Promise<CadDocument> {
    const opt: ConvertOptions = { ...DEFAULT_CONVERT, ...options };
    const doc = createEmptyDocument();

    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(opt.pageNumber);

    const rawGeometry = await PdfConverter.extractGeometry(page, opt);
    const textEntities = await PdfConverter.extractText(page, opt);

    // Heal + promote arcs/circles only on geometry; text passes straight through.
    const healed = reconstruct(rawGeometry, opt.reconstruct);

    doc.entities = [...healed, ...textEntities];
    return doc;
  }

  /**
   * Walk the page operator list, tracking the CTM stack, and emit one
   * LineEntity per straight chord (curves are pre-flattened). The scale
   * (PDF points → document units) is folded into the base matrix so every
   * emitted vertex is already in document space.
   */
  private static async extractGeometry(
    page: pdfjsLib.PDFPageProxy,
    opt: ConvertOptions,
  ): Promise<LineEntity[]> {
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;

    const s = opt.unitsPerPoint;
    const base: Matrix = [s, 0, 0, s, 0, 0]; // global PDF→document scaling
    let ctm: Matrix = base;
    const stack: Matrix[] = [];

    const out: LineEntity[] = [];
    let cur: Point2 | null = null;   // current point (document space)
    let startPt: Point2 | null = null;

    const emitLine = (a: Point2, b: Point2) => {
      out.push({
        id: nid('line'), type: 'line', layerId: 'pdf_geometry',
        colorOverride: null,
        start: pt(a.x, a.y), end: pt(b.x, b.y),
      });
    };

    // Replays the path sub-operators pdf.js bundles into constructPath, as well
    // as the legacy flat moveTo/lineTo/curveTo form.
    const runPathOp = (fn: number, args: number[] | unknown[]) => {
      const a = args as number[];
      switch (fn) {
        case OPS.moveTo: {
          cur = apply(ctm, a[0], a[1]);
          startPt = cur;
          break;
        }
        case OPS.lineTo: {
          const p = apply(ctm, a[0], a[1]);
          if (cur) emitLine(cur, p);
          cur = p;
          break;
        }
        case OPS.curveTo: {
          // [x1,y1, x2,y2, x3,y3] control points in PDF space.
          if (!cur) break;
          const c1 = apply(ctm, a[0], a[1]);
          const c2 = apply(ctm, a[2], a[3]);
          const end = apply(ctm, a[4], a[5]);
          let prev = cur;
          for (const sp of sampleBezier(cur, c1, c2, end, opt.bezierSteps)) {
            emitLine(prev, sp);
            prev = sp;
          }
          cur = end;
          break;
        }
        case OPS.rectangle: {
          const [x, y, w, h] = a;
          const p0 = apply(ctm, x, y);
          const p1 = apply(ctm, x + w, y);
          const p2 = apply(ctm, x + w, y + h);
          const p3 = apply(ctm, x, y + h);
          emitLine(p0, p1); emitLine(p1, p2); emitLine(p2, p3); emitLine(p3, p0);
          cur = p0; startPt = p0;
          break;
        }
        case OPS.closePath: {
          if (cur && startPt) emitLine(cur, startPt);
          cur = startPt;
          break;
        }
        default: break;
      }
    };

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      switch (fn) {
        case OPS.save:
          stack.push(ctm);
          break;
        case OPS.restore:
          ctm = stack.pop() ?? base;
          break;
        case OPS.transform: {
          const m = args as unknown as Matrix;
          ctm = mul(ctm, m);
          break;
        }
        case OPS.constructPath: {
          // Modern pdf.js: args = [ subOpArray, flatCoordArray, minMax? ].
          const subOps = (args as unknown[])[0] as number[];
          const flat = (args as unknown[])[1] as number[];
          let k = 0;
          const take = (n: number) => flat.slice(k, (k += n));
          for (const sub of subOps) {
            switch (sub) {
              case OPS.moveTo:    runPathOp(OPS.moveTo, take(2)); break;
              case OPS.lineTo:    runPathOp(OPS.lineTo, take(2)); break;
              case OPS.curveTo:   runPathOp(OPS.curveTo, take(6)); break;
              case OPS.rectangle: runPathOp(OPS.rectangle, take(4)); break;
              case OPS.closePath: runPathOp(OPS.closePath, []); break;
              default: break;
            }
          }
          break;
        }
        // Legacy flat path ops (older pdf.js builds).
        case OPS.moveTo: case OPS.lineTo: case OPS.curveTo:
        case OPS.rectangle: case OPS.closePath:
          runPathOp(fn, args);
          break;
        default:
          break;
      }
    }
    return out;
  }

  /**
   * Extract native PDF text. Each item's transform encodes position, scale and
   * rotation; we fold the global unit scale in and read rotation from the
   * matrix's first column.
   */
  private static async extractText(
    page: pdfjsLib.PDFPageProxy,
    opt: ConvertOptions,
  ): Promise<TextEntity[]> {
    const content = await page.getTextContent();
    const s = opt.unitsPerPoint;
    const out: TextEntity[] = [];

    for (const item of content.items) {
      // pdf.js TextItem (skip TextMarkedContent, which has no transform).
      if (!('str' in item) || !('transform' in item)) continue;
      const str = (item as { str: string }).str;
      if (!str.trim()) continue;

      const t = (item as { transform: number[] }).transform; // [a,b,c,d,e,f]
      const position: Point3 = pt(t[4] * s, t[5] * s);
      const rotation = Math.atan2(t[1], t[0]);
      const height = Math.hypot(t[2], t[3]) * s || (10 * s);

      out.push({
        id: nid('txt'), type: 'text', layerId: 'pdf_text',
        colorOverride: null,
        position, value: str, height, rotation,
      });
    }
    return out;
  }
}

export type { CadEntity, CadDocument };
