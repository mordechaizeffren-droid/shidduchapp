
import React, { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { fetchRoom, saveRoom, subscribeRoom } from "./lib/sync";
import { uploadFile, viewUrl, deleteRef } from "./lib/files";

// =============================================================================
// Shidduch Organizer — Single File App • v2.0 (Lite, updated)
// Implements: expand-tab, folder tabs, share icon rules, selection guards,
// display-only pills, side-by-side resume/photos, "Share all" logic,
// delete confirm popup, kid→profile refactor + migration, iPhone badge,
// placeholders, empty templates, mini-previews, multi-photos w/ peek,
// simple PDF viewer + swipe-down dismiss, add button placement, etc.
// =============================================================================

// ===== Globals =====
const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);

// ===== DB =====
const dbProfile = localforage.createInstance({ name: "shidduch-db", storeName: "profile" });
const dbProspects = localforage.createInstance({ name: "shidduch-db", storeName: "prospects" });
const dbFiles = localforage.createInstance({ name: "shidduch-db", storeName: "files" });

// ===== Helpers & constants =====
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const ensureArray = (v) => (Array.isArray(v) ? v : []);
const STATUS = ["New", "Researching", "Dating", "On Hold", "Pass", "Reconsidering"];
const TRUST = ["Shadchan (met)", "Shadchan (never met)", "Friend", "Acquaintance", "Never met"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fileToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve((r.result || '').toString().split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

const base64ToBlob = (b64, type = 'application/octet-stream') => {
  const s = atob(b64 || '');
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return new Blob([a], { type });
};
// ===== Icons =====
const IconBtn = ({ label, onClick, className = "", children, ariaLabel, disabled }) => (
  <button
    type="button"
    aria-label={ariaLabel || label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className={`w-8 h-8 inline-flex items-center justify-center rounded-full border bg-white shadow-sm disabled:opacity-40 ${className}`}
  >
    {children}
    <span className="sr-only">{label}</span>
  </button>
);
const IconShare = (p) => (
  // square-with-arrow
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M14 3h7v7"/><path d="M21 3l-7 7"/><path d="M10 7H7a4 4 0 0 0-4 4v7a4 4 0 0 0 4 4h7a4 4 0 0 0 4-4v-3"/>
  </svg>
);
const IconDownload = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 5v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>
  </svg>
);
const IconX = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M6 6l12 12"/><path d="M18 6l-12 12"/>
  </svg>
);
const IconGear = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...p}><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>);
const IconPlus = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// Single expand/collapse icon that flips based on `open`
const ExpandIcon = ({ open, ...p }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {open ? (
      // INWARD (collapse)
      <>
        {/* top-left pointing in */}
        <path d="M10 10L3 3" />
        <path d="M9 3H3v6" />
        {/* top-right pointing in */}
        <path d="M14 10l7-7" />
        <path d="M15 3h6v6" />
        {/* bottom-left pointing in */}
        <path d="M10 14L3 21" />
        <path d="M3 15v6h6" />
        {/* bottom-right pointing in */}
        <path d="M14 14l7 7" />
        <path d="M21 15v6h-6" />
      </>
    ) : (
      // OUTWARD (expand)
      <>
        {/* top-left */}
        <path d="M3 9V3h6" />
        <path d="M3 3l7 7" />
        {/* top-right */}
        <path d="M21 9V3h-6" />
        <path d="M21 3l-7 7" />
        {/* bottom-left */}
        <path d="M3 15v6h6" />
        <path d="M3 21l7-7" />
        {/* bottom-right */}
        <path d="M21 15v6h-6" />
        <path d="M21 21l-7-7" />
      </>
    )}
  </svg>
);


// ===== File helpers (Supabase-backed) =====
const attachFile = async (file) => {
  // Upload to Supabase and return a lightweight ref you can store/sync
  const { id, key, url, size, type, name } = await uploadFile(file);

  // NEW: also cache locally so useFilePreview() can render immediately
  try { await dbFiles.setItem(id, file); } catch {}

  return { id, key, url, size, type, name, addedAt: Date.now() };
};

const deleteFileRef = async (ref) => {
  try { if (ref?.key) await deleteRef(ref); } catch {}
  try { if (ref?.id) await dbFiles.removeItem(ref.id); } catch {}
};

// Download/share via URL instead of blob
const downloadRef = async (ref) => {
  const url = await viewUrl(ref); if (!url) return;
  const a = document.createElement("a");
  a.href = url; a.download = ref?.name || "download"; a.click();
};

const shareRef = async (ref) => {
  const url = await viewUrl(ref); if (!url) return;
  const navAny = navigator;
  try {
    if (navAny.share) { await navAny.share({ url, title: ref?.name || 'file' }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  window.open(url, "_blank", "noopener,noreferrer");
};

// Share all (uses URLs)
const shareAll = async ({ resume, photos, text }) => {
  const urls = [];
  const r = await viewUrl(resume); if (r) urls.push(r);
  for (const ph of ensureArray(photos)) {
    const u = await viewUrl(ph);
    if (u) urls.push(u);
  }
  const t = (text || '').trim();
  const navAny = navigator;
  try {
    if (navAny.share) {
      // Some browsers only accept single url/text
      if (urls[0]) { await navAny.share({ url: urls[0] }); return; }
      if (t) { await navAny.share({ text: t }); return; }
    }
  } catch (e) { if (e?.name === 'AbortError') return; }
  // Fallback: open first URL + copy text
  if (urls[0]) window.open(urls[0], "_blank", "noopener,noreferrer");
  if (t) { try { await navigator.clipboard.writeText(t); } catch {} }
};

// ===== Small UI bits =====
const statusTone = (s)=>({
  New:'bg-blue-100 text-blue-800 border-blue-200',
  Researching:'bg-amber-100 text-amber-800 border-amber-200',
  Dating:'bg-emerald-100 text-emerald-800 border-emerald-200',
  'On Hold':'bg-slate-100 text-slate-800 border-slate-200',
  Pass:'bg-rose-100 text-rose-800 border-rose-200',
  Reconsidering:'bg-violet-100 text-violet-800 border-violet-200'
}[s] || 'bg-gray-100 text-gray-800 border-gray-200');

// Display-only pill
const DisplayPill = ({ children, tone = "bg-gray-100 text-gray-700 border-gray-200" }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${tone} inline-flex items-center gap-1`}>{children}</span>
);

// ===== Confirm dialog =====
function useConfirm() {
  const [state, setState] = useState({ open: false, resolve: null });
  const ask = () => new Promise((resolve) => setState({ open: true, resolve }));

  const Confirm = state.open ? (
    <div
      className="fixed inset-0 z-[5000] bg-black/40 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={() => { state.resolve(false); setState({ open: false, resolve: null }); }}
    >
      <div
        className="bg-white rounded-lg shadow p-4 w-[18rem]"
        onClick={(e)=>e.stopPropagation()}
      >
        <div className="text-sm">Are you sure?</div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="px-3 py-1 rounded border"
            onClick={()=>{ state.resolve(false); setState({ open:false, resolve:null }); }}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1 rounded border bg-rose-600 text-white"
            onClick={()=>{ state.resolve(true); setState({ open:false, resolve:null }); }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  useEffect(()=>{
    const onKey=(e)=>{ if(!state.open) return; if(e.key==='Escape'){ state.resolve(false); setState({open:false, resolve:null}); } };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  },[state]);

  return { ask, Confirm };
}

// ----- Upload previews & viewer (local blob with remote fallback) -----
function useFilePreview(fileRef){
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    let obj = '';
    (async () => {
      // Try local cached blob first
      if (fileRef?.id) {
        const blob = await dbFiles.getItem(fileRef.id);
        if (blob) {
          obj = URL.createObjectURL(blob);
          if (alive) setUrl(obj);
          return;
        }
      }
      // Fallback: signed/public Supabase URL so OTHER DEVICES can view
      const remote = await viewUrl(fileRef);
      if (alive) setUrl(remote || '');
    })();
    return () => { 
      alive = false; 
      if (obj) setTimeout(() => URL.revokeObjectURL(obj), 0);
    };
  }, [fileRef?.id, fileRef?.key]); // rerun if ref changes
  return url;
}
// REPLACE MiniPreview with this:
function MiniPreview({ fileRef }) {
  const url = useFilePreview(fileRef);
  const type = (fileRef?.type || "").toLowerCase();
  const name = (fileRef?.name || "").toLowerCase();
  const isImg = type.startsWith("image/");
  const isPdf = type === "application/pdf" || name.endsWith(".pdf");

  if (!fileRef) return null;

  const loading = !url;

  return (
    <div className="w-full h-28 rounded-md bg-white border overflow-hidden relative">
      {/* Shimmer while loading */}
      {loading && (
        <div className="absolute inset-0 animate-pulse bg-gray-100" />
      )}

      {/* Image */}
      {isImg && url && (
        <img
          src={url}
          alt={fileRef.name || "image"}
          className="w-full h-full object-contain"
          draggable={false}
        />
      )}

      {/* Fallback icon when we have neither URL nor a known type */}
      {!isImg && !isPdf && !loading && (
        <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">📄</div>
      )}
    </div>
  );
}

// --- pdf.js (UMD) one-time loader ---
let __pdfjsPromise = null;
function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (__pdfjsPromise) return __pdfjsPromise;

  __pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.async = true;
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) { reject(new Error('pdfjsLib missing')); return; }
      try {
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      } catch {}
      resolve(lib);
    };
    s.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(s);
  });

  return __pdfjsPromise;
}
// Fetch a PDF Blob for a fileRef: prefer local cache, else signed URL, then cache.
async function getPdfBlobFromRef(fileRef) {
  if (!fileRef?.id) return null;

  // 1) local cache
  try {
    const cached = await dbFiles.getItem(fileRef.id);
    if (cached instanceof Blob) return cached;
  } catch {}

  // 2) remote fetch via signed/public URL
  try {
    const url = await viewUrl(fileRef);
    if (!url) return null;
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    // cache for next time
    try { await dbFiles.setItem(fileRef.id, blob); } catch {}
    return blob;
  } catch {
    return null;
  }
}

// Small helper: Blob → ArrayBuffer for pdf.js
async function blobToArrayBuffer(blob) {
  return await blob.arrayBuffer();
}

// Pinch-zoom image that auto-fits to its container on load/resize.
// Two-finger pinch & pan only (so one-finger swipes still work in Viewer).
function ZoomImg({ src, alt = '', className = '' }) {
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={`${className} max-w-full max-h-full object-contain select-none`}
      style={{ userSelect: 'none' }}
    />
  );
}
// ===== PDF: vertical stacked renderer =====
function PdfStack({ fileRef, targetHeight = 1600 }) {
  const wrapRef = React.useRef(null);
  const [numPages, setNumPages] = React.useState(0);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    let doc = null;

    (async () => {
      try {
        setErr('');
        setNumPages(0);
        const blob = await getPdfBlobFromRef(fileRef);
        if (!blob) { setErr('Unable to fetch PDF.'); return; }

        const ab = await blobToArrayBuffer(blob);
        const pdfjs = await loadPdfjs();
        // worker already configured in loadPdfjs()

        doc = await pdfjs.getDocument({ data: ab }).promise;
        if (cancelled) { doc?.destroy?.(); return; }

        const total = doc.numPages || 0;
        setNumPages(total);

        // Render each page to its own canvas
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        for (let i = 1; i <= total; i++) {
          if (cancelled) break;
          const page = await doc.getPage(i);
          const vp1 = page.getViewport({ scale: 1 });
          const scale = Math.max(0.75, Math.min(2.5, (targetHeight / vp1.height))) * dpr;
          const vp = page.getViewport({ scale });

          // Create holder
          const holder = document.createElement('div');
          holder.className = 'mb-4';
          const label = document.createElement('div');
          label.className = 'text-[10px] text-gray-500 mb-1';
          label.textContent = `Page ${i} / ${total}`;
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          const ctx = canvas.getContext('2d', { alpha: false });

          holder.appendChild(label);
          holder.appendChild(canvas);

          if (wrapRef.current) wrapRef.current.appendChild(holder);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;

          // Release page
          try { page.cleanup?.(); } catch {}
        }
      } catch (e) {
        if (!cancelled) setErr('Failed to render PDF. You can try opening in system viewer.');
      } finally {
        try { doc?.destroy?.(); } catch {}
      }
    })();

    return () => { cancelled = true; if (wrapRef.current) wrapRef.current.innerHTML = ''; };
  }, [fileRef?.id]);

  if (err) {
    return (
      <div className="p-4 text-sm text-gray-600">
        {err}{' '}
        <button
          className="underline"
          onClick={async () => {
            const url = await viewUrl(fileRef);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }}
        >
          Open in system viewer
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="w-full h-[90vh] overflow-auto bg-white p-3 rounded">
      {numPages === 0 && <div className="p-6 text-center text-sm text-gray-500">Loading PDF…</div>}
    </div>
  );
}

// ===== Viewer (images + PDF pages, proportional, swipe + pinch-zoom) =====
function Viewer({ fileRef, photos = [], startIndex = 0, onClose, onDeletePhoto }) {
  const isImg = (fileRef?.type || '').startsWith('image/');
  const isPdf = (fileRef?.type || '').toLowerCase() === 'application/pdf' ||
                (fileRef?.name || '').toLowerCase().endsWith('.pdf');

  // image carousel index
  const [idx, setIdx] = React.useState(startIndex);
  React.useEffect(() => setIdx(startIndex), [startIndex, fileRef?.id]);
  
  // Swipe gestures (disabled while zooming/panning)
  const [zoomLocked, setZoomLocked] = React.useState(false);
  const HORIZ = 60, VERT = 80, ANGLE = 15;
  const [drag, setDrag] = React.useState({ active:false, startX:0, startY:0, dx:0, dy:0 });

  const onTouchStart = (e) => {
    if (zoomLocked) return; // Zoomer handles it
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    setDrag({ active:true, startX:t.clientX, startY:t.clientY, dx:0, dy:0 });
  };
  const onTouchMove = (e) => {
    if (zoomLocked || !drag.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    setDrag(d => ({ ...d, dx: t.clientX - d.startX, dy: t.clientY - d.startY }));
  };
  const onTouchEnd = () => {
    if (zoomLocked || !drag.active) return;
    const { dx, dy } = drag;
    const ax = Math.abs(dx), ay = Math.abs(dy);

    // down → close
    if (ay - ax > ANGLE && dy > VERT) {
      setDrag({ active:false, startX:0, startY:0, dx:0, dy:0 });
      onClose?.();
      return;
    }

  // current photo url
  const currentPhotoRef = isImg ? (photos.length ? photos[idx] : fileRef) : null;
  const currentPhotoUrl = useFilePreview(currentPhotoRef || null);

  return (
    <div
      className="fixed inset-0 z-[3000] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Viewer"
    >
      <div
        className="max-w-[1000px] w-full max-h-[95vh] bg-white rounded-lg overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: drag.active && drag.dy > 0 && !zoomLocked ? `translateY(${Math.max(0, drag.dy)}px)` : undefined,
          transition: drag.active ? 'none' : 'transform 160ms ease-out',
        }}
      >
        {isImg ? (
  currentPhotoUrl ? (
    <ZoomImg
  key={currentPhotoUrl}
  src={currentPhotoUrl}
  alt={(currentPhotoRef?.name) || 'image'}
  className="w-full h-[90vh]"
  onLockChange={setZoomLocked}
/>

) : isPdf ? (
  // New: vertical, scrollable PDF stack (wrapped in LongPressShare for Share/Save/Delete)
  <LongPressShare fileRef={fileRef}>
    <PdfStack fileRef={fileRef} />
  </LongPressShare>
) : (
  <div className="p-6 text-center text-sm text-gray-500">No preview available.</div>
)}
        {/* Optional delete (photos only) */}
        {isImg && typeof onDeletePhoto === 'function' && photos.length > 0 && (
          <button
            className="absolute top-3 right-3 bg-white/90 hover:bg-white rounded-full w-9 h-9 flex items-center justify-center border"
            onClick={() => onDeletePhoto(idx, photos[idx])}
            aria-label="Delete photo"
            title="Delete photo"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ===== Small menus / actions re-add =====
function PillMenu({ label, options=[], onPick, strong }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev) => { if (wrapRef.current && !wrapRef.current.contains(ev.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    const MENU_W = 176;
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setAlignRight(r.left + MENU_W > window.innerWidth);
    }
    setOpen(o => !o);
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button type="button"
        aria-expanded={open}
        className={`px-3 py-1 rounded-full text-sm font-medium border ${strong ? '' : 'bg-white'}`}
        onClick={toggle}
      >
        <span className="inline-block w-4 h-3 align-middle mr-1">
          <span className="block w-4 h-0.5 bg-gray-400 rounded mb-0.5"></span>
          <span className="block w-4 h-0.5 bg-gray-400 rounded mb-0.5"></span>
          <span className="block w-4 h-0.5 bg-gray-400 rounded"></span>
        </span>
        {label || 'Select'}
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-44 rounded border bg-white shadow ${alignRight ? 'right-0' : 'left-0'}`}>
          {options.map(opt => (
            <button key={opt} type="button"
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
              onClick={(e)=>{ e.stopPropagation(); onPick?.(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddDropdown({ disabled=false }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e)=>{ if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return ()=>document.removeEventListener('click', onDoc);
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    const MENU_W = 176;
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setAlignRight(r.left + MENU_W > window.innerWidth);
    }
    setOpen(o=>!o);
  };

  const triggerFiles = () => {
    if (disabled) { alert("Add a profile first."); return; }
    window.dispatchEvent(new Event('open-quick-add'));
    setOpen(false);
  };
  const triggerPaste = () => {
    if (disabled) { alert("Add a profile first."); return; }
    window.dispatchEvent(new Event('open-paste-add'));
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button type="button" aria-label="Add" title="Add"
        className={`px-2 py-1 rounded border flex items-center gap-1 ${disabled ? 'opacity-40' : ''}`}
        onClick={toggle}
      >
        <IconPlus />
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-44 rounded border bg-white shadow ${alignRight ? 'right-0' : 'left-0'}`}>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={triggerFiles}>
            <IconDownload /><span>From files</span>
          </button>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={triggerPaste}>
            <span className="text-lg leading-none">📋</span><span>Paste</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsFab({ onExport, onImport, onOpenSync }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e)=>{ if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return ()=>document.removeEventListener('click', onDoc);
  }, [open]);

  return (
    <div ref={wrap} className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-2 w-48 rounded border bg-white shadow">
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => { onExport?.(); setOpen(false); }}>Export</button>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => { onImport?.(); setOpen(false); }}>Import</button>
          <div className="my-1 border-t" />
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => { onOpenSync?.(); setOpen(false); }}>Sync settings…</button>
        </div>
      )}
      <button type="button" aria-label="Settings"
        className="w-11 h-11 rounded-full border border-gray-200 bg-white shadow-sm flex items-center justify-center"
        onClick={() => setOpen(o => !o)}
      >
        <IconGear />
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// SyncPanel (modal)
// ----------------------------------------------------------------------------
function SyncPanel({ open, initial, onSave, onClear, onClose }) {
  const [cfg, setCfg] = useState(initial?.config || "");
  const [room, setRoom] = useState(initial?.room || "");
  useEffect(() => { setCfg(initial?.config || ""); setRoom(initial?.room || ""); }, [initial, open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1800] bg-black/40 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-white w-full md:w-[28rem] rounded-t-2xl md:rounded-2xl p-4 shadow-lg" onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-semibold mb-2">Sync (optional)</div>
        <p className="text-xs text-gray-500 mb-3">Paste the config token and enter a room name to enable sync between devices.</p>
        <div className="space-y-2">
          <div>
            <div className="text-xs mb-1">Config token</div>
            <input className="border rounded w-full px-2 py-1 text-sm select-text" value={cfg} onChange={(e)=>setCfg(e.target.value)} placeholder="..." />
          </div>
          <div>
            <div className="text-xs mb-1">Room</div>
            <input className="border rounded w-full px-2 py-1 text-sm select-text" value={room} onChange={(e)=>setRoom(e.target.value)} placeholder="..." />
          </div>
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <button type="button" className="px-3 py-1 rounded border" onClick={onClose}>Close</button>
          <button type="button" className="px-3 py-1 rounded border" onClick={()=>{ onClear?.(); onClose(); }}>Clear</button>
          <button type="button" className="px-3 py-1 rounded border bg-black text-white" onClick={()=>{ onSave?.({ config: cfg, room }); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
// ===== Prospects (collapsed list + full-page editor) =====
function Prospects({
  prospects,
  setProspects,
  profile,
  saveProfile,
  activeProfileId,
  setActiveProfileId,
  unseenMap,
  markSeen
}) {
  const profiles = ensureArray(profile?.profiles);
  const safe = ensureArray(prospects);

  // --- list search/filters/quick add (unchanged) ---
  const [q, setQ] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [pasteOn, setPasteOn] = React.useState(false);
  const pasteRef = React.useRef(null);
  const quickRef = React.useRef(null);
  const { ask: askConfirm, Confirm } = useConfirm();

  // viewer (kept, used by full editor too if you want)
  const [viewerFile, setViewerFile] = React.useState(null);
  const [viewerPhotos, setViewerPhotos] = React.useState([]);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerProspectId, setViewerProspectId] = React.useState('');

  // NEW: full-screen editor state
  const [fullOpen, setFullOpen] = React.useState(false);
  const [fullId, setFullId] = React.useState('');
  const openFull = (id) => { setFullId(id); setFullOpen(true); };
  const closeFull = () => setFullOpen(false);
  const fullItem = fullOpen ? safe.find(x => x.id === fullId) || null : null;

  // ---- helpers (unchanged) ----
  const quickAddFromPickedFile = async (f) => {
    if (!profiles.length) { alert('Add a profile first'); return; }
    const ref = await attachFile(f); if (!ref) return;
    const base = (f.name||'').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
    const pid = activeProfileId || profiles[0].id;
    const p = { id: uid(), profileId: pid, fullName: base || '', status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photos:[], resume:null, updatedAt: Date.now() };
    if ((f.type||'').startsWith('image/')) p.photos = [ref]; else p.resume = ref;
    setProspects([...safe, p]);
  };

  React.useEffect(()=>{ const h=()=>quickRef.current?.click(); window.addEventListener('open-quick-add', h); return ()=>window.removeEventListener('open-quick-add', h); },[]);

  const tryClipboardApi = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find(t => t.startsWith('image/') || t === 'application/pdf');
          if (type) {
            const blob = await item.getType(type);
            const name = type === 'application/pdf' ? 'pasted.pdf' : `pasted.${(type.split('/')[1]||'png')}`;
            const file = new File([blob], name, { type });
            await quickAddFromPickedFile(file);
            return true;
          }
        }
      }
    } catch {}
    return false;
  };
  const beginPasteFlow = async () => { const ok = await tryClipboardApi(); if (!ok) { setPasteOn(true); setTimeout(()=>pasteRef.current?.focus(), 50); } };
  React.useEffect(()=>{ const h=()=>beginPasteFlow(); window.addEventListener('open-paste-add', h); return ()=>window.removeEventListener('open-paste-add', h); },[profiles,activeProfileId,prospects]);
  const handlePaste = async (e) => {
    const items = e.clipboardData?.items || []; let file=null;
    for (const it of items) { if (it.kind === 'file' && (it.type.startsWith('image/') || it.type === 'application/pdf')) { file = it.getAsFile(); break; } }
    if (file) { await quickAddFromPickedFile(file); } else { alert('Clipboard does not contain a photo or PDF.'); }
    setPasteOn(false); e.preventDefault();
  };

  const addProfile = () => {
    const k = { id: uid(), name:'', photos:[], resume:null, blurb:'', updatedAt: Date.now() };
    saveProfile({ ...(profile||{}), profiles:[...profiles, k], updatedAt: Date.now() });
    setActiveProfileId(k.id);
  };
  const addProspect = () => {
    if(!profiles.length){ alert('Add a profile first'); return; }
    const p={ id:uid(), profileId:activeProfileId||profiles[0].id, fullName:'', status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photos:[], resume:null, updatedAt:Date.now() };
    setProspects([...safe,p]);
  };
  const updateP = (id, patch) => setProspects(safe.map(x => x.id===id ? { ...x, ...patch, updatedAt: Date.now() } : x));
  const removeP = async (id) => {
    const ok = await askConfirm(); if (!ok) return;
    const p = safe.find(x=>x.id===id);
    try {
      if (p?.resume) await deleteFileRef(p.resume);
      for (const ph of ensureArray(p?.photos)) await deleteFileRef(ph);
    } catch {}
    setProspects(safe.filter(x=>x.id!==id));
  };

  const onDropFiles = async (pid, files, into='auto') => {
    if(!files||!files.length) return;
    for(const f of Array.from(files)){
      const ref=await attachFile(f); if(!ref) continue;
      if(into==='resume'){ updateP(pid,{resume:ref}); }
      else if(into==='photos'){ updateP(pid,{photos:[...(safe.find(x=>x.id===pid)?.photos||[]), ref]}); }
      else {
        if((f.type||'').startsWith('image/')) updateP(pid,{photos:[...(safe.find(x=>x.id===pid)?.photos||[]), ref]});
        else updateP(pid,{resume:ref});
      }
    }
  };

  const filtered = safe
    .filter(p=>!activeProfileId || p.profileId===activeProfileId)
    .filter(p=>!statusFilter || p.status===statusFilter)
    .filter(p=>{
      const t=q.trim().toLowerCase(); if(!t) return true;
      return ((p.fullName||'').toLowerCase().includes(t) ||
              (p.city||'').toLowerCase().includes(t) ||
              (p.sourceName||'').toLowerCase().includes(t) ||
              (p.notes||'').toLowerCase().includes(t));
    });

  const hasTwoShareItems = (p) => {
    let count = 0;
    if (p.resume) count++;
    if ((p.photos||[]).length) count++;
    if ((p.notes||'').trim()) count++;
    return count >= 2;
  };

  return (
    <div className="space-y-3">
      {/* profile pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {profiles.map(k=> (
          <button key={k.id}
                  className={`px-3 py-1 rounded-full border ${activeProfileId===k.id?'bg-black text-white':'bg-white'}`}
                  onClick={()=>setActiveProfileId(k.id)}>
            {k.name ? k.name : <span className="text-gray-400">name...</span>}
          </button>
        ))}
        <button className="px-3 py-1 rounded-full border" onClick={addProfile} aria-label="Add profile">+</button>
      </div>

      {/* search + filter + Add (All on the left) */}
<div className="flex items-center gap-2">
  <PillMenu
    label={statusFilter || 'All'}
    options={['All', ...STATUS]}
    onPick={(s)=>setStatusFilter(s==='All' ? '' : s)}
  />

  <input
    className="border rounded px-2 py-1 text-sm flex-1 select-text"
    placeholder="Search name, city, notes..."
    value={q}
    onChange={e=>setQ(e.target.value)}
  />

  {pasteOn && (
    <input
      ref={pasteRef}
      onPaste={handlePaste}
      className="border rounded px-2 py-1 text-sm select-text"
      placeholder="Paste here…"
      aria-label="Paste here"
    />
  )}

  <input
    ref={quickRef}
    type="file"
    accept="*/*"
    multiple
    className="hidden"
    onChange={e=>{
      const fs = e.target.files;
      if (fs?.length) {
        for (const f of Array.from(fs)) quickAddFromPickedFile(f);
      }
      e.target.value = '';
    }}
  />

  <AddDropdown disabled={!profiles.length} />
</div>


      {/* cards (collapsed rows) */}
      <div className="grid grid-cols-1 gap-2 w-full">
        {filtered.map(p => (
          <div
            key={p.id}
            className="relative border rounded bg-white shadow-sm p-2 overflow-visible cursor-pointer"
            onClick={()=>{ markSeen(p.id, p.updatedAt || Date.now()); openFull(p.id); }}
            onDragOver={(e)=>e.preventDefault()}
          >
            {/* header line only; tap anywhere to open */}
            <div className="p-2 flex flex-wrap items-center gap-2">
              {/* name: NOT editable here; opens full editor */}
              <button className="font-medium truncate text-left"
                      onClick={(e)=>{ e.stopPropagation(); markSeen(p.id, p.updatedAt||Date.now()); openFull(p.id); }}>
                {p.fullName ? p.fullName : <span className="text-gray-400">name...</span>}
              </button>

              {/* quick glance pills */}
              {p.status ? (
                <span className={`px-2 py-0.5 rounded-full text-xs border ${statusTone(p.status)}`}>{p.status}</span>
              ) : null}
              {(p.sourceName||'').trim() ? (
                <span className="px-2 py-0.5 rounded-full text-xs border bg-gray-100 border-gray-200">{p.sourceName}</span>
              ) : null}
              {(p.city||'').trim() ? (
                <span className="px-2 py-0.5 rounded-full text-xs border bg-indigo-100 text-indigo-800 border-indigo-200">{p.city}</span>
              ) : null}

              {/* delete X (does NOT open editor) */}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Delete"
                  className="w-7 h-7 rounded-full border border-rose-300 text-rose-700 flex items-center justify-center hover:bg-rose-50"
                  onClick={(e)=>{ e.stopPropagation(); removeP(p.id); }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Add prospect tile — smaller */}
        <button type="button"
                onClick={addProspect}
                className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
          <div className="text-4xl leading-none text-gray-400">+</div>
          <div className="text-xs text-gray-500 mt-1">Add resume</div>
        </button>
      </div>

      {/* Full-screen editor (swipe-down to close) */}
      {fullOpen && fullItem && (
        <FullProspectEditor
          prospect={fullItem}
          allProfiles={profiles}
          onChange={(patch)=> updateP(fullItem.id, patch)}
          onClose={closeFull}
          onDelete={async ()=>{ await removeP(fullItem.id); closeFull(); }}
        />
      )}

      {/* (old) Viewer & Confirm kept for reuse */}
      {viewerFile && (
        <Viewer
          fileRef={viewerFile}
          photos={viewerPhotos}
          startIndex={viewerIndex}
          onClose={()=> { setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); setViewerProspectId(''); }}
          onDeletePhoto={async (i, ref) => {
            const ok = await askConfirm(); if (!ok) return;
            try { if (ref) await deleteFileRef(ref); } catch {}
            const cur = ensureArray((safe.find(x=>x.id===viewerProspectId) || {}).photos);
            const next = cur.filter((_, idx)=> idx !== i);
            updateP(viewerProspectId, { photos: next });
            setViewerPhotos(next);
            if (next.length === 0) { setViewerFile(null); setViewerProspectId(''); }
            else {
              const newIndex = Math.min(i, next.length-1);
              setViewerIndex(newIndex);
              setViewerFile(next[newIndex]);
            }
          }}
        />
      )}
      {Confirm}
    </div>
  );
}
// --- Long-press wrapper that calls shareRef(ref) (falls back to downloadRef) ---
function LongPressShare({ fileRef, onDelete, children, delay = 500 }) {
  const [menu, setMenu] = React.useState({ open: false, x: 0, y: 0, file: null });
  const tRef = React.useRef(null);
  const movedRef = React.useRef(false);

  const clear = () => { if (tRef.current) { clearTimeout(tRef.current); tRef.current = null; } };

  const start = (clientX, clientY) => {
    movedRef.current = false;
    const sx = clientX, sy = clientY;
    clear();
    tRef.current = setTimeout(() => {
      if (!movedRef.current && fileRef) {
        setMenu({ open: true, x: clientX, y: clientY, file: fileRef });
      }
    }, delay);

    const move = (e) => {
      const x = (e.touches?.[0]?.clientX ?? e.clientX);
      const y = (e.touches?.[0]?.clientY ?? e.clientY);
      if (Math.hypot(x - sx, y - sy) > 12) movedRef.current = true;
    };
    const stop = () => {
      clear();
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", stop, true);
      window.removeEventListener("touchmove", move, true);
      window.removeEventListener("touchend", stop, true);
      window.removeEventListener("touchcancel", stop, true);
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", stop, true);
    window.addEventListener("touchmove", move, true);
    window.addEventListener("touchend", stop, true);
    window.addEventListener("touchcancel", stop, true);
  };

  return (
    <>
      <div
        onMouseDown={(e) => start(e.clientX, e.clientY)}
        onTouchStart={(e) => start(e.touches[0].clientX, e.touches[0].clientY)}
      >
        {children}
      </div>

      {menu.open && (
        <div
          className="fixed z-[5000] bg-white border rounded shadow text-sm"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="block w-full px-3 py-2 hover:bg-gray-100"
            onClick={() => { shareRef(menu.file); setMenu({ ...menu, open: false }); }}
          >
            Share
          </button>
          <button
            className="block w-full px-3 py-2 hover:bg-gray-100"
            onClick={() => { downloadRef(menu.file); setMenu({ ...menu, open: false }); }}
          >
            Save
          </button>
          {onDelete && (
            <button
              className="block w-full px-3 py-2 text-rose-600 hover:bg-rose-50"
              onClick={async () => {
                await onDelete(menu.file);
                setMenu({ ...menu, open: false });
              }}
            >
              Delete
            </button>
          )}
          <button
            className="block w-full px-3 py-2 text-gray-500 hover:bg-gray-50"
            onClick={() => setMenu({ ...menu, open: false })}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

/* ===== Full-screen editor component =====
   - Name is editable here
   - Swipe down (or Esc) to close
*/
function FullProspectEditor({ prospect, allProfiles, onChange, onClose, onDelete }) {
  const p = prospect || {};
  const [viewerFile, setViewerFile] = React.useState(null);
  const [viewerPhotos, setViewerPhotos] = React.useState([]);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const { ask: askConfirm, Confirm } = useConfirm();

  // swipe-down to close
  const [drag, setDrag] = React.useState({ active:false, startX:0, startY:0, dx:0, dy:0 });
  const HORIZ = 60, VERT = 80, ANGLE = 15;

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    setDrag({ active:true, startX:t.clientX, startY:t.clientY, dx:0, dy:0 });
  };
  const onTouchMove = (e) => {
    if (!drag.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    setDrag(d => ({ ...d, dx: t.clientX - d.startX, dy: t.clientY - d.startY }));
  };
  const onTouchEnd = () => {
    if (!drag.active) return;
    const { dx, dy } = drag;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ay - ax > ANGLE && dy > VERT) onClose?.();
    setDrag({ active:false, startX:0, startY:0, dx:0, dy:0 });
  };

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addPhotos = async (files) => {
    const refs = [];
    for (const f of Array.from(files||[])) refs.push(await attachFile(f));
    onChange({ photos:[...(p.photos||[]), ...refs] });
  };

  const hasTwo = (() => {
    let c=0; if (p.resume) c++; if ((p.photos||[]).length) c++; if ((p.notes||'').trim()) c++; return c>=2;
  })();

  return (
    <div
      className="fixed inset-0 z-[3500] bg-white flex items-start justify-center p-0"
      role="dialog"
      aria-label="Edit prospect"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: drag.active && drag.dy > 0 ? `translateY(${Math.max(0, drag.dy)}px)` : undefined,
        transition: drag.active ? 'none' : 'transform 160ms ease-out',
      }}
    >
      <div className="w-full max-w-3xl mx-auto">
        {/* grab handle + header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b">
          <div className="h-5 flex items-center justify-center">
            <div className="w-10 h-1.5 rounded-full bg-gray-300 mt-2" />
          </div>
          <div className="px-3 pb-2 flex items-center gap-2">
            <EditableText
              value={p.fullName || ''}
              placeholder="name..."
              onChange={(v)=>onChange({ fullName: v })}
              className="font-medium text-base truncate"
              inputClass="font-medium border rounded px-2 py-1 select-text"
            />
            <div className="ml-auto flex items-center gap-2">
              <button className="px-3 py-1 rounded-full border text-xs"
                      onClick={async()=>{ const ok=await askConfirm(); if(!ok) return; await onDelete?.(); }}>
                Delete
              </button>
              <button className="px-3 py-1 rounded-full border text-xs" onClick={onClose}>Done</button>
            </div>
          </div>
        </div>

        {/* content */}
        <div className="p-3 space-y-3">
          {/* Status + City */}
          <div className="grid grid-cols-2 gap-2 items-start">
            <div>
              <div className="text-xs mb-1">Status</div>
              <StatusPill value={p.status||'New'} onChange={(s)=>onChange({status:s})} />
            </div>
            <div>
              <div className="text-xs mb-1">City</div>
              <InlinePill label={p.city||''} placeholder="Enter city…" onEdit={(v)=>onChange({city:v})} full />
            </div>
          </div>

          {/* Source + Trust */}
          <div className="grid grid-cols-2 gap-3 items-start">
            <div>
              <div className="text-xs mb-1">Suggested by</div>
              <InlinePill label={p.sourceName||''} placeholder="name..." onEdit={(v)=>onChange({sourceName:v})} full />
            </div>
            <div>
              <div className="text-xs mb-1">Known status</div>
              <TrustSelect value={p.sourceTrust||''} onChange={(v)=>onChange({sourceTrust:v})} />
            </div>
          </div>
{/* Resume — long-press to Share / Save / Delete */}
<div>
  <div className="text-xs mb-1">Resume</div>

  {p.resume ? (
    <LongPressShare
      fileRef={p.resume}
      onDelete={async () => {
        const ok = await askConfirm(); if (!ok) return;
        if (p.resume) await deleteFileRef(p.resume);
        onChange({ resume: null });
      }}
    >
      <div
        className="group cursor-pointer inline-block"
        onClick={() => {
          setViewerFile(p.resume);
          setViewerPhotos([]);
          setViewerIndex(0);
        }}
        title="Tap to view • long-press for menu"
      >
        <div className="w-40">
          <MiniPreview fileRef={p.resume} />
        </div>
      </div>
    </LongPressShare>
  ) : (
    <button
      type="button"
      onClick={() => document.getElementById(`prospect-resume-${p.id}`)?.click()}
      className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 shadow-sm flex flex-col items-center justify-center"
    >
      <div className="text-3xl leading-none text-gray-400">+</div>
      <div className="text-xs text-gray-500 mt-1">Add resume</div>
      <input
        id={`prospect-resume-${p.id}`}
        type="file"
        accept="*/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const ref = await attachFile(f);
            onChange({ resume: ref });
          }
          e.target.value = "";
        }}
      />
    </button>
  )}
</div>
{/* Photos — long-press to Share / Save / Delete */}
<div>
  <div className="text-xs mb-1">Photos</div>

  <div className="relative inline-block">
    {p.photos?.[1] && (
      <div className="absolute left-2 top-2 w-40 h-28 rounded-md bg-white border overflow-hidden opacity-70 pointer-events-none -z-0">
        <MiniPreview fileRef={p.photos[1]} />
      </div>
    )}

    {p.photos?.[0] ? (
      <div className="relative z-10">
        <LongPressShare
          fileRef={p.photos[0]}
          onDelete={async () => {
            const ok = await askConfirm(); if (!ok) return;
            const next = (p.photos || []).slice(1);
            await deleteFileRef(p.photos[0]);
            onChange({ photos: next });
          }}
        >
          <div
            className="w-40 h-28 rounded-md bg-white border overflow-hidden cursor-pointer"
            onClick={() => {
              setViewerPhotos(p.photos || []);
              setViewerIndex(0);
              setViewerFile(p.photos?.[0]);
            }}
            title="Tap to preview • long-press for menu"
          >
            <MiniPreview fileRef={p.photos[0]} />
          </div>
        </LongPressShare>

        {/* small add button */}
        <button
          type="button"
          onClick={() => document.getElementById(`prospect-photos-${p.id}`)?.click()}
          className="absolute -bottom-3 -right-3 z-20 w-8 h-8 rounded-full border bg-white shadow flex items-center justify-center"
          title="Add photo"
        >
          +
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => document.getElementById(`prospect-photos-${p.id}`)?.click()}
        className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 shadow-sm flex flex-col items-center justify-center"
      >
        <div className="text-3xl leading-none text-gray-400">+</div>
        <div className="text-[11px] text-gray-500 mt-1">Add photos</div>
      </button>
    )}
    <input
      id={`prospect-photos-${p.id}`}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={async (e) => {
        const fs = Array.from(e.target.files || []);
        if (fs.length) {
          const refs = [];
          for (const f of fs) refs.push(await attachFile(f));
          onChange({ photos: [...(p.photos || []), ...refs] });
        }
        e.target.value = "";
      }}
    />
  </div>
</div>

          {/* Notes */}
          <div className="mt-2">
            <div className="text-sm font-medium">Notes</div>
            <div className="relative">
              <textarea
                className="border rounded p-2 w-full text-sm pr-12 select-text placeholder-gray-400"
                placeholder="Type notes…"
                rows={3}
                value={p.notes || ''}
                onChange={(e) => onChange({ notes: e.target.value })}
              />
              <IconBtn
                ariaLabel="Share notes"
                label="Share"
                onClick={() => shareText(p.notes || '')}
                className="absolute -bottom-3 -left-3 z-20 border-blue-300 text-blue-700 bg-white/90 hover:bg-white"
              >
                <IconShare />
              </IconBtn>
            </div>
          </div>

          {/* Share all */}
          {hasTwo && (
            <div>
              <button type="button"
                      className="px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700"
                      onClick={()=>shareAll({ resume:p.resume, photos:p.photos||[], text:p.notes||'' })}>
                Share all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* local viewer */}
      {viewerFile && (
        <Viewer
          fileRef={viewerFile}
          photos={viewerPhotos}
          startIndex={viewerIndex}
          onClose={()=> { setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); }}
          onDeletePhoto={async (i, ref) => {
            const ok = await askConfirm(); if (!ok) return;
            try { if (ref) await deleteFileRef(ref); } catch {}
            const cur = ensureArray(p.photos);
            const next = cur.filter((_, idx)=> idx !== i);
            onChange({ photos: next });
            setViewerPhotos(next);
            if (next.length === 0) { setViewerFile(null); }
            else {
              const newIndex = Math.min(i, next.length-1);
              setViewerIndex(newIndex);
              setViewerFile(next[newIndex]);
            }
          }}
        />
      )}
      {Confirm}
    </div>
  );
}

// ===== Inline editors & selects =====
function StatusPill({ value, onChange }){
  const [open,setOpen]=useState(false); const [alignRight,setAlignRight]=useState(false); const ref=useRef(null);
  useEffect(()=>{ if(!open) return; const close=(e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('click', close); return ()=>document.removeEventListener('click', close); },[open]);
  const onTrigger=(e)=>{ e.stopPropagation(); const MENU_W=176; if(ref.current){ const r=ref.current.getBoundingClientRect(); setAlignRight(r.left + MENU_W > window.innerWidth);} setOpen(o=>!o); };
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" className={`px-3 py-1 rounded-full text-sm font-medium border min-h-[36px] ${statusTone(value)}`} onClick={onTrigger}>{value}</button>
      {open && (
        <div className={`absolute z-50 mt-1 w-44 rounded border bg-white shadow ${alignRight ? 'right-0' : 'left-0'}`}>
          {STATUS.map(s => (
            <button key={s} type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={(e)=>{ e.stopPropagation(); onChange(s); setOpen(false); }}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function InlinePill({ label, placeholder='...', onEdit, full=false }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(label||'');
  useEffect(()=>setVal(label||''),[label]); const commit=()=>{ onEdit((val||'').trim()); setEditing(false); };
  return editing? (
    <input className={`border rounded-full px-3 py-1 text-sm ${full?'w-full':''} select-text`} autoFocus value={val} onChange={e=>setVal(e.target.value)} placeholder={placeholder} onKeyDown={e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') setEditing(false); }} onBlur={commit}/>
  ) : (
    <span className={`px-3 py-2 rounded-full text-sm font-medium border ${label?'bg-gray-100 border-gray-200':'bg-white text-gray-400'} ${full?'w-full text-left inline-block':''} min-h-[36px]`} title="Tap to edit" onClick={()=>setEditing(true)}>{label||placeholder}</span>
  );
}

function TrustSelect({ value, onChange }){
  return (
    <select className="border rounded-full px-3 py-2 text-sm w-full min-h-[36px] bg-white select-text" value={value || ''} onChange={(e)=>onChange(e.target.value)}>
      <option value="" disabled>Select</option>
      {TRUST.map(s => (<option key={s} value={s}>{s}</option>))}
    </select>
  );
}

function EditableText({ value, onChange, className, inputClass, placeholder="name...", disabled=false }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(value);
  useEffect(()=>setVal(value),[value]);
  return editing? (
    <input className={`${inputClass} placeholder-gray-400`} value={val} autoFocus onChange={e=>setVal(e.target.value)} placeholder={placeholder} onKeyDown={e=>{ if(e.key==='Enter'){ onChange((val||'').trim()); setEditing(false);} if(e.key==='Escape'){ setEditing(false);} }} onBlur={()=>{ onChange((val||'').trim()); setEditing(false);} } />
  ) : (
    <button
  className={className}
  onClick={()=>{ if (!disabled) setEditing(true); }}
  title={disabled ? undefined : "Tap to edit"}
  disabled={disabled}
>
      {value ? value : <span className="text-gray-400">{placeholder}</span>}
    </button>
  );
}
function MyProfile({ profile, saveProfile }){
  const profiles=ensureArray(profile?.profiles);
  const [viewerFile, setViewerFile] = useState(null);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [selId,setSelId]=useState(profiles[0]?.id||'');
  useEffect(()=>{ if(!selId && profiles[0]?.id) setSelId(profiles[0].id); },[profile?.profiles]);
  const addProfile=()=>{ const newP={ id:uid(), name:'', photos:[], resume:null, blurb:'', updatedAt:Date.now() }; const next=[...profiles,newP]; saveProfile({ ...(profile||{}), profiles:next, updatedAt:Date.now() }); setSelId(newP.id); };
  const updateProfile=(id,patch)=>{ const next=profiles.map(k=> k.id===id?{...k,...patch,updatedAt:Date.now()}:k); saveProfile({ ...(profile||{}), profiles:next, updatedAt:Date.now() }); };
  const selected=profiles.find(k=>k.id===selId);
  const [editId,setEditId]=useState(''); const [editVal,setEditVal]=useState('');
  const [menu,setMenu]=useState({open:false,profileId:'',x:0,y:0});
  const { ask: askConfirm, Confirm } = useConfirm();
  const menuRef=useRef(null);
  useEffect(()=>{ if(!menu.open) return; const close=(e)=>{ if(menuRef.current && !menuRef.current.contains(e.target)) setMenu(s=>({...s,open:false})); }; document.addEventListener('pointerdown', close, true); return ()=>document.removeEventListener('pointerdown', close, true); },[menu.open]);
  const lpRef=useRef(null);
  const startLP=(el,id)=>{ clearTimeout(lpRef.current); lpRef.current=setTimeout(()=>{ const r=el?.getBoundingClientRect?.(); if(!r) return; setMenu({open:true,profileId:id,x:r.left+r.width/2,y:r.bottom+8}); },500); };
  const cancelLP=()=> clearTimeout(lpRef.current);
  const deleteProfile=async()=>{ const id=menu.profileId; const ok = await askConfirm(); if(!ok) return;
    const prof = profiles.find(p=>p.id===id);
    try {
      if (prof?.resume) await deleteFileRef(prof.resume);
      for (const ph of ensureArray(prof?.photos)) await deleteFileRef(ph);
    } catch {}
    const next=profiles.filter(k=>k.id!==id); saveProfile({ ...(profile||{}), profiles:next, updatedAt:Date.now() }); if(selId===id) setSelId(next[0]?.id||''); setMenu(s=>({...s,open:false})); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {profiles.map(k=> (
          editId===k.id ? (
            <input key={k.id} className={`px-3 py-1 rounded-full border select-text`} autoFocus value={editVal} onChange={(e)=>setEditVal(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ updateProfile(k.id,{name:(editVal||'').trim()}); setEditId(''); } if(e.key==='Escape'){ setEditId(''); } }} onBlur={()=>{ updateProfile(k.id,{name:(editVal||'').trim()}); setEditId(''); }} />
          ) : (
            <button key={k.id} className={`px-3 py-1 rounded-full border ${selId===k.id?'bg-black text-white':'bg-white'}`} onClick={()=>{ if(selId!==k.id) setSelId(k.id); else { setEditId(k.id); setEditVal(k.name||''); } }} onContextMenu={(e)=>{ e.preventDefault(); const r=e.currentTarget.getBoundingClientRect(); setMenu({open:true,profileId:k.id,x:r.left+r.width/2,y:r.bottom+8}); }} onMouseDown={(e)=>startLP(e.currentTarget,k.id)} onMouseUp={cancelLP} onMouseLeave={cancelLP} onTouchStart={(e)=>startLP(e.currentTarget,k.id)} onTouchEnd={cancelLP} onTouchMove={cancelLP}>
              {k.name ? k.name : <span className="text-gray-400">name...</span>}
            </button>
          )
        ))}
        <button className="px-3 py-1 rounded-full border" onClick={addProfile} aria-label="Add profile">+</button>
      </div>

      {menu.open && (
        <div ref={menuRef} style={{position:'fixed', left:menu.x, top:menu.y, transform:'translateX(-50%)'}} className="z-50 rounded border bg-white shadow">
          <button className="block w-full text-left px-3 py-2 text-red-600 hover:bg-red-50" onClick={deleteProfile}>Delete</button>
        </div>
      )}

      {selected ? (
        <>
          <div className="grid grid-cols-2 gap-2">
          {/* Resume — simplified (no Share/Download; long-press to share/save) */}
<div>
  <div className="text-xs mb-1">Resume</div>

  {selected.resume ? (
    <>
      <LongPressShare fileRef={selected.resume}>
        <div
          className="group cursor-pointer inline-block"
          onClick={() => {
            setViewerFile(selected.resume);
            setViewerPhotos([]);
            setViewerIndex(0);
          }}
          title="Tap to view. Long-press to share/save."
        >
          <div className="w-40">
            <MiniPreview fileRef={selected.resume} />
          </div>
        </div>
      </LongPressShare>
    </>
  ) : (
    <button
      type="button"
      onClick={() => document.getElementById(`profile-resume-${selected.id}`)?.click()}
      className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 shadow-sm flex flex-col items-center justify-center"
    >
      <div className="text-3xl leading-none text-gray-400">+</div>
      <div className="text-xs text-gray-500 mt-1">Add resume</div>
      <input
        id={`profile-resume-${selected.id}`}
        type="file"
        accept="*/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const ref = await attachFile(f);
            updateProfile(selected.id, { resume: ref });
          }
          e.target.value = "";
        }}
      />
    </button>
  )}
</div>

            {/* Photos (no share/download buttons; long-press to share/save) */}
            <div>
              <div className="text-xs mb-1">Photos</div>

              <div className="relative inline-block">
                {selected.photos?.[1] && (
                  <div className="absolute left-2 top-2 w-40 h-28 rounded-md bg-white border overflow-hidden opacity-70 pointer-events-none -z-0">
                    <MiniPreview fileRef={selected.photos[1]} />
                  </div>
                )}

                {selected.photos?.[0] ? (
                  <div className="relative z-10">
                    <LongPressShare fileRef={selected.photos[0]}>
                      <div
                        className="w-40 h-28 rounded-md bg-white border overflow-hidden cursor-pointer"
                        onClick={()=>{ setViewerPhotos(selected.photos||[]); setViewerIndex(0); setViewerFile(selected.photos?.[0]); }}
                        role="button"
                        tabIndex={0}
                        title="Tap to preview • long-press to share/save"
                        onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); setViewerPhotos(selected.photos||[]); setViewerIndex(0); setViewerFile(selected.photos?.[0]); } }}
                      >
                        <MiniPreview fileRef={selected.photos[0]} />
                      </div>
                    </LongPressShare>

                    {/* small add button stays */}
                    <button
                      type="button"
                      onClick={()=>document.getElementById(`profile-photos-${selected.id}`)?.click()}
                      className="absolute -bottom-3 -right-3 z-20 w-8 h-8 rounded-full border bg-white shadow flex items-center justify-center"
                      title="Add photo"
                    >+</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={()=>document.getElementById(`profile-photos-${selected.id}`)?.click()}
                    className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 shadow-sm flex flex-col items-center justify-center"
                  >
                    <div className="text-3xl leading-none text-gray-400">+</div>
                    <div className="text-[11px] text-gray-500 mt-1">Add photos</div>
                  </button>
                )}
                <input id={`profile-photos-${selected.id}`} type="file" accept="image/*" multiple className="hidden" onChange={async(e)=>{ const fs=Array.from(e.target.files||[]); if(fs.length){ const refs=[]; for(const f of fs){ refs.push(await attachFile(f)); } updateProfile(selected.id,{photos:[...(selected.photos||[]), ...refs]}); } e.target.value=""; }} />
              </div>
            </div>

            {/* Viewer + Confirm */}
            {viewerFile && (
              <Viewer
                fileRef={viewerFile}
                photos={viewerPhotos}
                startIndex={viewerIndex}
                onClose={()=> { setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); }}
                onDeletePhoto={async (i, ref) => {
                  const ok = await askConfirm(); if (!ok) return;
                  try { if (ref) await deleteFileRef(ref); } catch {}
                  const cur = ensureArray(selected?.photos);
                  const next = cur.filter((_, idx)=> idx !== i);
                  updateProfile(selected.id, { photos: next });
                  setViewerPhotos(next);
                  if (next.length === 0) { setViewerFile(null); }
                  else {
                    const newIndex = Math.min(i, next.length-1);
                    setViewerIndex(newIndex);
                    setViewerFile(next[newIndex]);
                  }
                }}
              />
            )}
            {Confirm}
          </div>

          {/* Blurb — unchanged; Share all logic below remains */}
          <div className="mt-2 max-w-xl">
            <div className="text-xs">Blurb</div>
            <div className="relative">
              <textarea className="border rounded p-2 w-full text-xs pr-12 select-text placeholder-gray-400" rows={2} value={selected.blurb || ''} onChange={e=>updateProfile(selected.id,{blurb:e.target.value})} placeholder="Type blurb…" />
            </div>
          </div>

          {/* Share all (unchanged) */}
          {(() => {
            let count = 0; if (selected.resume) count++; if ((selected.photos||[]).length) count++; if ((selected.blurb||'').trim()) count++;
            return count >= 2 ? (
              <div className="mt-3">
                <button type="button" className="px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700"
                  onClick={()=>shareAll({ resume:selected.resume, photos:selected.photos||[], text:selected.blurb||'' })}
                >
                  Share all
                </button>
              </div>
            ) : null;
          })()}
        </>
      ) : (
        <div className="text-xs text-gray-500">
          Add a profile to attach a photo or resume.
        </div>
      )}
    </div>
  );
}

// ===== App (glue) =====
export default function App(){
  const [tab,setTab]=useState('prospects');
  const [profile,setProfile]=useState(null);
  const [prospects,setProspects]=useState([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [sync, setSync] = useState({ config:'', room:'' });
  const applyingRemoteRef = useRef(false);
  const lastAppliedRef = useRef(0);

  // per-device unseen map { [prospectId]: seenTimestamp }
  const [unseenMap, setUnseenMap] = useState({});
  const saveSeenMap = async (map) => { setUnseenMap(map); try { await dbProfile.setItem('seenProspects', map); } catch {} };
// Load saved Sync settings on boot (so the panel remembers token/room)
useEffect(() => {
  (async () => {
    try {
      const saved = await dbProfile.getItem('sync');
      if (saved && (saved.config || saved.room)) setSync(saved);
    } catch {}
  })();
}, []);

  // Load + migrate
  useEffect(()=>{(async()=>{
    let p = await dbProfile.getItem('me');
    const seen = await dbProfile.getItem('seenProspects'); setUnseenMap(seen || {});
    if (p && Array.isArray(p.kids)) {
      const converted = { ...p, profiles: ensureArray(p.kids).map(k => ({ ...k, photos: k.photos || (k.photo ? [k.photo] : []), photo: undefined })), kids: undefined };
      p = converted; await dbProfile.setItem('me', converted);
    }
    if (p && !Array.isArray(p.profiles)) p = { ...(p||{}), profiles: [] };
    if (!p) { p = { profiles: [], updatedAt: Date.now() }; await dbProfile.setItem('me', p); }
    setProfile(p);

    const arr=[]; await dbProspects.iterate((v)=>arr.push(v));
    const migrated = arr.map(it => {
      const copy = { ...it };
      if (copy.kidId && !copy.profileId) { copy.profileId = copy.kidId; delete copy.kidId; }
      if (!Array.isArray(copy.photos)) { copy.photos = copy.photo ? [copy.photo] : []; delete copy.photo; }
      return copy;
    });
    if (migrated.length !== arr.length || migrated.some((m,i)=> JSON.stringify(m)!==JSON.stringify(arr[i]))) {
      await Promise.all(migrated.map((it)=>dbProspects.setItem(it.id, it)));
    }
    setProspects(ensureArray(migrated));
  })();},[]);

  // Keep activeProfileId valid
  useEffect(()=>{
    const profiles=ensureArray(profile?.profiles);
    const exists=activeProfileId && profiles.some(k=>k.id===activeProfileId);
    if(!exists) setActiveProfileId(profiles[0]?.id||'');
  },[profile,activeProfileId]);

  // Save helpers
  const saveProfile = async (p) => {
    const safe={...(p||{}), profiles:ensureArray(p?.profiles)};
    setProfile(safe);
    await dbProfile.setItem('me', safe);
  };
  const saveProspects = async (list)=>{
    const safe=ensureArray(list);
    setProspects(safe);
    await Promise.all(safe.map((it)=>dbProspects.setItem(it.id, it)));
    try{
      const keys=await dbProspects.keys();
      const alive=new Set(safe.map(it=>it.id));
      await Promise.all(keys.filter(k=>!alive.has(k)).map(k=>dbProspects.removeItem(k)));
    }catch{}
  };

  // === START REPLACE: Minimal cloud sync section ===

// Minimal cloud sync: initial fetch
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!sync?.room) return;
    const cloud = await fetchRoom(sync.room);
    if (!cloud || cancelled) return;

    let prof = cloud.profile;
    if (prof?.kids && !prof.profiles) {
      prof = {
        ...prof,
        profiles: ensureArray(prof.kids).map(k => ({
          ...k,
          photos: k.photos || (k.photo ? [k.photo] : []),
          photo: undefined
        })),
        kids: undefined
      };
    }
    if (prof) setProfile(prof);

    let list = Array.isArray(cloud.prospects) ? cloud.prospects : [];
    list = list.map(it =>
      !Array.isArray(it.photos)
        ? { ...it, photos: it.photo ? [it.photo] : [], photo: undefined, profileId: it.profileId || it.kidId }
        : it
    );
    setProspects(list);
  })();
  return () => { cancelled = true; };
}, [sync?.room]);

// Sync receive (subscribe)
useEffect(() => {
  if (!sync?.room) return;
  const unsub = subscribeRoom(sync.room, async (payload) => {
    if (payload?.clientId === clientId) return;
    applyingRemoteRef.current = true;
    lastAppliedRef.current = Date.now();

    if (payload.profile) setProfile(payload.profile);
    if (Array.isArray(payload.prospects)) setProspects(payload.prospects);

    // NEW: handle incoming files
    if (Array.isArray(payload.files)) {
      for (const f of payload.files) {
        try {
          const blob = base64ToBlob(f.base64, f.type || 'application/octet-stream');
          await dbFiles.setItem(f.id, blob);
        } catch {}
      }
    }

    applyingRemoteRef.current = false;
  });
  return () => { try { unsub?.(); } catch {} };
}, [sync?.room]);

// Sync send
useEffect(() => {
  if (!sync?.room) return;
  if (lastAppliedRef.current && Date.now() - lastAppliedRef.current < 800) return;
  if (applyingRemoteRef.current) { applyingRemoteRef.current = false; return; }

  const send = async () => {
  await saveRoom(sync.room, { profile, prospects, clientId }).catch(() => {});
};

  const t = setTimeout(send, 400);
  return () => clearTimeout(t);
}, [profile, prospects, sync?.room]);

// === END REPLACE: Minimal cloud sync section ===

  // Export / Import (v2)
  const importRef=useRef(null);
  const b64ToBlob=(b64,type)=>{ const s=atob(b64); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return new Blob([a],{type}); };
  const exportAll = async () => {
    const prof = await dbProfile.getItem('me');
    const list = []; await dbProspects.iterate((v) => list.push(v));
    const ids = new Map(); const add = (r) => { if (r && r.id) ids.set(r.id, r); };
    if (prof) {
      add(prof.resume);
      ensureArray(prof.photos).forEach(add);
      ensureArray(prof.profiles).forEach((k) => { add(k.resume); ensureArray(k.photos).forEach(add); });
    }
    ensureArray(list).forEach((p) => { add(p.resume); ensureArray(p.photos).forEach(add); });
    const files = [];
    for (const ref of ids.values()) {
      const blob = await dbFiles.getItem(ref.id); if (!blob) continue;
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onloadend = () => res((r.result || '').toString().split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      files.push({ ...ref, base64: b64 });
    }
    const payload = { version: 2, exportedAt: Date.now(), profile: prof, prospects: list, files };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const backupFile = new File([blob], 'shidduch-backup.json', { type: 'application/json' });
    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [backupFile] })) {
        await navigator.share({ files: [backupFile], title: 'Shidduch backup' });
        return;
      }
    } catch (e) { if (e?.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'shidduch-backup.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const importAll = async (file)=>{
    try {
      const text=await file.text();
      const data=JSON.parse(text);
      if(!data || !Array.isArray(data.files)){ alert('Invalid file'); return; }
      for(const f of data.files){
        try{
          const blob=b64ToBlob(f.base64, f.type||'application/octet-stream');
          await dbFiles.setItem(f.id, blob);
        }catch{}
      }
      let prof = data.profile || {};
      if (prof.kids && !prof.profiles) {
        prof = { ...prof, profiles: ensureArray(prof.kids).map(k=>({ ...k, photos: k.photos || (k.photo?[k.photo]:[]), photo: undefined })), kids: undefined };
      }
      if (!Array.isArray(prof.profiles)) prof.profiles = [];
      await dbProfile.setItem('me', prof); setProfile(prof);

      const existing=new Map(ensureArray(prospects).map(p=>[p.id,p]));
      const merged=[...ensureArray(prospects)];
      for(const raw of ensureArray(data.prospects)){
        const p = (!Array.isArray(raw.photos)) ? ({ ...raw, photos: raw.photo?[raw.photo]:[], photo: undefined, profileId: raw.profileId || raw.kidId }) : raw;
        if(existing.has(p.id)){
          const cur=existing.get(p.id);
          if((p.updatedAt||0)>(cur.updatedAt||0)){
            const i=merged.findIndex(x=>x.id===p.id);
            merged[i]=p;
          }
        } else {
          merged.push(p);
        }
      }
      setProspects(merged);
      await Promise.all(merged.map((it)=>dbProspects.setItem(it.id, it)));
      alert('Import done');
    } catch {
      alert('Import failed');
    }
  };

  // iPhone app icon badge (PWA)
  const [unseenMapState] = useState({});
  const updateAppBadge = async () => {
    try {
      const count = prospects.reduce((acc, p)=> acc + (((p.updatedAt||0) > (unseenMap[p.id]||0)) ? 1 : 0), 0);
      if ("setAppBadge" in navigator && typeof navigator.setAppBadge === "function") {
        if (count > 0) await navigator.setAppBadge(count); else await navigator.clearAppBadge();
      }
    } catch {}
  };
  useEffect(()=>{ updateAppBadge(); }, [prospects, unseenMap, unseenMapState]);

  const markSeen = async (prospectId, ts) => {
    const next = { ...(unseenMap||{}) , [prospectId]: Math.max(unseenMap[prospectId]||0, ts||Date.now()) };
    setUnseenMap(next); try { await dbProfile.setItem('seenProspects', next); } catch {}
  };

  return (
    <div className="p-4 max-w-4xl mx-auto text-sm select-none" style={{ WebkitTapHighlightColor: 'transparent' }}>
      {/* Version label */}
      <div className="text-xs text-gray-500 mb-1">Shidduch Organizer • v2.0 (Lite)</div>

            {/* Folder Tabs (lifted) */}
<div role="tablist" aria-label="Sections" className="mb-4">
  <div className="relative">
    {/* subtle baseline under tabs */}
    <div className="absolute inset-x-0 bottom-0 h-px bg-gray-200" />

    <div className="flex items-end gap-2">
      <button
        role="tab"
        aria-selected={tab==='prospects'}
        className={`px-3 py-2 rounded-t-xl border border-b-0 transition-all
          ${tab==='prospects'
            ? 'bg-gradient-to-b from-white to-gray-50 shadow-lg ring-1 ring-black/5 translate-y-[1px]'
            : 'bg-gray-50 text-gray-700 hover:shadow-sm'
          }`}
        onClick={()=>setTab('prospects')}
      >
        Resumes
      </button>

      <div className="flex-1" />

      <button
        role="tab"
        aria-selected={tab==='profile'}
        className={`px-3 py-2 rounded-t-xl border border-b-0 transition-all
          ${tab==='profile'
            ? 'bg-gradient-to-b from-white to-gray-50 shadow-lg ring-1 ring-black/5 translate-y-[1px]'
            : 'bg-gray-50 text-gray-700 hover:shadow-sm'
          }`}
        onClick={()=>setTab('profile')}
      >
        My Profile
      </button>
    </div>
  </div>
</div>

      {/* Settings (gear) */}
      <div className="mb-4">
        <SettingsFab
          onExport={exportAll}
          onImport={() => importRef.current?.click()}
          onOpenSync={()=>setSyncOpen(true)}
        />
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={e=>{ const f=e.target.files?.[0]; if(f) importAll(f); }}
        />
      </div>

      {/* Sync panel */}
      <SyncPanel
        open={syncOpen}
        initial={sync}
        onSave={async (s)=>{ setSync(s); await dbProfile.setItem('sync', s); }}
        onClear={async ()=>{ setSync({config:'', room:''}); try{ await dbProfile.removeItem('sync'); }catch{} }}
        onClose={()=>setSyncOpen(false)}
      />

      {/* Content */}
      {tab==='prospects' ? (
        <Prospects
          profile={profile}
          saveProfile={saveProfile}
          prospects={prospects}
          setProspects={saveProspects}
          activeProfileId={activeProfileId}
          setActiveProfileId={setActiveProfileId}
          unseenMap={unseenMap}
          markSeen={markSeen}
        />
      ) : (
        <MyProfile profile={profile} saveProfile={saveProfile} />
      )}
    </div>
  );
}