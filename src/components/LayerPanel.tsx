import { useCadStore } from '../state/cadStore';

export default function LayerPanel() {
  const { doc, activeLayerId, addLayer, updateLayer, removeLayer, setActiveLayer } = useCadStore();

  return (
    <div className="w-64 shrink-0 bg-panel p-3 text-ink">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Layers</h2>
        <button
          className="rounded bg-accent px-2 py-0.5 text-xs text-black"
          onClick={() => addLayer(`Layer ${doc.layers.length + 1}`, '#9ad0ff')}
        >+ New</button>
      </div>

      <ul className="space-y-1">
        {doc.layers.map((l) => (
          <li
            key={l.id}
            className={`rounded px-2 py-1 text-xs ${activeLayerId === l.id ? 'bg-panel2' : ''}`}
            onClick={() => setActiveLayer(l.id)}
          >
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={l.visible}
                onChange={(e) => updateLayer(l.id, { visible: e.target.checked })} />
              <input type="color" value={l.color} className="h-4 w-4 border-0 bg-transparent p-0"
                onChange={(e) => updateLayer(l.id, { color: e.target.value })} />
              <span className="flex-1 truncate">{l.name}</span>
              <button title="Lock" onClick={() => updateLayer(l.id, { locked: !l.locked })}>
                {l.locked ? '🔒' : '🔓'}
              </button>
              <button title="Delete" onClick={() => removeLayer(l.id)}>✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
