import { useRef, useState } from 'react';
import { useCadStore, type Tool } from '../state/cadStore';
import { PdfConverter } from '../services/PdfConverter';
import { saveDxf } from '../services/dxfExporter';

const TOOL_GROUPS: { label: string; tools: { id: Tool; label: string; hint?: string }[] }[] = [
  {
    label: 'Draw',
    tools: [
      { id: 'DRAW_LINE', label: 'Line', hint: 'L' },
      { id: 'DRAW_POLYLINE', label: 'Polyline' },
      { id: 'DRAW_CIRCLE', label: 'Circle' },
      { id: 'DRAW_RECTANGLE', label: 'Rect' },
    ],
  },
  {
    label: 'Modify',
    tools: [
      { id: 'MOVE_INTERACTIVE', label: 'Move', hint: 'M' },
      { id: 'COPY_INTERACTIVE', label: 'Copy' },
      { id: 'SCALE_INTERACTIVE', label: 'Scale' },
      { id: 'ROTATE_INTERACTIVE', label: 'Rotate' },
      { id: 'TRIM', label: 'Trim', hint: 'TR' },
      { id: 'OFFSET', label: 'Offset', hint: 'O' },
    ],
  },
  {
    label: 'Annotate',
    tools: [
      { id: 'MEASURE', label: 'Measure' },
      { id: 'DIMENSION', label: 'Dim' },
    ],
  },
];

export default function Toolbar() {
  const {
    activeTool, setTool, setDocument, clearDocument, doc, deleteSelection,
    orthoMode, toggleOrtho, offsetDistance, setOffsetDistance,
    showGrid, toggleGrid, undo, redo, past, future,
  } = useCadStore();

  const fileRef = useRef<HTMLInputElement>(null);
  const bufRef = useRef<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);

  const onImport = async (file: File) => {
    const buf = await file.arrayBuffer();
    bufRef.current = buf;
    // pdf.js may neuter the passed buffer, so hand each call its own copy.
    const count = await PdfConverter.getPageCount(buf.slice(0));
    setPageCount(count);
    setPage(1);
    setDocument(await PdfConverter.convert(buf.slice(0), { pageNumber: 1 }));
  };

  const onPage = async (p: number) => {
    if (!bufRef.current) return;
    setPage(p);
    setDocument(await PdfConverter.convert(bufRef.current.slice(0), { pageNumber: p }));
  };

  const btn = (id: Tool, label: string, hint?: string) => (
    <button
      key={id}
      title={hint ? `${label} (${hint})` : label}
      className={`rounded px-2.5 py-1 text-xs ${activeTool === id ? 'bg-accent text-black' : 'bg-panel'}`}
      onClick={() => setTool(id)}
    >{label}</button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 bg-panel2 px-3 py-2 text-ink">
      <span className="mr-1 font-semibold text-accent">CADFlow</span>

      {btn('SELECT', 'Select')}

      <button className="rounded bg-panel px-2.5 py-1 text-xs" onClick={() => fileRef.current?.click()}>
        Import PDF
      </button>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
        onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />

      <button
        className="rounded bg-panel px-2.5 py-1 text-xs hover:bg-red-600/70"
        title="Clear Layout — wipe all geometry (undoable)"
        onClick={clearDocument}
      >Clear Layout</button>

      {pageCount > 1 && (
        <label className="flex items-center gap-1 text-xs text-ink/70">
          Page
          <select
            value={page}
            className="rounded bg-panel px-1.5 py-1 text-xs text-ink outline-none"
            onChange={(e) => onPage(Number(e.target.value))}
          >
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>{p} / {pageCount}</option>
            ))}
          </select>
        </label>
      )}

      {TOOL_GROUPS.map((grp) => (
        <div key={grp.label} className="flex items-center gap-1">
          <span className="ml-2 mr-0.5 text-[10px] uppercase tracking-wide text-ink/40">{grp.label}</span>
          {grp.tools.map((t) => btn(t.id, t.label, t.hint))}
        </div>
      ))}

      <div className="mx-1 h-5 w-px bg-white/10" />

      <button
        className={`rounded px-2.5 py-1 text-xs ${orthoMode ? 'bg-accent text-black' : 'bg-panel'}`}
        title="Orthogonal tracking (or hold Shift)"
        onClick={toggleOrtho}
      >Ortho</button>

      <button
        className={`rounded px-2.5 py-1 text-xs ${showGrid ? 'bg-accent text-black' : 'bg-panel'}`}
        title="Toggle grid (G)"
        onClick={toggleGrid}
      >Grid</button>

      <label className="flex items-center gap-1 text-xs text-ink/70">
        Offset
        <input
          type="number"
          value={offsetDistance}
          min={0}
          step={1}
          className="w-16 rounded bg-panel px-1.5 py-1 text-xs text-ink outline-none"
          onChange={(e) => setOffsetDistance(Number(e.target.value) || 0)}
        />
      </label>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <button
        className="rounded bg-panel px-2.5 py-1 text-xs disabled:opacity-30"
        title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}
      >↶ Undo</button>
      <button
        className="rounded bg-panel px-2.5 py-1 text-xs disabled:opacity-30"
        title="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}
      >↷ Redo</button>

      <button className="rounded bg-panel px-2.5 py-1 text-xs" onClick={deleteSelection}>Delete</button>
      <button className="rounded bg-green-600 px-2.5 py-1 text-xs" onClick={() => saveDxf(doc)}>Export DXF</button>
    </div>
  );
}
