import React, { useState } from 'react';
import { Table2, Image, Mail, Headphones } from 'lucide-react';
import IMGResizer from './IMGResizer';
import TableMapper from './TableMapper';

const TABS = [
  { id: 'table', label: 'Table Mapper', Icon: Table2 },
  { id: 'img',   label: 'IMG Resizer',  Icon: Image },
  { id: 'edm',   label: 'EDM Builder',  Icon: Mail },
  { id: 'cs',    label: 'CS Template',  Icon: Headphones },
];

export default function App() {
  const [tab, setTab] = useState('table');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#030712' }}>

      {/* Tab Bar */}
      <nav style={{ height: 56, background: '#030712', borderBottom: '1px solid #1f2937', padding: '0 24px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4, background: '#111827', borderRadius: 12, padding: 4 }}>
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 16px', borderRadius: 8, border: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                transition: 'all 0.15s',
                background: tab === id ? '#2563eb' : 'transparent',
                color: tab === id ? '#fff' : '#9ca3af',
              }}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'table' && <TableMapper />}
        {tab === 'img'   && <IMGResizer />}
        {tab === 'edm'   && (
          <iframe src="https://edm-builder-ebon.vercel.app/"
            style={{ flex: 1, border: 'none', width: '100%' }} title="EDM Builder" />
        )}
        {tab === 'cs'    && (
          <iframe src="https://cs-template.vercel.app/"
            style={{ flex: 1, border: 'none', width: '100%' }} title="CS Template" />
        )}
      </div>

    </div>
  );
}
