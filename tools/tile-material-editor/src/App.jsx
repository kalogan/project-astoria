import React, { useState } from 'react';
import { P, DEFAULT_CONFIG, deepClone } from './constants';
import TileMaterialTab from './TileMaterialTab';
import MapEditorTab    from './MapEditorTab';

const TABS = [
  { id: 'materials', label: 'TILE MATERIALS' },
  { id: 'map',       label: 'MAP EDITOR'     },
];

function TabBar({ activeTab, onTab }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: P.panel, borderBottom: `1px solid ${P.border}`,
      padding: '0 20px', height: 44, flexShrink: 0,
    }}>
      <span style={{ color: P.accent, fontSize: 10, letterSpacing: 5, marginRight: 28 }}>
        PROJECT ASTORIA
      </span>
      {TABS.map(({ id, label }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTab(id)}
            style={{
              background:    'transparent',
              border:        'none',
              borderBottom:  `2px solid ${active ? P.accent : 'transparent'}`,
              color:         active ? P.accent : P.muted,
              fontFamily:    'monospace',
              fontSize:      10,
              letterSpacing: 3,
              padding:       '0 16px',
              height:        '100%',
              cursor:        'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('materials');
  // config is lifted so both tabs share the same tile material definitions.
  // TileMaterialTab can edit it; MapEditorTab reads it for color rendering.
  const [config, setConfig] = useState(deepClone(DEFAULT_CONFIG));

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', width: '100vw',
      fontFamily: 'monospace', background: P.bg, overflow: 'hidden',
    }}>
      <TabBar activeTab={activeTab} onTab={setActiveTab} />

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab === 'materials' && (
          <TileMaterialTab config={config} setConfig={setConfig} />
        )}
        {activeTab === 'map' && (
          <MapEditorTab config={config} />
        )}
      </div>
    </div>
  );
}
