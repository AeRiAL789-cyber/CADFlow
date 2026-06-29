import CadViewport from './components/CadViewport';
import Toolbar from './components/Toolbar';
import LayerPanel from './components/LayerPanel';

export default function App() {
  return (
    <div className="flex h-screen flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LayerPanel />
        <div className="min-w-0 min-h-0 flex-1">
          <CadViewport />
        </div>
      </div>
    </div>
  );
}
