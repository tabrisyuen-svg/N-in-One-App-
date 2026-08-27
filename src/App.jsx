import React, { useState, useRef, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, X, Settings, FileArchive, Image, Trash2,
  AlertCircle, CheckCircle2, RefreshCw, Layers, Tag, Crop, Maximize2, Loader2,
  Plus, Download, Table2, ChevronRight, FileSpreadsheet, ArrowRight, Wand2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Tab Config ────────────────────────────────────────────────────────────────
// 新增 APP 只需在這裡加一行，其餘不用改
const APPS = [
  { id: 'image',  label: '圖片批量處理', Icon: Image  },
  { id: 'mapper', label: 'Table Mapper',  Icon: Table2 },
];

// ══════════════════════════════════════════════════════════════════════════════
// IMG RENAME RESIZE — 常數 & 工具函式
// ══════════════════════════════════════════════════════════════════════════════
const SIZES = [
  { w: 1080, h: 1080, fit: 'cover',   label: '1080 × 1080', ratio: '1 / 1'  },
  { w: 1080, h: 1080, fit: 'contain', label: '1080 × 1080', ratio: '1 / 1'  },
  { w: 1920, h: 1080, fit: 'cover',   label: '1920 × 1080', ratio: '16 / 9' },
  { w: 1920, h: 1080, fit: 'contain', label: '1920 × 1080', ratio: '16 / 9' },
];
const MAX_IMAGES     = 10;
const OFFSET_OPTIONS = [0,1,2,3,4,5,6,7,8,9,10,15,20];
const BG_PRESETS     = ['#ffffff','#f3f4f6','#1f2937','#000000'];
const RES_OPTIONS    = [
  { value: '1080', label: '1080', sub: '1080 × 1080' },
  { value: '1920', label: '1920', sub: '1920 × 1080' },
];
const MODE_OPTIONS = [
  { value: 'crop',   label: 'Crop',   sub: '裁切填滿', Icon: Crop,      active: 'border-blue-500 bg-blue-500/10 text-blue-300',     dot: 'bg-blue-500'   },
  { value: 'fit',    label: 'Fit',    sub: '等比置中', Icon: Maximize2, active: 'border-purple-500 bg-purple-500/10 text-purple-300', dot: 'bg-purple-500' },
  { value: 'rename', label: 'Rename', sub: '只重命名', Icon: Tag,       active: 'border-amber-500 bg-amber-500/10 text-amber-300',   dot: 'bg-amber-500'  },
];

const buildPrefix    = (brand, sku) => { const b = brand.trim(), s = sku.trim(); return b && s ? `${b}-${s}` : b || s || ''; };
const buildImageName = (brand, sku, i, offset = 0) => { const num = String(i + 1 + offset).padStart(2, '0'); const p = buildPrefix(brand, sku); return p ? `${p}-${num}.jpg` : `${num}.jpg`; };
const buildZipName   = (brand, sku) => { const p = buildPrefix(brand, sku); return p ? `${p}.zip` : 'images.zip'; };

const pLimit = (concurrency) => {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(
      v => { resolve(v); active--; next(); },
      e => { reject(e);  active--; next(); },
    );
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
};

// 共用 triggerDownload
const triggerDownload = (url, filename) => {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
};

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });

const processImageCanvas = async (type, file, options = {}) => {
  const img = await loadImage(file);
  let canvas, ctx;

  if (type === 'thumbnail') {
    const MAX = 200;
    const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
    const w = Math.max(1, Math.round(img.width  * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

  } else if (type === 'resize') {
    const { size, fitBg = '#ffffff' } = options;
    canvas = Object.assign(document.createElement('canvas'), { width: size.w, height: size.h });
    ctx = canvas.getContext('2d');
    if (size.fit === 'cover') {
      const zoom  = options.zoom ?? 1.0;
      const scale = Math.max(size.w / img.width, size.h / img.height) * zoom;
      const dw = img.width  * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (size.w - dw) / 2, (size.h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = fitBg;
      ctx.fillRect(0, 0, size.w, size.h);
      const ratio = Math.min(size.w / img.width, size.h / img.height);
      const w = Math.round(img.width  * ratio);
      const h = Math.round(img.height * ratio);
      ctx.drawImage(img, Math.round((size.w - w) / 2), Math.round((size.h - h) / 2), w, h);
    }

  } else if (type === 'merge') {
    const { targetW } = options;
    const ratio = targetW / img.width;
    const h = Math.max(1, Math.round(img.height * ratio));
    canvas = Object.assign(document.createElement('canvas'), { width: targetW, height: h });
    canvas.getContext('2d').drawImage(img, 0, 0, targetW, h);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
  );
};

// ── ImageRenameResize Component ───────────────────────────────────────────────
function ImageRenameResize() {
  const [brand,            setBrand]            = useState('');
  const [sku,              setSku]              = useState('');
  const [selectedRes,      setSelectedRes]      = useState('1080');
  const [selectedMode,     setSelectedMode]     = useState('crop');
  const [fitBg,            setFitBg]            = useState('#ffffff');
  const [images,           setImages]           = useState([]);
  const [isDragging,       setIsDragging]       = useState(false);
  const [justCleared,      setJustCleared]      = useState(false);
  const [isUploading,      setIsUploading]      = useState(false);
  const [isDownloading,    setIsDownloading]    = useState(false);
  const [isZipping,        setIsZipping]        = useState(false);
  const [isMerging,        setIsMerging]        = useState(false);
  const [zipProgress,      setZipProgress]      = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [startOffset,      setStartOffset]      = useState(0);
  const [zoom,             setZoom]             = useState(1.0);

  const fileInputRef = useRef(null);
  const idCounterRef = useRef(0);

  const renameOnly = selectedMode === 'rename';
  const isFitMode  = selectedMode === 'fit';

  const currentSize = useMemo(() =>
    SIZES.find(s =>
      selectedRes === '1080'
        ? s.w === 1080 && (isFitMode ? s.fit === 'contain' : s.fit === 'cover')
        : s.w === 1920 && (isFitMode ? s.fit === 'contain' : s.fit === 'cover'),
    ),
  [selectedRes, isFitMode]);

  const remaining = MAX_IMAGES - images.length;
  const atLimit   = images.length >= MAX_IMAGES;
  const isBusy    = isDownloading || isZipping || isMerging || isUploading;

  const getBlobForImage = useCallback(
    img => renameOnly
      ? Promise.resolve(img.file)
      : processImageCanvas('resize', img.file, { size: currentSize, fitBg, zoom }),
    [renameOnly, currentSize, fitBg, zoom],
  );

  const addImages = useCallback(async (files) => {
    const valid = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
    if (!valid.length) return;
    setIsUploading(true);
    const createdUrls = [];
    try {
      const limit   = pLimit(3);
      const newImgs = await Promise.all(
        valid.map(file =>
          limit(async () => {
            const thumbBlob = await processImageCanvas('thumbnail', file);
            const thumbUrl  = URL.createObjectURL(thumbBlob);
            createdUrls.push(thumbUrl);
            return { id: ++idCounterRef.current, file, thumbUrl };
          }),
        ),
      );
      setImages(prev => [...prev, ...newImgs]);
    } catch (e) {
      createdUrls.forEach(url => URL.revokeObjectURL(url));
      console.error('Thumbnail generation failed:', e);
    } finally {
      setIsUploading(false);
    }
  }, [remaining]);

  const handleClearAll = useCallback(() => {
    setImages(prev => { prev.forEach(img => URL.revokeObjectURL(img.thumbUrl)); return []; });
    setJustCleared(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => setJustCleared(false), 1800);
  }, []);

  const handleDownloadAll = async () => {
    if (!images.length || isBusy) return;
    setIsDownloading(true); setDownloadProgress(0);
    try {
      const limit = pLimit(3);
      const blobs = await Promise.all(images.map(img => limit(() => getBlobForImage(img))));
      for (let i = 0; i < blobs.length; i++) {
        const url = URL.createObjectURL(blobs[i]);
        triggerDownload(url, buildImageName(brand, sku, i, startOffset));
        setDownloadProgress(i + 1);
        await new Promise(r => setTimeout(r, 200));
        URL.revokeObjectURL(url);
      }
    } catch (e) { console.error('Download failed:', e); }
    setIsDownloading(false); setDownloadProgress(0);
  };

  const handleDownloadZip = async () => {
    if (!images.length || isBusy) return;
    setIsZipping(true); setZipProgress(0);
    try {
      const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
      const zip   = new JSZip();
      const limit = pLimit(3);
      await Promise.all(
        images.map((img, i) =>
          limit(async () => {
            zip.file(buildImageName(brand, sku, i, startOffset), await getBlobForImage(img));
            setZipProgress(p => p + 1);
          }),
        ),
      );
      const content = await zip.generateAsync({ type: 'blob' });
      const url     = URL.createObjectURL(content);
      triggerDownload(url, buildZipName(brand, sku));
      URL.revokeObjectURL(url);
    } catch (e) { console.error('ZIP failed:', e); }
    setIsZipping(false); setZipProgress(0);
  };

  const handleMergeLong = async () => {
    if (!images.length || isBusy || renameOnly) return;
    setIsMerging(true);
    try {
      const limit       = pLimit(3);
      const scaledBlobs = await Promise.all(
        images.map(img => limit(() => processImageCanvas('merge', img.file, { targetW: currentSize.w }))),
      );
      const bitmaps = await Promise.all(scaledBlobs.map(b => createImageBitmap(b)));
      const totalH  = bitmaps.reduce((s, bm) => s + bm.height, 0);
      const merged  = Object.assign(document.createElement('canvas'), { width: currentSize.w, height: totalH });
      const ctx     = merged.getContext('2d');
      let y = 0;
      for (const bm of bitmaps) { ctx.drawImage(bm, 0, y); y += bm.height; bm.close(); }
      const blob   = await new Promise(res => merged.toBlob(res, 'image/jpeg', 0.92));
      const url    = URL.createObjectURL(blob);
      const prefix = buildPrefix(brand, sku);
      triggerDownload(url, `${prefix ? prefix + '-' : ''}long.jpg`);
      URL.revokeObjectURL(url);
    } catch (e) { console.error('Merge failed:', e); }
    setIsMerging(false);
  };

  return (
    <div>
      {/* Header — sticky top-12 讓它貼在 Tab Bar 下方 */}
      <header className="sticky top-12 z-10 border-b border-gray-800 bg-gray-950/90 backdrop-blur px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Image size={15} /></div>
          <span className="font-bold tracking-tight">IMG Resizer</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">Beta</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-xs px-2.5 py-1 rounded-full font-mono font-semibold ${atLimit ? 'bg-red-500/15 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
            {images.length} / {MAX_IMAGES}
          </div>
          <AnimatePresence mode="wait">
            {justCleared ? (
              <motion.div key="cleared"
                initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/30 px-3 py-1.5 rounded-xl font-semibold">
                <CheckCircle2 size={13} /> 已清除，可重新上傳
              </motion.div>
            ) : (
              <motion.button key="clearBtn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={handleClearAll} disabled={!images.length}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border font-semibold transition-all ${
                  images.length > 0
                    ? 'text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20 active:scale-95 cursor-pointer'
                    : 'text-gray-700 border-gray-800 bg-transparent cursor-not-allowed'
                }`}>
                <RefreshCw size={12} className={images.length > 0 ? 'text-red-400' : 'text-gray-700'} />
                一鍵清除
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">

        {/* STEP 1 */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">1</div>
            <Settings size={13} className="text-blue-400" />
            <span className="text-sm font-semibold text-gray-200">命名 ＆ 尺寸設定</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">品牌</label>
                  <input type="text" placeholder="品牌名稱" value={brand} onChange={e => setBrand(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">SKU</label>
                  <input type="text" placeholder="e.g. E3451" value={sku} onChange={e => setSku(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">Start Number Offset</label>
                <select value={startOffset} onChange={e => setStartOffset(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition cursor-pointer">
                  {OFFSET_OPTIONS.map(o => (
                    <option key={o} value={o} style={{ background: '#111827' }}>
                      {o === 0 ? '從 01 開始（預設）' : `從 ${String(o+1).padStart(2,'0')} 開始  (+${o})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">命名預覽</label>
                <div className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 h-11 flex items-center overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.span key={buildImageName(brand,sku,0,startOffset)}
                      initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }} transition={{ duration:0.15 }}
                      className="text-sm font-mono text-blue-300 truncate">
                      {buildImageName(brand, sku, 0, startOffset)}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">ZIP 檔名</label>
                <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-4 h-11 overflow-hidden">
                  <FileArchive size={13} className="text-purple-400 flex-shrink-0" />
                  <AnimatePresence mode="wait">
                    <motion.span key={buildZipName(brand,sku)}
                      initial={{ opacity:0, y:3 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-3 }} transition={{ duration:0.15 }}
                      className="text-sm font-mono text-purple-300 truncate">
                      {buildZipName(brand, sku)}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">解析度</label>
            <div className="grid grid-cols-2 gap-3">
              {RES_OPTIONS.map(res => {
                const active = selectedRes === res.value;
                return (
                  <button key={res.value} onClick={() => setSelectedRes(res.value)}
                    className={`flex flex-col items-center justify-center py-3.5 rounded-xl border-2 transition-all ${
                      active ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                    }`}>
                    <span className="text-xl font-bold font-mono leading-tight">{res.label}</span>
                    <span className="text-xs font-mono opacity-50 mt-0.5">{res.sub}</span>
                    {active && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">模式</label>
            <div className="grid grid-cols-3 gap-3">
              {MODE_OPTIONS.map(({ value, label, sub, Icon, active: activeClass, dot }) => {
                const isActive = selectedMode === value;
                return (
                  <button key={value} onClick={() => setSelectedMode(value)}
                    className={`flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border-2 transition-all ${
                      isActive ? activeClass : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                    }`}>
                    <Icon size={16} />
                    <span className="text-sm font-bold">{label}</span>
                    <span className="text-xs opacity-50">{sub}</span>
                    {isActive && <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fit bg */}
          <AnimatePresence>
            {isFitMode && (
              <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }} className="overflow-hidden">
                <div className="border border-purple-500/30 bg-purple-500/5 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
                  <div>
                    <p className="text-xs text-purple-300 font-semibold mb-0.5">Fit 補背景色</p>
                    <p className="text-xs text-gray-500">圖片等比縮放置中，四邊補色</p>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-gray-500">補色：</span>
                    {BG_PRESETS.map(c => (
                      <button key={c} onClick={() => setFitBg(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${fitBg===c ? 'border-purple-400 scale-110' : 'border-gray-600'}`}
                        style={{ background: c }} />
                    ))}
                    <input type="color" value={fitBg} onChange={e => setFitBg(e.target.value)}
                      className="w-7 h-7 rounded-full border-2 border-gray-700 bg-transparent cursor-pointer overflow-hidden" title="自訂顏色" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Zoom slider */}
          <AnimatePresence>
            {!isFitMode && !renameOnly && (
              <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }} className="overflow-hidden">
                <div className="border border-blue-500/30 bg-blue-500/5 rounded-xl px-4 py-3 flex items-center gap-4">
                  <div>
                    <p className="text-xs text-blue-300 font-semibold mb-0.5">Zoom {zoom.toFixed(1)}×</p>
                    <p className="text-xs text-gray-500">放大後裁切填滿</p>
                  </div>
                  <input type="range" min="1.0" max="2.0" step="0.1" value={zoom}
                    onChange={e => setZoom(parseFloat(e.target.value))}
                    className="flex-1 accent-blue-500" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* STEP 2 Upload */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">2</div>
            <span className="text-sm font-semibold text-gray-200">上傳圖片</span>
            <span className="text-xs text-gray-600 ml-1">最多 {MAX_IMAGES} 張</span>
            {isUploading && (
              <span className="flex items-center gap-1 text-xs text-blue-400 ml-2">
                <Loader2 size={11} className="animate-spin" /> 處理縮圖中…
              </span>
            )}
          </div>
          <AnimatePresence mode="wait">
            {atLimit ? (
              <motion.div key="limit" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
                className="border-2 border-dashed border-red-700 bg-red-500/5 rounded-2xl py-8 flex flex-col items-center gap-2">
                <AlertCircle size={22} className="text-red-400" />
                <p className="text-sm font-semibold text-red-400">已達上限 {MAX_IMAGES} 張</p>
                <p className="text-xs text-gray-600 mb-1">請先清除圖片再上傳</p>
                <button onClick={handleClearAll}
                  className="flex items-center gap-1.5 text-xs text-red-400 border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-xl font-semibold transition active:scale-95">
                  <RefreshCw size={12} /> 一鍵清除，重新開始
                </button>
              </motion.div>
            ) : (
              <motion.div key="upload" animate={{ scale: isDragging ? 1.01 : 1 }}
                onDragOver={e  => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={()  => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); if (!atLimit && !isBusy) addImages(e.dataTransfer.files); }}
                onClick={() => { if (!isBusy) fileInputRef.current?.click(); }}
                className={`border-2 border-dashed rounded-2xl py-10 text-center transition-colors ${
                  isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                } ${isDragging ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 bg-gray-900 hover:bg-gray-900/60'}`}>
                <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden"
                  onChange={e => { addImages(e.target.files); e.target.value = ''; }} />
                <div className="flex flex-col items-center gap-3 pointer-events-none">
                  <motion.div animate={{ y: isDragging ? -5 : 0 }}
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isDragging ? 'bg-blue-500/20' : 'bg-gray-800'}`}>
                    {isUploading
                      ? <Loader2 size={22} className="text-blue-400 animate-spin" />
                      : <Upload  size={22} className={isDragging ? 'text-blue-400' : 'text-gray-500'} />
                    }
                  </motion.div>
                  <div>
                    <p className={`text-sm font-semibold ${isDragging ? 'text-blue-300' : 'text-gray-300'}`}>
                      {isUploading ? '正在產生縮圖…' : isDragging ? '放開以上傳圖片 ✦' : '拖到這邊上傳'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">或點擊選擇檔案 · JPG / PNG · 可多選 · 尚可上傳 {remaining} 張</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* STEP 3 Preview */}
        <AnimatePresence>
          {images.length > 0 && (
            <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">3</div>
                <span className="text-sm font-semibold text-gray-200">全部預覽</span>
                {renameOnly && <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Rename Only</span>}
                {!renameOnly && isFitMode && <span className="text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">Fit 模式</span>}
                <button onClick={handleClearAll} className="ml-auto flex items-center gap-1 text-xs text-gray-600 hover:text-red-400 transition">
                  <Trash2 size={12} /> 全部清除
                </button>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <motion.div layout className="grid grid-cols-5 gap-2">
                  <AnimatePresence>
                    {images.map((img, index) => (
                      <motion.div key={img.id} layout
                        initial={{ opacity:0, scale:0.85 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.85 }} transition={{ duration:0.18 }}
                        className="relative group rounded-xl overflow-hidden bg-gray-800 ring-1 ring-gray-700/60">
                        <div className="w-full relative overflow-hidden"
                          style={{
                            aspectRatio: renameOnly ? '1 / 1' : currentSize?.ratio,
                            background:  !renameOnly && isFitMode ? fitBg : '#111',
                          }}>
                          <img src={img.thumbUrl} alt=""
                            className="w-full h-full transition-transform duration-150"
                            style={{
                              objectFit: !renameOnly && isFitMode ? 'contain' : 'cover',
                              transform: !renameOnly && !isFitMode ? `scale(${zoom})` : 'none',
                            }}
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setImages(p => {
                                  const found = p.find(x => x.id === img.id);
                                  if (found) URL.revokeObjectURL(found.thumbUrl);
                                  return p.filter(x => x.id !== img.id);
                                });
                              }}
                              className="w-7 h-7 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center">
                              <X size={12} />
                            </button>
                          </div>
                          <div className="absolute top-1 left-1 bg-black/70 text-white rounded px-1 leading-none font-mono font-bold"
                            style={{ fontSize:'10px', paddingTop:'2px', paddingBottom:'2px' }}>
                            {String(index + 1 + startOffset).padStart(2,'0')}
                          </div>
                        </div>
                        <div className="bg-gray-900/90 px-1.5 py-1">
                          <p className="font-mono text-blue-300 truncate" style={{ fontSize:'9px' }}>
                            {buildImageName(brand, sku, index, startOffset)}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* STEP 4 Download */}
        <AnimatePresence>
          {images.length > 0 && (
            <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">4</div>
                <span className="text-sm font-semibold text-gray-200">下載</span>
                <span className="text-xs text-gray-500">
                  {images.length} 張 · {renameOnly ? 'Rename Only' : `${currentSize?.label} · ${isFitMode ? 'Fit' : 'Crop'}`}
                  {startOffset > 0 && ` · 從 ${String(1+startOffset).padStart(2,'0')} 開始`}
                </span>
                <span className="ml-auto text-xs font-mono text-purple-400">{buildZipName(brand, sku)}</span>
              </div>

              <AnimatePresence>
                {isDownloading && (
                  <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
                    <span className="text-xs text-blue-400 font-mono">逐張下載 {downloadProgress} / {images.length}</span>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
                      <motion.div className="h-full bg-blue-500 rounded-full" initial={{ width:0 }}
                        animate={{ width:`${(downloadProgress/images.length)*100}%`}} transition={{ duration:0.3 }} />
                    </div>
                  </motion.div>
                )}
                {isZipping && (
                  <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
                    <span className="text-xs text-purple-400 font-mono">壓縮中 {zipProgress} / {images.length}</span>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
                      <motion.div className="h-full bg-purple-500 rounded-full" initial={{ width:0 }}
                        animate={{ width:`${(zipProgress/images.length)*100}%`}} transition={{ duration:0.3 }} />
                    </div>
                  </motion.div>
                )}
                {isMerging && (
                  <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
                    <span className="text-xs text-green-400 font-mono">合併長圖中…</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <button onClick={handleClearAll} disabled={isBusy}
                className="w-full flex items-center justify-center gap-2 border border-gray-700 bg-gray-800 hover:bg-gray-700 active:scale-95 transition-all px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">
                <RefreshCw size={14} /> 清除重來
              </button>

              <div className="grid grid-cols-3 gap-3">
                <button onClick={handleMergeLong} disabled={isBusy || renameOnly}
                  title={renameOnly ? 'Rename Only 模式下無法合併長圖' : `合併 ${images.length} 張 → 垂直長圖`}
                  className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold transition-all ${
                    isBusy || renameOnly ? 'opacity-40 cursor-not-allowed bg-green-800' : 'bg-green-700 hover:bg-green-600 active:scale-95 cursor-pointer'
                  }`}>
                  <Layers size={18} />
                  <span className="leading-none">{isMerging ? '合併中…' : 'Merge Long'}</span>
                </button>
                <button onClick={handleDownloadZip} disabled={isBusy}
                  className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold transition-all disabled:cursor-not-allowed ${
                    isZipping ? 'bg-purple-700 opacity-70' : 'bg-purple-600 hover:bg-purple-500 active:scale-95'
                  }`}>
                  <FileArchive size={18} />
                  <span className="leading-none">{isZipping ? `壓縮中… ${zipProgress}/${images.length}` : '下載 ZIP'}</span>
                </button>
                <button onClick={handleDownloadAll} disabled={isBusy}
                  className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold transition-all disabled:cursor-not-allowed ${
                    isDownloading ? 'bg-blue-700 opacity-70' : 'bg-blue-600 hover:bg-blue-500 active:scale-95'
                  }`}>
                  <FileArchive size={18} />
                  <span className="leading-none">{isDownloading ? `下載中… ${downloadProgress}/${images.length}` : '逐張下載'}</span>
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLE MAPPER — 工具函式 & Sub-components
// ══════════════════════════════════════════════════════════════════════════════
const downloadCSV = (data, filename) => {
  if (!data.length) return;
  const cols = Object.keys(data[0]);
  const esc = v => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map(esc).join(','), ...data.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 300);
};

const downloadXLSXFile = async (data, filename) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 300);
};

const parseCSV = (text) => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const parseRow = (line) => {
    const res = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    res.push(cur.trim()); return res;
  };
  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseRow(line); const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  }).filter(row => Object.values(row).some(v => v !== ''));
};

const parseFile = async (file) => {
  if (file.name.toLowerCase().endsWith('.csv')) return parseCSV(await file.text());
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
};

const nk = v => (v === null || v === undefined) ? '' : String(v).trim().toLowerCase();

const autoDetectMaps = (t1cols, t2cols, k1, k2) => {
  const t2Set = new Set(t2cols);
  const excl  = new Set([k1, k2]);
  return t1cols.filter(c => t2Set.has(c) && !excl.has(c)).map(c => ({ from: c, to: c }));
};

const SEL   = "w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition cursor-pointer";
const INPUT = "w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition";

const StepBar = ({ step }) => (
  <div className="flex items-center gap-2">
    {['上傳 & 設定比對', '欄位對應', '結果 & 下載'].map((s, i) => {
      const n = i + 1, done = step > n, active = step === n;
      return (
        <React.Fragment key={s}>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all
              ${done ? 'bg-green-600' : active ? 'bg-blue-600' : 'bg-gray-800 text-gray-600 border border-gray-700'}`}>
              {done ? <CheckCircle2 size={11} /> : n}
            </div>
            <span className={`text-xs font-semibold whitespace-nowrap ${active ? 'text-white' : done ? 'text-green-400' : 'text-gray-600'}`}>{s}</span>
          </div>
          {i < 2 && <div className="flex-1 h-px bg-gray-800 min-w-1" />}
        </React.Fragment>
      );
    })}
  </div>
);

const FileRow = ({ num, label, info, busy, accent, onClear, onFile }) => {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const iB = accent === 'blue';
  return (
    <div className={`rounded-xl border-2 transition-all p-4
      ${info ? (iB ? 'border-blue-500/40 bg-blue-500/5' : 'border-purple-500/40 bg-purple-500/5')
              : drag ? 'border-blue-500 bg-blue-500/5' : 'border-dashed border-gray-700 bg-gray-900/60'}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <div className="flex items-center gap-3">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
          ${info ? (iB ? 'bg-blue-600' : 'bg-purple-600') : 'bg-gray-700 text-gray-500'}`}>{num}</div>
        <span className="text-sm font-semibold text-gray-300 flex-shrink-0">{label}</span>
        {info ? (
          <div className={`flex items-center gap-2 flex-1 min-w-0 ${iB ? 'text-blue-300' : 'text-purple-300'}`}>
            <FileSpreadsheet size={12} className="flex-shrink-0" />
            <span className="text-xs font-mono truncate">{info.name}</span>
            <span className="text-xs opacity-60 flex-shrink-0">{info.cols.length}欄·{info.data.length}筆</span>
          </div>
        ) : (
          <div onClick={() => ref.current?.click()} className="flex items-center gap-2 flex-1 cursor-pointer group">
            <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files[0]; if (f) { onFile(f); e.target.value = ''; } }} />
            {busy
              ? <Loader2 size={13} className="text-blue-400 animate-spin" />
              : <span className="text-xs text-gray-600 group-hover:text-blue-400 transition">點擊或拖入 .xlsx / .csv</span>}
          </div>
        )}
        {info && <button onClick={onClear} className="text-gray-700 hover:text-red-400 transition flex-shrink-0"><RefreshCw size={13} /></button>}
      </div>
    </div>
  );
};

const Toggle = ({ on, onChange }) => (
  <button onClick={() => onChange(!on)}
    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-700'}`}>
    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);

// ── TableMapperApp Component ──────────────────────────────────────────────────
function TableMapperApp() {
  const [step,        setStep]        = useState(1);
  const [t1,          setT1]          = useState(null);
  const [t2,          setT2]          = useState(null);
  const [busy1,       setBusy1]       = useState(false);
  const [busy2,       setBusy2]       = useState(false);
  const [key1,        setKey1]        = useState('');
  const [key2,        setKey2]        = useState('');
  const [maps,        setMaps]        = useState([]);
  const [customTo,    setCustomTo]    = useState({});
  const [autoCount,   setAutoCount]   = useState(0);
  const [inclMissing, setInclMissing] = useState(false);
  const [result,      setResult]      = useState(null);
  const [tab,         setTab]         = useState('filled');
  const [processing,  setProcessing]  = useState(false);
  const [dlState,     setDlState]     = useState('idle');
  const [error,       setError]       = useState('');

  // ✅ Bug fix: 用 stable ID 取代 index 作為 key，解決新增欄目 opacity:0 靜默失敗問題
  const mapIdRef = useRef(0);

  const handleFile = useCallback(async (file, num) => {
    setError('');
    if (num === 1) setBusy1(true); else setBusy2(true);
    try {
      const data = await parseFile(file);
      const cols = data.length > 0 ? Object.keys(data[0]) : [];
      const info = { name: file.name, data, cols };
      if (num === 1) { setT1(info); setKey1(cols[0] ?? ''); }
      else           { setT2(info); setKey2(cols[0] ?? ''); }
    } catch (e) {
      setError('讀取失敗，請確認格式正確。');
    } finally {
      if (num === 1) setBusy1(false); else setBusy2(false);
    }
  }, []);

  const goToStep2 = () => {
    if (!t1 || !t2 || !key1 || !key2) return;
    const detected  = autoDetectMaps(t1.cols, t2.cols, key1, key2);
    const t2Set     = new Set(t2.cols);
    const excl      = new Set([key1, key2]);
    const extraCols = t1.cols.filter(c => !t2Set.has(c) && !excl.has(c));
    const extra     = extraCols.slice(0, 5).map(c => ({ from: c, to: '__new__', _customTo: c }));
    const raw       = (detected.length > 0 || extra.length > 0)
      ? [...detected, ...extra]
      : [{ from: '', to: '' }];
    // 賦予每個欄目 stable ID
    const initMaps = raw.map(m => ({ ...m, _id: ++mapIdRef.current }));
    setMaps(initMaps);
    const initCustomTo = {};
    extra.forEach((m, i) => { initCustomTo[detected.length + i] = m._customTo; });
    setCustomTo(initCustomTo);
    setAutoCount(detected.length);
    setStep(2);
  };

  // ✅ Bug fix: 新增時帶入 _id
  const addMap = () => setMaps(p => [...p, { _id: ++mapIdRef.current, from: '', to: '' }]);

  const delMap = i => {
    setMaps(p => p.filter((_, j) => j !== i));
    setCustomTo(p => {
      const next = {};
      Object.entries(p).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
  };

  const updMap = (i, k, v) => setMaps(p => p.map((m, j) => j === i ? { ...m, [k]: v } : m));

  const getToCol = (m, i) => {
    if (m.to === '__new__') return (customTo[i] ?? '').trim() || m.from;
    if (!m.to) return m.from;
    return m.to;
  };

  const run = async () => {
    if (!t1 || !t2 || !key1 || !key2) return;
    setProcessing(true); setError('');
    try {
      const lk = {};
      for (const r of t1.data) {
        const k = nk(r[key1]);
        if (k !== '') lk[k] = r;
      }
      const validMaps = maps.reduce((acc, m, i) => {
        const from = (m.from ?? '').trim();
        if (!from) return acc;
        const to = getToCol(m, i) || from;
        acc.push({ from, to });
        return acc;
      }, []);
      const t2KeySet = new Set(t2.data.map(r => nk(r[key2])));
      const missing  = t1.data.filter(r => { const k = nk(r[key1]); return k !== '' && !t2KeySet.has(k); });
      let matched = 0;
      const updated = t2.data.map(row => {
        const k = nk(row[key2]);
        const src = lk[k];
        if (!src) return { ...row };
        matched++;
        const nr = { ...row };
        for (const m of validMaps) { if (m.from in src) nr[m.to] = src[m.from]; }
        return nr;
      });
      const addedCols   = [...new Set(validMaps.map(m => m.to).filter(c => c && !t2.cols.includes(c)))];
      const newCols     = [...t2.cols, ...addedCols];
      const finalOutput = inclMissing ? [...updated, ...missing] : updated;
      setResult({ missing, updated, finalOutput, matched, newCols, addedCols, validMapsCount: validMaps.length });
      setStep(3); setTab(matched > 0 ? 'filled' : 'missing'); setDlState('idle');
    } catch (e) {
      setError('比對時發生錯誤：' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadXLSX = async () => {
    if (!result || dlState === 'downloading') return;
    setDlState('downloading'); setError('');
    try {
      const base = t2?.name.replace(/\.[^.]+$/, '') ?? 'result';
      await downloadXLSXFile(result.finalOutput, `updated_${base}.xlsx`);
      setDlState('done'); setTimeout(() => setDlState('idle'), 2500);
    } catch (e) {
      setError('Excel 下載失敗，請改用 CSV。');
      setDlState('error'); setTimeout(() => setDlState('idle'), 2500);
    }
  };

  const handleDownloadCSV = () => {
    if (!result) return;
    const base = t2?.name.replace(/\.[^.]+$/, '') ?? 'result';
    try { downloadCSV(result.finalOutput, `updated_${base}.csv`); }
    catch (e) { setError('下載失敗。'); }
  };

  const missingCols = result?.missing.length > 0 ? Object.keys(result.missing[0]) : (t1?.cols ?? []);
  const filledCols  = result?.newCols ?? [];

  return (
    <div>
      {/* Header — sticky top-12 */}
      <header className="sticky top-12 z-10 border-b border-gray-800 bg-gray-950/90 backdrop-blur px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Table2 size={15} /></div>
        <span className="font-bold tracking-tight">Table Mapper</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        <StepBar step={step} />

        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-xs text-red-400">
              <AlertCircle size={13} className="flex-shrink-0" />{error}
              <button onClick={() => setError('')} className="ml-auto"><X size={12} /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">① 上傳兩份表格</p>
                <FileRow num={1} label="表一（來源）" accent="blue"   info={t1} busy={busy1}
                  onClear={() => { setT1(null); setKey1(''); }} onFile={f => handleFile(f, 1)} />
                <FileRow num={2} label="表二（目標）" accent="purple" info={t2} busy={busy2}
                  onClear={() => { setT2(null); setKey2(''); }} onFile={f => handleFile(f, 2)} />
              </div>
              <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3 transition-opacity ${t1 && t2 ? 'opacity-100' : 'opacity-40'}`}>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">② 選擇比對欄位</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">表一比對欄位</label>
                    <select value={key1} onChange={e => setKey1(e.target.value)} className={SEL} disabled={!t1}>
                      {!t1 && <option>— 請先上傳 —</option>}
                      {(t1?.cols ?? []).map(c => <option key={c}>{c}</option>)}
                    </select>
                    {t1 && <p className="text-xs text-gray-600 mt-1">共 {t1.data.length} 筆</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">表二比對欄位</label>
                    <select value={key2} onChange={e => setKey2(e.target.value)} className={SEL} disabled={!t2}>
                      {!t2 && <option>— 請先上傳 —</option>}
                      {(t2?.cols ?? []).map(c => <option key={c}>{c}</option>)}
                    </select>
                    {t2 && <p className="text-xs text-gray-600 mt-1">共 {t2.data.length} 筆</p>}
                  </div>
                </div>
                {t1 && t2 && key1 && key2 && (
                  <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
                    <span className="text-xs font-mono text-blue-300 bg-blue-500/15 px-2 py-0.5 rounded-lg">{key1}</span>
                    <ArrowRight size={11} className="text-gray-600" />
                    <span className="text-xs text-gray-500">比對</span>
                    <ArrowRight size={11} className="text-gray-600" />
                    <span className="text-xs font-mono text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-lg">{key2}</span>
                    <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
                      <Wand2 size={11} /> 下一步自動偵測欄位對應
                    </span>
                  </div>
                )}
              </div>
              <button onClick={goToStep2} disabled={!t1 || !t2 || !key1 || !key2 || busy1 || busy2}
                className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold transition-all
                  ${t1 && t2 && key1 && key2 && !busy1 && !busy2
                    ? 'bg-blue-600 hover:bg-blue-500 active:scale-95'
                    : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
                下一步：欄位對應設定 <ChevronRight size={15} />
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-4">
              {autoCount > 0 ? (
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
                  <Wand2 size={13} className="text-green-400 flex-shrink-0" />
                  <p className="text-xs text-green-400">自動偵測到 <strong>{autoCount}</strong> 個同名欄位，已預填對應。請確認無誤後執行比對</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
                  <AlertCircle size={13} className="text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-400">未找到同名欄位，請手動設定對應關係</p>
                </div>
              )}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-200">欄位對應</p>
                    <p className="text-xs text-gray-500 mt-0.5">表一欄位 → 填入表二欄位</p>
                  </div>
                  <button onClick={addMap}
                    className="flex items-center gap-1.5 text-xs text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-xl transition">
                    <Plus size={12} /> 新增
                  </button>
                </div>
                {maps.length === 0 && (
                  <div className="text-center py-5 text-xs text-gray-600 border border-dashed border-gray-800 rounded-xl">
                    點擊「新增」手動設定欄位對應
                  </div>
                )}
                <div className="space-y-2">
                  {maps.map((m, i) => (
                    // ✅ Bug fix: key={m._id} 確保新增行正確 animate
                    <motion.div key={m._id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2">
                      <div className="flex-1">
                        {i === 0 && <label className="block text-xs text-gray-600 mb-1.5">來源（表一）</label>}
                        <select value={m.from} onChange={e => updMap(i, 'from', e.target.value)} className={SEL}>
                          <option value="">選擇欄位…</option>
                          {(t1?.cols ?? []).map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className={`flex-shrink-0 ${i === 0 ? 'mt-7' : 'mt-2.5'}`}>
                        <ArrowRight size={14} className="text-gray-600" />
                      </div>
                      <div className="flex-1">
                        {i === 0 && <label className="block text-xs text-gray-600 mb-1.5">目標（表二）</label>}
                        <select value={m.to} onChange={e => updMap(i, 'to', e.target.value)} className={SEL}>
                          <option value="">同名欄位（自動）</option>
                          {(t2?.cols ?? []).map(c => <option key={c}>{c}</option>)}
                          <option value="__new__">＋ 建立新欄位…</option>
                        </select>
                        {m.to === '__new__' && (
                          <input type="text" placeholder="新欄位名稱"
                            value={customTo[i] ?? ''}
                            onChange={e => setCustomTo(p => ({ ...p, [i]: e.target.value }))}
                            className={`${INPUT} mt-1.5`} />
                        )}
                      </div>
                      <button onClick={() => delMap(i)} className={`flex-shrink-0 text-gray-700 hover:text-red-400 transition ${i === 0 ? 'mt-7' : 'mt-2.5'}`}>
                        <Trash2 size={14} />
                      </button>
                    </motion.div>
                  ))}
                </div>
                {maps.length > 0 && (
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-3">
                    <p className="text-xs text-blue-300">
                      共 <strong>{maps.filter(m => m.from).length}</strong> 個有效對應，比對成功的列將把上述欄位值從表一複製到表二
                    </p>
                  </div>
                )}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-gray-300 font-medium">附加表一有、表二缺的行</p>
                  <p className="text-xs text-gray-600 mt-0.5">開啟後，缺漏行會附加在下載檔案末尾</p>
                </div>
                <Toggle on={inclMissing} onChange={setInclMissing} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setStep(1)}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-gray-400 border border-gray-700 hover:bg-gray-800 transition">
                  上一步
                </button>
                <button onClick={run} disabled={processing}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all
                    ${!processing ? 'bg-blue-600 hover:bg-blue-500 active:scale-95' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
                  {processing ? <><Loader2 size={14} className="animate-spin" /> 比對中…</> : <>執行比對 <ChevronRight size={15} /></>}
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && result && (
            <motion.div key="s3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-4">
              {result.validMapsCount === 0 && (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
                  <AlertCircle size={13} className="text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-400">未設定任何欄位對應，輸出與原表二相同。請返回設定</p>
                </div>
              )}
              {result.matched === 0 && result.validMapsCount > 0 && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-red-400 font-semibold">比對欄位值完全沒有匹配</p>
                    <p className="text-xs text-red-300/70 mt-0.5">請確認兩份表格的 Key 欄格式一致（數字/文字/前導零）</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '表二總筆數',   val: result.updated.length, color: 'text-white',     bg: 'bg-gray-800 border-gray-700' },
                  { label: '成功比對填入', val: result.matched,        color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
                  { label: '表一有表二缺', val: result.missing.length, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
                ].map(({ label, val, color, bg }) => (
                  <div key={label} className={`rounded-2xl border p-4 text-center ${bg}`}>
                    <p className={`text-2xl font-bold font-mono ${color}`}>{val}</p>
                    <p className="text-xs text-gray-500 mt-1 leading-tight">{label}</p>
                  </div>
                ))}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="flex border-b border-gray-800">
                  {[
                    { k: 'filled',  label: `填入結果 (${result.updated.length})`,  active: 'border-blue-500 text-blue-400 bg-blue-500/5' },
                    { k: 'missing', label: `缺漏行 (${result.missing.length})`,     active: 'border-amber-500 text-amber-400 bg-amber-500/5' },
                  ].map(({ k, label, active }) => (
                    <button key={k} onClick={() => setTab(k)}
                      className={`flex-1 py-3 text-xs font-semibold border-b-2 transition
                        ${tab === k ? active : 'border-transparent text-gray-600 hover:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p-4 overflow-x-auto" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                  {tab === 'filled' && (
                    <div className="space-y-2">
                      {result.addedCols.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <CheckCircle2 size={12} className="text-green-400" />
                          <span className="text-xs text-green-400">新增欄位：</span>
                          {result.addedCols.map(c => (
                            <span key={c} className="text-xs font-mono text-green-300 bg-green-500/10 px-2 py-0.5 rounded-lg">{c}</span>
                          ))}
                        </div>
                      )}
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-600 border-b border-gray-800">
                            {filledCols.slice(0, 8).map(c => (
                              <th key={c} className={`text-left pb-2 pr-4 font-semibold whitespace-nowrap ${result.addedCols.includes(c) ? 'text-green-500' : ''}`}>
                                {c}{result.addedCols.includes(c) ? ' ✦' : ''}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.updated.slice(0, 50).map((row, i) => (
                            <tr key={i} className="border-b border-gray-800/40">
                              {filledCols.slice(0, 8).map((c, j) => (
                                <td key={j} className={`py-1.5 pr-4 font-mono whitespace-nowrap ${result.addedCols.includes(c) ? 'text-green-300/80' : 'text-gray-400'}`}>
                                  {String(row[c] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {result.updated.length > 50 && <p className="text-xs text-gray-600 text-center pt-2">僅顯示前 50 筆</p>}
                    </div>
                  )}
                  {tab === 'missing' && (
                    result.missing.length === 0 ? (
                      <div className="text-center py-8 text-xs text-green-400">
                        <CheckCircle2 size={20} className="mx-auto mb-2" />表二已涵蓋表一所有資料
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-600 border-b border-gray-800">
                            {missingCols.slice(0, 8).map(c => <th key={c} className="text-left pb-2 pr-4 font-semibold whitespace-nowrap">{c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {result.missing.map((row, i) => (
                            <tr key={i} className="border-b border-gray-800/40">
                              {missingCols.slice(0, 8).map((c, j) => (
                                <td key={j} className="py-1.5 pr-4 font-mono text-amber-200/70 whitespace-nowrap">{String(row[c] ?? '')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  )}
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest">下載結果</p>
                  <p className="text-xs text-gray-500">
                    {result.finalOutput.length} 筆
                    {inclMissing && result.missing.length > 0 && <span className="text-blue-400 ml-1">（含 {result.missing.length} 缺漏行）</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={handleDownloadXLSX} disabled={dlState === 'downloading'}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all
                      ${dlState === 'done'        ? 'bg-green-600' :
                        dlState === 'error'       ? 'bg-red-600/40 text-red-300 border border-red-500/30' :
                        dlState === 'downloading' ? 'bg-gray-800 text-gray-500 cursor-not-allowed' :
                                                    'bg-blue-600 hover:bg-blue-500 active:scale-95'}`}>
                    {dlState === 'downloading' ? <><Loader2 size={14} className="animate-spin" />處理中…</> :
                     dlState === 'done'        ? <><CheckCircle2 size={14} />完成</> :
                     dlState === 'error'       ? <><X size={14} />失敗，改用 CSV</> :
                                                 <><Download size={14} />下載 .xlsx</>}
                  </button>
                  <button onClick={handleDownloadCSV}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white active:scale-95 transition-all">
                    <Download size={14} />下載 .csv
                  </button>
                </div>
                <p className="text-xs text-gray-600 text-center">.xlsx 失敗時請用 .csv（Excel 可直接開啟）</p>
              </div>
              <button onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-gray-400 border border-gray-700 hover:bg-gray-800 transition">
                返回修改設定
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab] = useState(APPS[0].id);

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">

      {/* Tab Bar — h-12 (48px), sticky z-20，App headers 用 sticky top-12 配合 */}
      <nav className="sticky top-0 z-20 h-12 bg-gray-950/95 backdrop-blur border-b border-gray-800 flex items-center px-4 gap-1">
        {APPS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 h-8 rounded-lg text-sm font-semibold transition-all ${
              activeTab === id
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </nav>

      {/* 兩個 APP 同時 mount，切換 tab 時狀態不會丟失 */}
      <div className={activeTab === 'image'  ? '' : 'hidden'}><ImageRenameResize /></div>
      <div className={activeTab === 'mapper' ? '' : 'hidden'}><TableMapperApp    /></div>

      {/* 全局 Footer */}
      <footer className="text-center py-6 text-xs text-gray-600">
        created by Tabris Yuen @2026
      </footer>

    </div>
  );
}
