import React, { useState } from 'react';
import { Table2, Image, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import TableMapper from './TableMapper';
import IMGResizer from './IMGResizer';

export default function App() {
  const [tab, setTab] = useState('table');

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      <nav className="sticky top-0 z-30 h-14 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-6 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-gray-900 rounded-xl p-1">
          {[
            { id: 'table', label: 'Table Mapper', Icon: Table2 },
            { id: 'img',   label: 'IMG Resizer',  Icon: Image  },
            { id: 'edm',   label: 'EDM Builder',  Icon: Mail   },
          ].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                tab === id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      </nav>

      <AnimatePresence mode="wait">
        {tab === 'table' && (
          <motion.div key="table" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.15 }}>
            <TableMapper />
          </motion.div>
        )}
        {tab === 'img' && (
          <motion.div key="img" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.15 }}>
            <IMGResizer />
          </motion.div>
        )}
        {tab === 'edm' && (
          <motion.div key="edm" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.15 }}
            style={{ height: 'calc(100vh - 56px)' }}>
            <iframe
              src="https://edm-builder-ebon.vercel.app/"
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="EDM Builder"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
