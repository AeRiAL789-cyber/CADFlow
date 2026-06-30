# CADFlow

A lightweight, fully client-side **2D CAD viewer, editor, and PDF→CAD converter**.
Reads vector PDFs in the browser, heals the raw geometry into clean CAD entities,
and lets you edit and export to DXF — no server, no backend.

## Stack
- **React + TypeScript + Vite + TailwindCSS**
- **Three.js** (OrthographicCamera, strict 2D top-down)
- **pdfjs-dist** for in-browser vector + text extraction
- **Zustand** for document/selection state
- File System Access API + custom DXF R12 exporter

## Features
- **PDF→CAD engine** — walks the PDF operator list (`moveTo`/`lineTo`/`curveTo`/`constructPath`),
  applies the live CTM, scales points to millimetres, and extracts native text with position + rotation.
- **Geometric healing** — chains coincident segments (0.05 mm weld tolerance) into polylines.
- **Arc/circle reconstruction** — Kåsa least-squares circle fit promotes smooth chord clusters to math `Circle`/`Arc` entities.
- **Interactive viewport** — cursor-centred zoom, right-click pan, raycast selection (thin-line threshold),
  Endpoint/Midpoint/Center screen-space snapping, live coordinate readout relative to a custom origin.
- **Drafting tools** — a centralized tool state machine: Line, Polyline (rubber-band, Enter/double-click to commit),
  Circle (center-radius), Rectangle, plus interactive Move / Copy with a live base-point→cursor offset.
- **Modify engines** — Trim (raycast a line target, split it at every intersection with other entities, drop the
  span under the cursor) and Offset (parallel copy biased to the cursor side; lines, circles, polylines).
- **Drafting constraints** — Ortho mode (or hold Shift) locks to 90° axes; a floating dynamic-input box accepts a
  typed distance and extends along the current heading; Endpoint/Midpoint/Center snapping overrides both.
- **Annotation** — Measure (live distance) and aligned Dimension entities with extension lines, arrows, and text.
- **Interactive transforms** — Move / Copy / Scale / Rotate all wait for a base-point click, then drag-preview the
  selection live (ghosted) before a second click commits; type an exact distance / factor / angle to commit precisely.
- **Grip editing** — selected entities show draggable handles (blue, red while hot): line endpoints + midpoint,
  polyline vertices, circle center + radius, arc/text/dimension anchors. Drag to stretch in real time; grips snap to
  other geometry and the whole stretch is one undo step.
- **Clear Layout** — one button wipes all geometry, drops selections, resets the origin to `(0,0,0)`, and disposes the
  WebGL groups (undoable).
- **Grid toggle** — `G` (or the toolbar button) shows/hides the infinite reference grid.
- **OSNAP tag** — snapping to an Endpoint / Midpoint / Center floats a labelled tag beside the cursor.
- **Command line** — a docked console with scrollable prompt history; type `LINE`, `TRIM`, `OFFSET`, `MOVE`, `REGEN`,
  `CLEAR`, etc. (or their aliases) to drive the same tool state machine as the toolbar and keyboard.
- **Properties palette** — a right-docked inspector that reports computed geometry (length, radius, area, angle, sweep)
  for the selected entity and edits its lineweight / linetype.
- **Model & paper space** — `MODEL` / `LAYOUT1` / `LAYOUT2` tabs; layouts switch to a white sheet background, hide the
  grid, and set a viewport scale (1:50 default).
- **Status bar + UCS widget** — `GRID` / `ORTHO` toggles and a live X,Y readout; a red-X / green-Y UCS axis indicator
  pinned to the viewport's lower-left.
- **Undo / redo** — a 50-step history ring snapshots the document before every commit (`Ctrl+Z` / `Ctrl+Y`).
- **Directional selection** — drag left→right for a strict **window** (blue, fully-enclosed only) or right→left for a
  **crossing** box (green, anything touched).
- **Command aliases** — `L` Line · `M` Move · `O` Offset · `TR` Trim · `Esc` drop selection / back to Select.
- **Multi-page PDF** — the page count drives a toolbar selector; pick any page to re-import.
- **Layers** — create, show/hide, lock, recolour; PDF content lands on `PDF_Geometry` / `PDF_Text`.

## Performance
Live dynamic text (Measure / Dimension distances) renders as projected HTML overlay labels, not WebGL canvas
textures — so continuous dragging allocates nothing per frame. Committed entity geometry only re-tessellates when the
document or selection actually changes; cursor movement only rebuilds the lightweight preview group.

## Tool reference
| Tool | Flow |
|---|---|
| Line | click start → click end |
| Polyline | click vertices → Enter / double-click to finish, Esc to cancel |
| Circle | click center → click radius |
| Rectangle | click corner A → click corner B (writes a closed polyline) |
| Move / Copy | select first → click base point → click destination |
| Trim | click the line segment to remove (between its intersections) |
| Offset | set distance in toolbar → click source entity → click side |
| Measure / Dim | click A → click B (Dim: → click to set offset side) |

Type a number while drawing and press Enter for exact direct-distance entry; press Enter on an empty input to finish
the command (e.g. close a polyline).

## Keyboard
| Key | Action |
|---|---|
| `L` / `M` / `O` / `TR` | Line / Move / Offset / Trim |
| `G` | Toggle grid |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Enter` | Finish polyline / direct-distance commit |
| `Esc` | Cancel draft, drop selection, back to Select |
| `Delete` | Delete selection (Select tool) |
| Hold `Shift` | Temporary Ortho while drawing |

## Document schema
The internal JSON (`src/types/cad.ts`) stores every coordinate as a `Point3`
(`z` defaults to 0), so the schema scales to a future 3D phase without breaking changes.

## Project layout
```
src/
  types/cad.ts          Document JSON schema (3D-ready)
  math/geometry.ts      Pure linear-algebra helpers
  services/
    PdfConverter.ts     Vector extraction + scaling + reconstruction entry
    reconstruct.ts      Healing + arc/circle detection
    dxfExporter.ts      CadDocument -> DXF R12
  state/cadStore.ts     Zustand document/selection store + edit ops
  components/
    CadViewport.tsx     Three.js canvas: render loop, raycast, snap, grid
    LayerPanel.tsx      Layer CRUD / visibility / lock / colour
    Toolbar.tsx         Import / transform tools / export
    CoordinateOverlay.tsx  Live X/Y readout
```

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build && npm run preview
```

## Notes
- Pin `pdfjs-dist@4.5.x` — the `constructPath` argument shape shifts across pdf.js majors,
  and `PdfConverter.ts` is coded against the 4.5 form (with a legacy flat-op fallback).
- Grip-drag handles and the double-click inline text editor are the next pass; the store
  methods `setEntityPoint`, `setCircleRadius`, and `setText` already back them.
