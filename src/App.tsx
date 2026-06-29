import { useState } from 'react';
import CadViewport, { type CursorInfo } from './components/CadViewport';
import Toolbar from './components/Toolbar';
import LayerPanel from './components/LayerPanel';
import CoordinateOverlay from './components/CoordinateOverlay';

export default function App() {
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  return (
    <div className="flex h-screen flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LayerPanel />
        <div className="relative min-w-0 flex-1">
          <CadViewport onCursor={setCursor} />
          <CoordinateOverlay cursor={cursor} />
        </div>
      </div>
    </div>
  );
}
