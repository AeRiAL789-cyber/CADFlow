import type { CursorInfo } from './CadViewport';

export default function CoordinateOverlay({ cursor }: { cursor: CursorInfo | null }) {
  return (
    <div className="absolute bottom-3 left-3 rounded bg-panel2/90 px-3 py-1.5 font-mono text-xs text-ink shadow">
      <span>X: {(cursor?.x ?? 0).toFixed(3)}</span>
      <span className="ml-4">Y: {(cursor?.y ?? 0).toFixed(3)}</span>
      {cursor?.snap && <span className="ml-4 text-accent">⊕ {cursor.snap.kind}</span>}
    </div>
  );
}
