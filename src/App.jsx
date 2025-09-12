import React, { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { fetchRoom, saveRoom, subscribeRoom } from "./lib/sync";
import { uploadFile, viewUrl, deleteRef } from "./lib/files";
function useAutosize(ref, value) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = String(el.scrollHeight) + 'px';
  }, [ref, value]);
}
// --- global safe-area + overscroll guard (no extra wrappers) ---
if (typeof document !== 'undefined') {
  const id = 'viewer-safearea-style';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      html, body { overscroll-behavior: none; }
      @supports (padding: max(env(safe-area-inset-top), 0px)) {
        .safe-area {
          padding-top: env(safe-area-inset-top);
          padding-right: env(safe-area-inset-right);
          padding-bottom: env(safe-area-inset-bottom);
          padding-left: env(safe-area-inset-left);
        }
      }
    `;
    document.head.appendChild(style);
  }
}

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

/* === MERGE HELPERS (new) =============================================== */

/** Merge two arrays of objects with {id, updatedAt}, prefer newer by updatedAt. */
function mergeByIdUpdatedAt(localArr, incomingArr) {
  const local = ensureArray(localArr);
  const incoming = ensureArray(incomingArr);
  const map = new Map(local.map(x => [x.id, x]));
  for (const it of incoming) {
    const cur = map.get(it.id);
    if (!cur) {
      map.set(it.id, it);
    } else {
      const a = Number(cur.updatedAt || 0);
      const b = Number(it.updatedAt || 0);
      map.set(it.id, b > a ? it : cur);
    }
  }
  return Array.from(map.values());
}

/** Merge two profiles (object with .profiles array). Prefer newer top-level by updatedAt; merge inner profiles by id. */
function mergeProfileTop(localProf, incomingProf) {
  const l = localProf || {};
  const r = incomingProf || {};
  const lTime = Number(l.updatedAt || 0);
  const rTime = Number(r.updatedAt || 0);
  const base = rTime > lTime ? { ...l, ...r } : { ...r, ...l }; // newer wins for top-level scalars
  base.profiles = mergeByIdUpdatedAt(ensureArray(l.profiles), ensureArray(r.profiles));
  return base;
}
/* === END MERGE HELPERS ================================================== */

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
const shareText = async (text) => {
  const t = (text || '').trim();
  if (!t) return;
  const navAny = navigator;
  try {
    if (navAny.share) {
      await navAny.share({ text: t });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // user canceled
  }
  try {
    await navigator.clipboard.writeText(t);
    alert('Notes copied to clipboard');
  } catch {
    alert('Unable to share/copy notes');
  }
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
function useFilePreview(fileRef) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    let obj = '';

    // If the ref goes null/changes to something without id/key, clear the preview
    if (!fileRef?.id && !fileRef?.key) {
      setUrl('');
      return () => {};
    }

    (async () => {
      // 1) Try local cached blob first
      if (fileRef?.id) {
        try {
          const blob = await dbFiles.getItem(fileRef.id);
          if (blob instanceof Blob) {
            obj = URL.createObjectURL(blob);
            if (alive) setUrl(obj);
            return;
          }
        } catch {
          /* ignore */
        }
      }

      // 2) Fallback: signed/public URL (other devices)
      try {
        const remote = await viewUrl(fileRef);
        if (alive) setUrl(remote || '');
      } catch {
        if (alive) setUrl('');
      }
    })();

    return () => {
      alive = false;
      if (obj) setTimeout(() => URL.revokeObjectURL(obj), 0);
    };
  }, [fileRef?.id, fileRef?.key]);

  return url;
}

// --- MiniPreview (portrait tile: PDFs contain, Images cover) ---
function MiniPreview({ fileRef }) {
  const url = useFilePreview(fileRef);
  const type = (fileRef?.type || "").toLowerCase();
  const name = (fileRef?.name || "").toLowerCase();
  const isImg = type.startsWith("image/");
  const isPdf = type === "application/pdf" || name.endsWith(".pdf");

  const [pdfThumb, setPdfThumb] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setPdfThumb("");
    if (!isPdf || !fileRef?.id) return;

    (async () => {
      try {
        setLoading(true);
        const pdfjs = await loadPdfjs();

        // cached blob → AB, else signed URL
        let ab = null;
        try {
          const blob = await dbFiles.getItem(fileRef.id);
          if (blob) ab = await blob.arrayBuffer();
        } catch {}
        const src = ab ? { data: ab } : { url: await viewUrl(fileRef) };

        const doc = await pdfjs.getDocument(src).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);

        // Render ~160px tall (since our tile is taller than wide)
        const targetH = 160; // Tailwind h-40 = 160px
        const v1 = page.getViewport({ scale: 1 });
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const scale = (targetH / v1.height) * dpr;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        setPdfThumb(canvas.toDataURL("image/png"));
      } catch {
        // fallback to icon
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isPdf, fileRef?.id]);

  if (!fileRef) return null;

  // PORTRAIT TILE: w-28 h-40 (page-shaped)
  return (
    <div className="w-28 h-40 rounded-md bg-white border overflow-hidden relative flex items-center justify-center">
      {loading && <div className="absolute inset-0 animate-pulse bg-gray-100" />}

      {/* Photos: fill box (may crop) */}
      {isImg && url && (
        <img
          src={url}
          alt={fileRef.name || "image"}
          className="w-full h-full object-cover select-none"
          draggable={false}
        />
      )}

      {/* PDFs: mini full page, no outer bars (box matches page aspect) */}
      {isPdf && pdfThumb && (
        <img
          src={pdfThumb}
          alt={fileRef.name || "PDF"}
          className="w-full h-full object-contain bg-white select-none"
          draggable={false}
        />
      )}

      {/* Fallbacks */}
      {!isImg && !isPdf && !loading && (
        <div className="text-3xl text-gray-400">📄</div>
      )}
      {isPdf && !pdfThumb && !loading && (
        <div className="text-3xl text-gray-400">📄</div>
      )}
    </div>
  );
}


// --- pdf.js (UMD) one-time loader ---
let _pdfjsPromise = null;
function loadPdfjs() {
  // Reuse if already loaded
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsPromise) return _pdfjsPromise;

  _pdfjsPromise = new Promise((resolve, reject) => {
    const base = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
    // Load main UMD
    const s = document.createElement("script");
    s.src = base + "pdf.min.js";
    s.async = true;
    s.onload = () => {
      try {
        // Ensure worker is set (prevents “worker not found” issues on mobile)
        if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
        }
        resolve(window.pdfjsLib);
      } catch (err) {
        reject(err);
      }
    };
    s.onerror = (e) => reject(new Error("Failed to load pdf.js"));
    document.head.appendChild(s);
  });

  return _pdfjsPromise;
}
// --- end pdf.js loader ---

// --- Helpers for PDF blobs ---
async function getPdfBlobFromRef(fileRef) {
  if (!fileRef?.id) return null;

  // 1) try local cache first
  try {
    const cached = await dbFiles.getItem(fileRef.id);
    if (cached instanceof Blob) return cached;
  } catch {}

  // 2) fallback: fetch via signed/public URL, then cache
  try {
    const url = await viewUrl(fileRef);
    if (!url) return null;
    const resp = await fetch(url, { credentials: "omit" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    try { await dbFiles.setItem(fileRef.id, blob); } catch {}
    return blob;
  } catch {
    return null;
  }
}

async function blobToArrayBuffer(blob) {
  return await blob.arrayBuffer();
}
// --- PinchZoom: two-finger pinch + pan, reports lock state to parent ---
function PinchZoom({ children, onLockChange, min=1, max=3 }) {
  const wrapRef = React.useRef(null);
  const innerRef = React.useRef(null);

  const [state, setState] = React.useState({ scale: 1, tx: 0, ty: 0 });

  // notify parent (e.g., to disable swipe while zoomed)
  React.useEffect(() => { onLockChange?.(state.scale > 1.01); }, [state.scale, onLockChange]);

  const pinchRef = React.useRef({
    startScale: 1, startTx: 0, startTy: 0,
    startDist: 0, startMid: { x: 0, y: 0 }, active: false,
  });

  const getDistance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const getMidpoint = (t1, t2) => ({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchRef.current = {
        startScale: state.scale,
        startTx: state.tx,
        startTy: state.ty,
        startDist: getDistance(a, b),
        startMid: getMidpoint(a, b),
        active: true,
      };
      e.preventDefault();
    }
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      e.preventDefault();
      const [a, b] = e.touches;
      let newScale = (pinchRef.current.startScale * getDistance(a, b)) / pinchRef.current.startDist;
      newScale = Math.max(min, Math.min(max, newScale));

      const wrap = wrapRef.current;
      const inner = innerRef.current;
      const rect = wrap.getBoundingClientRect();

      const sx = pinchRef.current.startMid.x - rect.left - pinchRef.current.startTx;
      const sy = pinchRef.current.startMid.y - rect.top  - pinchRef.current.startTy;

      const scaleRatio = newScale / pinchRef.current.startScale;
      const dx = sx * (scaleRatio - 1);
      const dy = sy * (scaleRatio - 1);

      const drift = getMidpoint(a, b);
      let tx = pinchRef.current.startTx - dx + (drift.x - pinchRef.current.startMid.x);
      let ty = pinchRef.current.startTy - dy + (drift.y - pinchRef.current.startMid.y);

      const innerW = inner.scrollWidth  * newScale;
      const innerH = inner.scrollHeight * newScale;
      const maxX = Math.max(0, (innerW - rect.width)  / 2);
      const maxY = Math.max(0, (innerH - rect.height) / 2);
      tx = Math.min(maxX, Math.max(-maxX, tx));
      ty = Math.min(maxY, Math.max(-maxY, ty));

      setState({ scale: newScale, tx, ty });
    }
  };

  const onTouchEnd = () => {
    if (!pinchRef.current.active) return;
    pinchRef.current.active = false;
    if (state.scale < 1.02) setState({ scale: 1, tx: 0, ty: 0 }); // snap back
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full max-h-[90vh] overflow-hidden bg-white"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        ref={innerRef}
        style={{
          transform: `translate3d(${state.tx}px, ${state.ty}px, 0) scale(${state.scale})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// --- Vertical PDF stack (all pages rendered with pdf.js, no iframes) ---
function PdfStack({ fileRef }) {
  const [state, setState] = React.useState({
    loading: true,
    pages: [],           // array of {canvasId, w, h}
    pageCount: 0,
    error: '',
  });

  React.useEffect(() => {
    let cancelled = false;
    let doc = null;

    (async () => {
      setState({ loading: true, pages: [], pageCount: 0, error: '' });

      try {
        const pdfjs = await loadPdfjs();

// Always feed pdf.js raw data; avoid worker URL fetch/CORS weirdness
let ab = null;
const cachedBlob = await getPdfBlobFromRef(fileRef);
if (cachedBlob) {
  ab = await cachedBlob.arrayBuffer();
} else {
  const url = await viewUrl(fileRef);
  if (!url) throw new Error('no-source');
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('fetch-failed');
  ab = await resp.arrayBuffer();
}

// Keep worker enabled (faster); also make iOS happier
const loadingTask = pdfjs.getDocument({
  data: ab,
  isEvalSupported: false,          // iOS/Safari safety
  useSystemFonts: true
});

doc = await loadingTask.promise;

        if (cancelled) { try { doc.destroy?.(); } catch {} return; }

        const pageCount = doc.numPages || 0;
        const pagesMeta = Array.from({ length: pageCount }, (_, i) => ({
          canvasId: `pdfc_${fileRef?.id || 'x'}_${i + 1}`,
          w: 0,
          h: 0,
        }));

        setState(s => ({ ...s, pageCount, pages: pagesMeta }));

// --- Wait for React to paint the <canvas> nodes and make sure they exist ---
await new Promise(requestAnimationFrame);
await new Promise(requestAnimationFrame); // one more for layout on iOS

// Render pages sequentially; keep memory reasonable
for (let i = 1; i <= pageCount; i++) {
  if (cancelled) break;

  const page = await doc.getPage(i);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const v1  = page.getViewport({ scale: 1 });

  const metaIdx = i - 1;

  // Wait for the canvas element to actually be in the DOM
  let canvas = null;
  for (let tries = 0; tries < 20; tries++) {
    canvas = document.getElementById(pagesMeta[metaIdx].canvasId);
    if (canvas) break;
    await new Promise(r => setTimeout(r, 16));
  }
  if (!canvas) continue;

  // Measure the available CSS width (the div that wraps the canvas)
  const wrapper = canvas.parentElement || canvas;
  // subtract a few px for borders/padding
  const maxCssW = Math.max(
    280,
    (wrapper.clientWidth || window.innerWidth || 360) - 8
  );

  // Fit to container width; compute render scale so device pixels = cssW * dpr
  const cssW        = Math.min(Math.ceil(v1.width), Math.ceil(maxCssW));
  const renderScale = (cssW * dpr) / v1.width;
  const vp          = page.getViewport({ scale: renderScale });

  // Backing store (device pixels) + CSS size
  canvas.width  = Math.max(1, Math.ceil(vp.width));
  canvas.height = Math.max(1, Math.ceil(vp.height));
  canvas.style.width  = Math.ceil(vp.width  / dpr) + 'px';
  canvas.style.height = Math.ceil(vp.height / dpr) + 'px';

  const ctx = canvas.getContext('2d', { alpha: false });

  // Debug fill to prove we’re painting (and avoid “white on white” flashes)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Render
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  if (!cancelled) {
    setState(s => {
      const next = [...s.pages];
      next[metaIdx] = { ...next[metaIdx], w: canvas.width, h: canvas.height };
      return { ...s, pages: next, loading: false };
    });
  }

  // Small yield so the UI can breathe
  await new Promise(r => setTimeout(r, 10));
}

      } catch (e) {
        if (!cancelled) {
          setState({ loading: false, pages: [], pageCount: 0, error: 'pdf-failed' });
        }
      } finally {
        try { doc?.destroy?.(); } catch {}
      }
    })();

    return () => { cancelled = true; };
  }, [fileRef?.id, fileRef?.key]);

  if (state.loading && !state.pages.length) {
    return <div className="p-6 text-center text-sm text-gray-500">Loading PDF…</div>;
  }

  if (state.error) {
    return (
      <div className="p-6 text-center text-sm text-gray-500 space-y-3">
        <div>Unable to render PDF.</div>
        <OpenSystemViewerButton fileRef={fileRef} />
      </div>
    );
  }

 return (
  <div className="w-full p-3 bg-white">
    {state.pages.map((p, idx) => (
      <div key={p.canvasId} className="mb-4">
        <div className="text-[11px] text-gray-500 mb-1">
          Page {idx + 1} / {state.pageCount}
        </div>
        {/* Pinch + pan container */}
        <div className="mx-auto rounded border overflow-hidden touch-none" style={{ width: 'min(100%, 900px)' }}>
          <PinchZoom maxScale={3}>
            <canvas id={p.canvasId} className="block w-full h-auto" />
          </PinchZoom>
        </div>
      </div>
    ))}
  </div>
);
}

// --- “Open in system viewer” fallback button ---
function OpenSystemViewerButton({ fileRef }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      className="px-3 py-1 rounded-full border text-xs bg-white hover:bg-gray-50"
      onClick={async () => {
        try {
          setBusy(true);
          const url = await viewUrl(fileRef);
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
    >
      {busy ? 'Opening…' : 'Open in system viewer'}
    </button>
  );
}
// ===== Viewer (full-screen overlay; images & PDFs; swipe nav; pinch zoom) =====
function Viewer({ fileRef, photos = [], startIndex = 0, onClose, onDeletePhoto }) {
  // Identify type
  const name = (fileRef?.name || '').toLowerCase();
  const type = (fileRef?.type || '').toLowerCase();
  const isImg = type.startsWith('image/');
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');

  // Lock background scroll
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Indices
  const [idx, setIdx] = React.useState(startIndex || 0);
  React.useEffect(() => setIdx(startIndex || 0), [startIndex, fileRef?.id]);

  // PDF state
  const [pdfPage, setPdfPage] = React.useState(1);
  const [pdfPages, setPdfPages] = React.useState(null);
  const [pdfCanvasUrl, setPdfCanvasUrl] = React.useState('');
  const [pdfLoading, setPdfLoading] = React.useState(false);

  // Zoom / pan
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4.5;
  const SNAP_EPS  = 0.02;   // treat 0.98–1.02 as 1×
  const CLOSE_EPS = 0.05;   // widened close window
  const [z, setZ]   = React.useState(1);
  const [tx, setTx] = React.useState(0);   // px from screen center
  const [ty, setTy] = React.useState(0);
  const [isPinching, setIsPinching] = React.useState(false);
  const [dragDY, setDragDY] = React.useState(0); // visual backdrop slide at ~1×

  // Natural size for contain calc (CSS px)
  const [natW, setNatW] = React.useState(0);
  const [natH, setNatH] = React.useState(0);

  // Inertia (targeted glide)
  const inertiaRef = React.useRef({ id:0, running:false, t0:0, x0:0, y0:0, x1:0, y1:0, dur:0 });
  const stopInertia = React.useCallback(() => {
    const r = inertiaRef.current;
    if (r.running && r.id) cancelAnimationFrame(r.id);
    r.running = false; r.id = 0;
  }, []);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const startGlideTo = React.useCallback((targetX, targetY, durationMs=200) => {
    stopInertia();
    const r = inertiaRef.current;
    r.running = true;
    r.t0 = performance.now();
    r.x0 = tx; r.y0 = ty;
    r.x1 = targetX; r.y1 = targetY;
    r.dur = durationMs;
    const step = () => {
      if (!r.running) return;
      const now = performance.now();
      const t = Math.min(1, (now - r.t0) / r.dur);
      const e = easeOutCubic(t);
      setTx(r.x0 + (r.x1 - r.x0) * e);
      setTy(r.y0 + (r.y1 - r.y0) * e);
      if (t >= 1) { r.running = false; r.id = 0; return; }
      r.id = requestAnimationFrame(step);
    };
    r.id = requestAnimationFrame(step);
  }, [tx, ty, stopInertia]);

  // Reset when source changes
  const resetView = React.useCallback(() => {
    setZ(1); setTx(0); setTy(0); setDragDY(0); stopInertia();
  }, [stopInertia]);
  React.useEffect(() => { resetView(); }, [idx, pdfPage, resetView, fileRef?.id]);

  // Close & delete gates (only at ~1×, tiny pan, not pinching)
  const atRest = (Math.abs(z - 1) <= CLOSE_EPS) && (Math.abs(tx) + Math.abs(ty) <= 4) && !isPinching;
  const canClose  = atRest;
  const canDelete = atRest && isImg && typeof onDeletePhoto === 'function';

  // Current image URL
  const currentPhotoRef = isImg ? (photos.length ? photos[idx % photos.length] : fileRef) : null;
  const currentPhotoUrl = useFilePreview(currentPhotoRef || null);

  // Viewport + contain sizing
  const getContainBase = React.useCallback(() => {
    const vw = window.innerWidth  || 360;
    const vh = window.innerHeight || 640;
    if (!natW || !natH) return { baseW: vw, baseH: vh, vw, vh };
    const scale = Math.min(vw / natW, vh / natH);
    return { baseW: natW * scale, baseH: natH * scale, vw, vh };
  }, [natW, natH]);

  // Clamp pan to viewport edges
  const clampPan = React.useCallback((nx, ny, nextZ = z) => {
    const { baseW, baseH, vw, vh } = getContainBase();
    const showW = baseW * nextZ;
    const showH = baseH * nextZ;
    const maxX = Math.max(0, (showW - vw) / 2);
    const maxY = Math.max(0, (showH - vh) / 2);
    return [clamp(nx, -maxX, maxX), clamp(ny, -maxY, maxY)];
  }, [getContainBase, z]);

  // Finger-anchored pinch bookkeeping
  const pinchRef = React.useRef(null);
  const screenToContent = React.useCallback((sx, sy, zNow = z, txNow = tx, tyNow = ty) => {
    const { vw, vh } = getContainBase();
    const dx = sx - vw / 2;
    const dy = sy - vh / 2;
    return { cx: (dx - txNow) / zNow, cy: (dy - tyNow) / zNow };
  }, [getContainBase, z, tx, ty]);

  // PDF render → dataURL (bitmap) & nat size from canvas
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPdf || !fileRef?.id) return;
      setPdfLoading(true);
      setPdfCanvasUrl('');
      try {
        const blob = await dbFiles.getItem(fileRef.id);
        const ab = blob ? await blob.arrayBuffer() : null;
        const pdfjs = await loadPdfjs();
        const src = ab ? { data: ab } : { url: await viewUrl(fileRef) };
        const doc = await pdfjs.getDocument(src).promise;
        if (cancelled) return;

        const total = doc.numPages || 1;
        setPdfPages(total);

        const pageNum = Math.max(1, Math.min(pdfPage, total));
        const page = await doc.getPage(pageNum);

        const vw = Math.max(320, window.innerWidth || 320);
        const v1 = page.getViewport({ scale: 1 });
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const scale = (vw / v1.width) * dpr;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const url = canvas.toDataURL('image/png');
        setPdfCanvasUrl(url);
        setPdfLoading(false);

        setNatW(canvas.width / dpr);
        setNatH(canvas.height / dpr);
        setTx(0); setTy(0);
      } catch {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPdf, fileRef?.id, pdfPage]);

  // For images, set nat size on load
  const imgRef = React.useRef(null);
  const onImgLoad = React.useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    setNatW(el.naturalWidth || 0);
    setNatH(el.naturalHeight || 0);
    setTx(0); setTy(0);
  }, []);

  // Gestures (with TOTAL drag tracking for close/delete/nav at ~1×)
  const HORIZ = 60, VERT = 60, ANGLE = 12;  // slightly easier gates
  const dragRef = React.useRef({
    active:false, sx:0, sy:0, sx0:0, sy0:0, dx:0, dy:0, vx:0, vy:0, t0:0
  });

  const onTouchStart = (e) => {
    stopInertia(); // cancel any glide
    if (atRest) { setZ(1); setTx(0); setTy(0); } // snap to exact rest

    if (e.touches.length === 2) {
      const [a,b] = e.touches;
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      const anchor = screenToContent(cx, cy, z, tx, ty);
      pinchRef.current = { d0: dist(a, b), z0: z, cx, cy, anchor };
      setIsPinching(true);
      dragRef.current.active = false;
      return;
    }
    if (e.touches.length !== 1) return;
    pinchRef.current = null;
    const t = e.touches[0];
    dragRef.current = {
      active:true,
      sx:t.clientX, sy:t.clientY,
      sx0:t.clientX, sy0:t.clientY,
      dx:0, dy:0, vx:0, vy:0, t0:performance.now()
    };
  };

  const onTouchMove = (e) => {
    // Pinch zoom (finger-anchored)
    if (pinchRef.current && e.touches.length === 2) {
      const [a,b] = e.touches;
      const p = pinchRef.current;
      const d1 = dist(a, b);
      let nextZ = clamp(p.z0 * (d1 / p.d0), MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextZ - 1) <= SNAP_EPS) nextZ = 1;

      const { vw, vh } = getContainBase();
      const sx = p.cx - vw / 2, sy = p.cy - vh / 2;
      let nextTx = sx - nextZ * p.anchor.cx;
      let nextTy = sy - nextZ * p.anchor.cy;
      [nextTx, nextTy] = clampPan(nextTx, nextTy, nextZ);

      setZ(nextZ);
      setTx(nextTx);
      setTy(nextTy);
      setDragDY(0);
      return;
    }

    if (!dragRef.current.active || e.touches.length !== 1) return;

    const t = e.touches[0];
    const now = performance.now();
    const dt = Math.max(1, now - dragRef.current.t0); // ms

    const dx = t.clientX - dragRef.current.sx;
    const dy = t.clientY - dragRef.current.sy;

    // velocities normalized to ~60fps
    dragRef.current.vx = dx / dt * 16.7;
    dragRef.current.vy = dy / dt * 16.7;

    // update last point + time
    dragRef.current.sx = t.clientX;
    dragRef.current.sy = t.clientY;
    dragRef.current.t0 = now;

    if (z > 1 + SNAP_EPS) {
      const [nx, ny] = clampPan(tx + dx, ty + dy, z);
      setTx(nx); setTy(ny);
      setDragDY(0);
    } else {
      // At ~1× use TOTAL movement from origin for visual/backdrop
      const totalDy = t.clientY - dragRef.current.sy0;
      setDragDY(Math.max(0, totalDy));
    }
  };

  const onTouchEnd = () => {
    if (pinchRef.current) {
      setIsPinching(false);
      pinchRef.current = null;
      if (Math.abs(z - 1) <= SNAP_EPS) { setZ(1); setTx(0); setTy(0); }
      return;
    }
    const { active, vx, vy, sx, sy, sx0, sy0 } = dragRef.current;
    if (!active) return;
    dragRef.current.active = false;

    if (z > 1 + SNAP_EPS) {
      setDragDY(0);
      // Glide to clamped target
      const MULT = 14; // fling distance scale
      let targetX = tx + vx * MULT;
      let targetY = ty + vy * MULT;
      [targetX, targetY] = clampPan(targetX, targetY, z);
      startGlideTo(targetX, targetY, 200);
      return;
    }

    // TOTAL movement since touchstart
    const totalDx = sx - sx0;
    const totalDy = sy - sy0;
    const axTot = Math.abs(totalDx), ayTot = Math.abs(totalDy);

    // Swipe-Down = Close (vertical dominant)
    if (canClose && ayTot > VERT && totalDy > 0 && ayTot > axTot + 8) {
      onClose?.(); setDragDY(0); return;
    }

    // Swipe-Up = Delete (images only, at rest)
    if (canDelete && ayTot > VERT && totalDy < 0 && ayTot > axTot + 8) {
      const i = (photos || []).findIndex(r => r?.id === currentPhotoRef?.id);
      if (i >= 0) onDeletePhoto(i, currentPhotoRef);
      setDragDY(0); return;
    }

    // Swipe-Left/Right = Nav at rest
    if (axTot > HORIZ && axTot > ayTot + ANGLE) {
      if (isImg) {
        if (photos.length > 0)
          setIdx(i => (totalDx < 0 ? (i + 1) % photos.length : (i - 1 + photos.length) % photos.length));
      } else if (isPdf && typeof pdfPages === 'number' && pdfPages > 0) {
        setPdfPage(p => {
          if (totalDx < 0) { const n = p + 1; return n > pdfPages ? 1 : n; }
          else             { const n = p - 1; return n < 1 ? pdfPages : n; }
        });
      }
    }
    setDragDY(0);
  };

  // Keyboard (desktop)
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && atRest) onClose?.();
      if (z > 1 + SNAP_EPS) return;
      if (e.key === 'ArrowLeft') {
        if (isImg && photos.length) setIdx(i => (i - 1 + photos.length) % photos.length);
        if (isPdf && pdfPages) setPdfPage(p => (p - 1 < 1 ? pdfPages : p - 1));
      }
      if (e.key === 'ArrowRight') {
        if (isImg && photos.length) setIdx(i => (i + 1) % photos.length);
        if (isPdf && pdfPages) setPdfPage(p => (p + 1 > pdfPages ? 1 : p + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [atRest, z, isImg, isPdf, photos.length, pdfPages, onClose]);

  // Double-tap (center-anchored; tap-to-point comes later if desired)
  const lastTapRef = React.useRef(0);
  const onDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      stopInertia();
      setZ(v => {
        const targetIn  = Math.min(2.5, MAX_ZOOM);
        const next = v <= 1 + SNAP_EPS ? targetIn : 1;
        if (next === 1) { setTx(0); setTy(0); }
        else {
          const [nx, ny] = clampPan(tx, ty, next);
          setTx(nx); setTy(ny);
        }
        return next;
      });
      setDragDY(0);
    }
    lastTapRef.current = now;
  };

  const handleDelete = async (ref) => {
    if (typeof onDeletePhoto !== 'function') return;
    const i = (photos || []).findIndex(r => r?.id === ref?.id);
    if (i >= 0) await onDeletePhoto(i, ref);
  };

  // Backdrop fade + container slide for dismiss
  const progress = clamp(dragDY / 300, 0, 1);
  const bgAlpha  = 0.90 * (1 - progress);
  const translateY = dragDY ? `${dragDY}px` : '0px';

  // Absolute, center-anchored content (viewport is the only boundary)
  return (
    <div
      className="fixed inset-0 z-[3000] text-white"
      role="dialog"
      aria-label="Viewer"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onDoubleTap}
      style={{
        WebkitTapHighlightColor: 'transparent',
        background: `rgba(0,0,0,${bgAlpha.toFixed(3)})`,
        transform: `translateY(${translateY})`,
        transition: dragDY ? 'none' : 'transform 160ms ease-out, background 160ms ease-out'
      }}
    >
      <LongPressShare fileRef={isImg ? (photos.length ? photos[idx] : fileRef) : fileRef} onDelete={isImg ? handleDelete : undefined}>
        <div className="absolute inset-0 overflow-hidden select-none" style={{ touchAction: 'none' }}>
          {/* IMAGES */}
          {isImg ? (
            currentPhotoUrl ? (
              <img
                ref={imgRef}
                onLoad={onImgLoad}
                key={currentPhotoUrl}
                src={currentPhotoUrl}
                alt={currentPhotoRef?.name || 'image'}
                draggable={false}
                className="block"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${z})`,
                  transformOrigin: 'center center',
                  maxWidth: '100vw',
                  maxHeight: '100vh',
                  objectFit: 'contain'
                }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-gray-200">Loading…</div>
            )
          ) : null}

          {/* PDF */}
          {isPdf ? (
            pdfLoading ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-gray-200">Loading…</div>
            ) : pdfCanvasUrl ? (
              <img
                key={`pdf-${pdfPage}-${fileRef?.id || ''}`}
                src={pdfCanvasUrl}
                alt={`Page ${pdfPage}`}
                draggable={false}
                className="block"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${z})`,
                  transformOrigin: 'center center',
                  maxWidth: '100vw',
                  maxHeight: '100vh',
                  objectFit: 'contain'
                }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-gray-200">Unable to render PDF.</div>
            )
          ) : null}

          {/* Fallback */}
          {!isImg && !isPdf ? (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div className="text-sm text-gray-200 mb-2">Can’t preview this file type.</div>
              <button
                className="px-3 py-1 rounded border border-white/30"
                onClick={async (e) => {
                  e.stopPropagation();
                  const url = await viewUrl(fileRef);
                  if (url) window.open(url, '_blank', 'noopener,noreferrer');
                }}
              >
                Open externally
              </button>
            </div>
          ) : null}
        </div>
      </LongPressShare>
    </div>
  );
}
// --- helpers ---
function dist(a, b) { const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.hypot(dx, dy); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

      {viewerFile && (
  <Viewer
    fileRef={viewerFile}
    photos={Array.isArray(viewerPhotos) ? viewerPhotos : []}
    startIndex={0}
    onClose={() => {
      // Close only from the viewer (swipe-down or Esc)
      setViewerFile(null);
    }}
    onDeletePhoto={async (index, ref) => {
      // Keep your existing delete behavior; this is a safe default.
      // If you had custom logic before, paste it inside here.
      try {
        // Example: remove from local array and DB, then adjust UI if needed
        // await dbFiles.removeItem(ref.id);  // only if you previously removed blobs here
        // setViewerPhotos(prev => prev.filter((_, i) => i !== index));
      } catch (e) {
        console.error('Delete failed:', e);
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

  const closeMenu = React.useCallback(() => {
    setMenu(m => ({ ...m, open: false }));
  }, []);

  // Close on Escape as well
  React.useEffect(() => {
    if (!menu.open) return;
    const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu.open, closeMenu]);

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
        <>
          {/* Backdrop to allow tap-outside-to-dismiss */}
          <div
            className="fixed inset-0 z-[4999]"
            onClick={closeMenu}
          />

          {/* Context menu */}
          <div
            className="fixed z-[5000] bg-white text-gray-900 border rounded shadow text-sm"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              className="block w-full px-3 py-2 text-left hover:bg-gray-100"
              onClick={() => { shareRef(menu.file); closeMenu(); }}
            >
              Share
            </button>
            <button
              className="block w-full px-3 py-2 text-left hover:bg-gray-100"
              onClick={() => { downloadRef(menu.file); closeMenu(); }}
            >
              Save
            </button>
            {onDelete && (
              <button
                className="block w-full px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                onClick={async () => { await onDelete(menu.file); closeMenu(); }}
              >
                Delete
              </button>
            )}
          </div>
        </>
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
const notesRef = React.useRef(null);
useAutosize(notesRef, p.notes);


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
{/* Resume + Photos side-by-side */}
<div className="grid grid-cols-2 gap-3 items-start">
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
</div>
    {/* Notes */}
<div>
  <div className="text-xs mb-1">Notes</div>
  <div className="relative">
    <textarea
      ref={notesRef}
      className="border rounded p-2 w-full text-xs select-text placeholder-gray-400 resize-none overflow-hidden"
      rows={2}
      value={p.notes || ''}
      onChange={(e) => onChange({ notes: e.target.value })}
      onInput={(e) => {
        e.target.style.height = 'auto';
        e.target.style.height = String(e.target.scrollHeight) + 'px';
      }}
      placeholder="Type notes…"
    />
    <div className="mt-2">
      <IconBtn
        ariaLabel="Share notes"
        label="Share"
        onClick={() => shareText(p.notes || '')}
        className="border-blue-300 text-blue-700 bg-white hover:bg-blue-50"
      >
        <IconShare />
      </IconBtn>
    </div>
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

     {viewerFile && (
  <Viewer
    fileRef={viewerFile}
    photos={Array.isArray(viewerPhotos) ? viewerPhotos : []}
    startIndex={0}
    onClose={() => {
      // Close only from the viewer (swipe-down or Esc)
      setViewerFile(null);
    }}
    onDeletePhoto={async (index, ref) => {
      // Keep your existing delete behavior; this is a safe default.
      // If you had custom logic before, paste it inside here.
      try {
        // Example: remove from local array and DB, then adjust UI if needed
        // await dbFiles.removeItem(ref.id);  // only if you previously removed blobs here
        // setViewerPhotos(prev => prev.filter((_, i) => i !== index));
      } catch (e) {
        console.error('Delete failed:', e);
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
const blurbRef = React.useRef(null);
useAutosize(blurbRef, selected?.blurb);
  const [editId,setEditId]=useState(''); const [editVal,setEditVal]=useState('');
  const [menu,setMenu]=useState({open:false,profileId:'',x:0,y:0});
  const { ask: askConfirm, Confirm } = useConfirm();
  const menuRef=useRef(null);
  useEffect(()=>{ if(!menu.open) return; const close=(e)=>{ if(menuRef.current && !menuRef.current.contains(e.target)) setMenu(s=>({ ...s, open:false })) document.addEventListener('pointerdown', close, true); return ()=>document.removeEventListener('pointerdown', close, true); },[menu.open]);
  const lpRef=useRef(null);
  const startLP=(el,id)=>{ clearTimeout(lpRef.current); lpRef.current=setTimeout(()=>{ const r=el?.getBoundingClientRect?.(); if(!r) return; setMenu({open:true,profileId:id,x:r.left+r.width/2,y:r.bottom+8}); },500); };
  const cancelLP=()=> clearTimeout(lpRef.current);
  const deleteProfile=async()=>{ const id=menu.profileId; const ok = await askConfirm(); if(!ok) return;
    const prof = profiles.find(p=>p.id===id);
    try {
      if (prof?.resume) await deleteFileRef(prof.resume);
      for (const ph of ensureArray(prof?.photos)) await deleteFileRef(ph);
    } catch {}
    const next=profiles.filter(k=>k.id!==id); saveProfile({ ...(profile||{}), profiles:next, updatedAt:Date.now() }); if(selId===id) setSelId(next[0]?.id||''); setMenu(s=>({ ...s, open:false }))

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
   {/* Resume — fixed tile (uses MiniPreview size directly) */}
<div>
  <div className="text-xs mb-1">Resume</div>

  {selected.resume ? (
    <LongPressShare
      fileRef={selected.resume}
      onDelete={async () => {
        const ok = await askConfirm(); if (!ok) return;
        try { if (selected.resume) await deleteFileRef(selected.resume); } catch {}
        updateProfile(selected.id, { resume: null });
      }}
    >
     <div
  className="inline-block w-40 h-28 cursor-pointer"
  onClick={() => {
    setViewerFile(selected.resume);
    setViewerPhotos([]);
    setViewerIndex(0);
  }}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setViewerFile(selected.resume);
      setViewerPhotos([]);
      setViewerIndex(0);
    }
  }}
  title="Tap to view • long-press for menu"
<div
  className="inline-block w-28 h-40 cursor-pointer"
  onClick={() => {
    setViewerFile(selected.resume);
    setViewerPhotos([]);
    setViewerIndex(0);
  }}
  role="button"
  tabIndex={0}
  title="Tap to view • long-press for menu"
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setViewerFile(selected.resume);
      setViewerPhotos([]);
      setViewerIndex(0);
    }
  }}
>
  <MiniPreview fileRef={selected.resume} />
</div>

    </LongPressShare>
  ) : (
    <button
      type="button"
      onClick={() => document.getElementById(`profile-resume-${selected.id}`)?.click()}
      className="w-40 h-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 shadow-sm flex items-center justify-center"
    >
      <div className="text-3xl leading-none text-gray-400">+</div>
      <input
        id={`profile-resume-${selected.id}`}
        type="file"
        accept="application/pdf,image/*"
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

{/* Photos (uniform tile; images same size as Resume) */}
<div>
  <div className="text-xs mb-1">Photos</div>

  <div className="relative inline-block">
    {selected.photos?.[1] && (
      <div className="absolute left-2 top-2 w-40 h-28 rounded-md bg-white border overflow-hidden opacity-70 pointer-events-none -z-0">
        <MiniPreview fileRef={selected.photos[1]} />
      </div>
    )}

    {selected.photos?.[0] ? (
    <LongPressShare
  fileRef={selected.photos[0]}
  onDelete={async () => {
    const ok = await askConfirm(); if (!ok) return;
    const next = (selected.photos || []).slice(1);
    try { await deleteFileRef(selected.photos[0]); } catch {}
    updateProfile(selected.id, { photos: next });
  }}
>
  <div
    className="inline-block w-28 h-40 cursor-pointer"
    onClick={() => {
      setViewerPhotos(selected.photos || []);
      setViewerIndex(0);
      setViewerFile(selected.photos?.[0]);
    }}
    role="button"
    tabIndex={0}
    title="Tap to preview • long-press for menu"
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setViewerPhotos(selected.photos || []);
        setViewerIndex(0);
        setViewerFile(selected.photos?.[0]);
      }
    }}
  >
    <MiniPreview fileRef={selected.photos[0]} />
  </div>
</LongPressShare>

    ) : (
      <button
        type="button"
        onClick={() => document.getElementById(`profile-photos-${selected.id}`)?.click()}
        className="w-40 h-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 shadow-sm flex items-center justify-center"
      >
        <div className="text-3xl leading-none text-gray-400">+</div>
      </button>
    )}

    <input
      id={`profile-photos-${selected.id}`}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={async (e) => {
        const fs = Array.from(e.target.files || []);
        if (fs.length) {
          const refs = [];
          for (const f of fs) refs.push(await attachFile(f));
          updateProfile(selected.id, { photos: [ ...(selected.photos||[]), ...refs ] });
        }
        e.target.value = "";
      }}
    />
  </div>
</div>

 
           {viewerFile && (
  <Viewer
    fileRef={viewerFile}
    photos={Array.isArray(viewerPhotos) ? viewerPhotos : []}
    startIndex={0}
    onClose={() => {
      // Close only from the viewer (swipe-down or Esc)
      setViewerFile(null);
    }}
    onDeletePhoto={async (index, ref) => {
      // Keep your existing delete behavior; this is a safe default.
      // If you had custom logic before, paste it inside here.
      try {
        // Example: remove from local array and DB, then adjust UI if needed
        // await dbFiles.removeItem(ref.id);  // only if you previously removed blobs here
        // setViewerPhotos(prev => prev.filter((_, i) => i !== index));
      } catch (e) {
        console.error('Delete failed:', e);
      }
    }}
  />
)}

            {Confirm}
          </div>

<textarea
  ref={blurbRef}
  className="border rounded p-2 w-full text-xs select-text placeholder-gray-400 resize-none overflow-hidden"
  rows={2}
  value={selected.blurb || ''}
  onChange={(e)=>updateProfile(selected.id, {blurb:e.target.value})}
 onInput={(e) => {
  e.target.style.height = 'auto';
  e.target.style.height = String(e.target.scrollHeight) + 'px';
}}
  placeholder="Type blurb…"
/>


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

// Minimal cloud sync: initial fetch (MERGE, not overwrite)
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!sync?.room) return;
    const cloud = await fetchRoom(sync.room);
    if (!cloud || cancelled) return;

    // Normalize cloud profile
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
    if (!Array.isArray(prof?.profiles)) prof = prof ? { ...prof, profiles: [] } : { profiles: [] };

    // Normalize cloud prospects
    let list = Array.isArray(cloud.prospects) ? cloud.prospects : [];
    list = list.map(it =>
      !Array.isArray(it.photos)
        ? { ...it, photos: it.photo ? [it.photo] : [], photo: undefined, profileId: it.profileId || it.kidId }
        : it
    );

    // MERGE into local, do not overwrite
    setProfile(prev => mergeProfileTop(prev, prof || {}));
    setProspects(prev => mergeByIdUpdatedAt(prev, list));
  })();
  return () => { cancelled = true; };
}, [sync?.room]);

// Sync receive (subscribe) — MERGE incoming, don't overwrite
useEffect(() => {
  if (!sync?.room) return;
  const unsub = subscribeRoom(sync.room, async (payload) => {
    if (payload?.clientId === clientId) return;
    applyingRemoteRef.current = true;
    lastAppliedRef.current = Date.now();

    // Merge profile (top-level newest wins, inner .profiles by id/updatedAt)
    if (payload.profile) {
      setProfile(prev => mergeProfileTop(prev, payload.profile));
    }

    // Merge prospects by id/updatedAt
    if (Array.isArray(payload.prospects)) {
      setProspects(prev => mergeByIdUpdatedAt(prev, payload.prospects));
    }

    // Handle incoming files (unchanged)
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
      {/* Resumes tab */}
      <div className="relative">
               <button
          role="tab"
          aria-selected={tab==='prospects'}
          className={`px-3 py-2 rounded-t-xl border border-b-0 transition-all
            ${tab==='prospects'
              ? 'bg-amber-500 text-white border-amber-600 shadow-lg ring-1 ring-black/5 translate-y-[1px]'
              : 'bg-gray-50 text-gray-700 hover:shadow-sm'
            }`}
          onClick={()=>setTab('prospects')}
        >
          Resumes
        </button>
      </div>

      <div className="flex-1" />

      {/* My Profile tab */}
      <div className="relative">
               <button
          role="tab"
          aria-selected={tab==='profile'}
          className={`px-3 py-2 rounded-t-xl border border-b-0 transition-all
            ${tab==='profile'
              ? 'bg-amber-500 text-white border-amber-600 shadow-lg ring-1 ring-black/5 translate-y-[1px]'
              : 'bg-gray-50 text-gray-700 hover:shadow-sm'
            }`}
          onClick={()=>setTab('profile')}
        >
          My Profile
        </button>
      </div>
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