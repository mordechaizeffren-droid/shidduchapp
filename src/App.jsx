import React, { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { fetchRoom, saveRoom, subscribeRoom } from "./lib/sync";

// =============================================================================
// Shidduch Organizer — Single File App • v3.0 (with file sync)
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
// === Missing helpers (add these) ===
const fileToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    try {
      const r = new FileReader();
      r.onloadend = () => resolve((r.result || '').toString().split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    } catch (e) { reject(e); }
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

const attachFile = async (file) => {
  const id = uid();
  await dbFiles.setItem(id, file);
  return { id, name: file.name, type: file.type, size: file.size, addedAt: Date.now() };
};
const getBlobFromRef = async (ref) => (ref?.id ? dbFiles.getItem(ref.id) : null);
const deleteFileRef = async (ref) => { try { if (ref?.id) await dbFiles.removeItem(ref.id); } catch {} };
// ===== Download & Share =====
const downloadRef = async (ref) => {
  const blob = await getBlobFromRef(ref);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = ref.name || "download"; a.click();
  URL.revokeObjectURL(url);
};

const shareRef = async (ref, label = "file") => {
  try {
    const blob = await getBlobFromRef(ref);
    if (!blob) { alert("File not found in storage"); return; }
    const fileName = ref.name || "file";
    const mime = ref.type || "application/octet-stream";
    const file = new File([blob], fileName, { type: mime });
    const navAny = navigator;

    if (navAny.share && navAny.canShare && navAny.canShare({ files: [file] })) {
      try { await navAny.share({ files: [file], title: fileName }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }

    const url = URL.createObjectURL(blob);
    if (navAny.share) {
      try { await navAny.share({ url, title: fileName }); setTimeout(()=>URL.revokeObjectURL(url), 15000); return; } catch (_) {}
    }

    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) { await downloadRef(ref); setTimeout(()=>URL.revokeObjectURL(url), 0); }
    else { setTimeout(()=>URL.revokeObjectURL(url), 60000); }
  } catch (_) { try { await downloadRef(ref); } catch {} }
};

const shareText = async (text) => {
  const t = (text || "").trim(); if (!t) return;
  try {
    if (navigator.share) { await navigator.share({ text: t }); return; }
  } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(t); alert("Copied to clipboard"); } catch {}
};

const shareAll = async ({ resume, photos, text }) => {
  const files = [];
  try {
    if (resume?.id) {
      const b = await dbFiles.getItem(resume.id);
      if (b) files.push(new File([b], resume.name || "resume", { type: resume.type || b.type || "application/octet-stream" }));
    }
    for (const pr of ensureArray(photos)) {
      if (!pr?.id) continue;
      const b = await dbFiles.getItem(pr.id);
      if (b) files.push(new File([b], pr.name || "photo", { type: pr.type || b.type || "application/octet-stream" }));
    }
    const t = (text || "").trim();
    const navAny = navigator;

    if (navAny.share && (files.length || t)) {
      try {
        if (files.length && navAny.canShare && navAny.canShare({ files })) { await navAny.share({ files }); return; }
        if (t) { await navAny.share({ text: t }); return; }
      } catch (e) { if (e?.name === 'AbortError') return; }
    }
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) { const a = document.createElement("a"); a.href = url; a.download = f.name || "file"; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    if (t) { try { await navigator.clipboard.writeText(t); } catch {} }
  } catch { alert("Share failed. You can still Export from the settings menu."); }
};

// ===== Status tones =====
const statusTone = (s)=>({
  New:'bg-blue-100 text-blue-800 border-blue-200',
  Researching:'bg-amber-100 text-amber-800 border-amber-200',
  Dating:'bg-emerald-100 text-emerald-800 border-emerald-200',
  'On Hold':'bg-slate-100 text-slate-800 border-slate-200',
  Pass:'bg-rose-100 text-rose-800 border-rose-200',
  Reconsidering:'bg-violet-100 text-violet-800 border-violet-200'
}[s] || 'bg-gray-100 text-gray-800 border-gray-200');

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
          <button className="px-3 py-1 rounded border"
                  onClick={()=>{ state.resolve(false); setState({ open:false, resolve:null }); }}>Cancel</button>
          <button className="px-3 py-1 rounded border bg-rose-600 text-white"
                  onClick={()=>{ state.resolve(true); setState({ open:false, resolve:null }); }}>Delete</button>
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

// ===== File previews =====
function useFilePreview(fileRef){
  const [url,setUrl]=useState('');
  useEffect(()=>{
    let alive=true; let obj='';
    (async()=>{
      if(fileRef && fileRef.id){ const blob = await dbFiles.getItem(fileRef.id); if(!alive||!blob) { setUrl(''); return; } obj=URL.createObjectURL(blob); setUrl(obj); }
      else { setUrl(''); }
    })();
    return () => { alive = false; if (obj) setTimeout(() => URL.revokeObjectURL(obj), 0); };
  },[fileRef?.id]);
  return url;
}

function MiniPreview({ fileRef }) {
  const url = useFilePreview(fileRef);
  const type = (fileRef?.type || "").toLowerCase();
  const isImg = type.startsWith("image/");
  const isPdf = type === "application/pdf" || (fileRef?.name || "").toLowerCase().endsWith(".pdf");
  if (!fileRef) return null;

  return (
    <div className="w-full h-28 rounded-md bg-white border overflow-hidden">
      {isImg && url ? (
        <img src={url} alt={fileRef.name || "image"} className="w-full h-full object-contain" draggable={false} />
      ) : isPdf && url ? (
        <iframe src={`${url}#view=FitH&zoom=page-fit`} title="Preview" className="w-full h-full pointer-events-none" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">📄</div>
      )}
    </div>
  );
}

// ===== LongPress menu =====
function LongPressShare({ fileRef, onDelete, children, delay = 500 }) {
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, file: null });
  const tRef = useRef(null);
  const movedRef = useRef(false);

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
        <div className="fixed z-[5000] bg-white border rounded shadow text-sm" style={{ left: menu.x, top: menu.y }}>
          <button className="block w-full px-3 py-2 hover:bg-gray-100" onClick={() => { shareRef(menu.file); setMenu({ ...menu, open: false }); }}>Share</button>
          <button className="block w-full px-3 py-2 hover:bg-gray-100" onClick={() => { downloadRef(menu.file); setMenu({ ...menu, open: false }); }}>Save</button>
          {onDelete && (
            <button className="block w-full px-3 py-2 text-rose-600 hover:bg-rose-50" onClick={async () => { await onDelete(menu.file); setMenu({ ...menu, open: false }); }}>Delete</button>
          )}
          <button className="block w-full px-3 py-2 text-gray-500 hover:bg-gray-50" onClick={() => setMenu({ ...menu, open: false })}>Cancel</button>
        </div>
      )}
    </>
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

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pasteOn, setPasteOn] = useState(false);
  const pasteRef = useRef(null);
  const quickRef = useRef(null);
  const { ask: askConfirm, Confirm } = useConfirm();

  const [viewerFile, setViewerFile] = useState(null);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerProspectId, setViewerProspectId] = useState('');

  const [fullOpen, setFullOpen] = useState(false);
  const [fullId, setFullId] = useState('');
  const openFull = (id) => { setFullId(id); setFullOpen(true); };
  const closeFull = () => setFullOpen(false);
  const fullItem = fullOpen ? safe.find(x => x.id === fullId) || null : null;

  // Quick add
  const quickAddFromPickedFile = async (f) => {
    if (!profiles.length) { alert('Add a profile first'); return; }
    const ref = await attachFile(f); if (!ref) return;
    const base = (f.name||'').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
    const pid = activeProfileId || profiles[0].id;
    const p = { id: uid(), profileId: pid, fullName: base || '', status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photos:[], resume:null, updatedAt: Date.now() };
    if ((f.type||'').startsWith('image/')) p.photos = [ref]; else p.resume = ref;
    setProspects([...safe, p]);
  };

  useEffect(()=>{ const h=()=>quickRef.current?.click(); window.addEventListener('open-quick-add', h); return ()=>window.removeEventListener('open-quick-add', h); },[]);

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
  useEffect(()=>{ const h=()=>beginPasteFlow(); window.addEventListener('open-paste-add', h); return ()=>window.removeEventListener('open-paste-add', h); },[profiles,activeProfileId,prospects]);

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

      {/* search + filter + add */}
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

      {/* collapsed cards */}
      <div className="grid grid-cols-1 gap-2 w-full">
        {filtered.map(p => (
          <div
            key={p.id}
            className="relative border rounded bg-white shadow-sm p-2 overflow-visible cursor-pointer"
            onClick={()=>{ markSeen(p.id, p.updatedAt || Date.now()); openFull(p.id); }}
          >
            <div className="p-2 flex flex-wrap items-center gap-2">
              <button className="font-medium truncate text-left"
                      onClick={(e)=>{ e.stopPropagation(); markSeen(p.id, p.updatedAt||Date.now()); openFull(p.id); }}>
                {p.fullName ? p.fullName : <span className="text-gray-400">name...</span>}
              </button>

              {p.status ? (
                <span className={`px-2 py-0.5 rounded-full text-xs border ${statusTone(p.status)}`}>{p.status}</span>
              ) : null}
              {(p.sourceName||'').trim() ? (
                <span className="px-2 py-0.5 rounded-full text-xs border bg-gray-100 border-gray-200">{p.sourceName}</span>
              ) : null}
              {(p.city||'').trim() ? (
                <span className="px-2 py-0.5 rounded-full text-xs border bg-indigo-100 text-indigo-800 border-indigo-200">{p.city}</span>
              ) : null}

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

        <button type="button"
                onClick={addProspect}
                className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
          <div className="text-4xl leading-none text-gray-400">+</div>
          <div className="text-xs text-gray-500 mt-1">Add resume</div>
        </button>
      </div>

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
          }}
        />
      )}
      {Confirm}
    </div>
  );
}
/* ===== Full-screen editor ===== */
function FullProspectEditor({ prospect, allProfiles, onChange, onClose, onDelete }) {
  const p = prospect || {};
  const [viewerFile, setViewerFile] = useState(null);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const { ask: askConfirm, Confirm } = useConfirm();

  // swipe-down to close
  const [drag, setDrag] = useState({ active:false, startX:0, startY:0, dx:0, dy:0 });
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

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[3500] bg-white flex items-start justify-center"
      role="dialog"
      aria-label="Edit prospect"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="w-full max-w-3xl mx-auto">
        {/* header */}
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

        {/* body */}
        <div className="p-3 space-y-3">
          {/* status + city */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs mb-1">Status</div>
              <StatusPill value={p.status||'New'} onChange={(s)=>onChange({status:s})} />
            </div>
            <div>
              <div className="text-xs mb-1">City</div>
              <InlinePill label={p.city||''} placeholder="Enter city…" onEdit={(v)=>onChange({city:v})} full />
            </div>
          </div>

          {/* source + trust */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs mb-1">Suggested by</div>
              <InlinePill label={p.sourceName||''} placeholder="name..." onEdit={(v)=>onChange({sourceName:v})} full />
            </div>
            <div>
              <div className="text-xs mb-1">Known status</div>
              <TrustSelect value={p.sourceTrust||''} onChange={(v)=>onChange({sourceTrust:v})} />
            </div>
          </div>

          {/* resume */}
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
                  onClick={() => { setViewerFile(p.resume); setViewerPhotos([]); setViewerIndex(0); }}
                  title="Tap to view • long-press for menu"
                >
                  <div className="w-40"><MiniPreview fileRef={p.resume} /></div>
                </div>
              </LongPressShare>
            ) : (
              <button
                type="button"
                onClick={() => document.getElementById(`prospect-resume-${p.id}`)?.click()}
                className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center"
              >
                <div className="text-3xl text-gray-400">+</div>
                <div className="text-xs text-gray-500 mt-1">Add resume</div>
                <input
                  id={`prospect-resume-${p.id}`}
                  type="file"
                  accept="*/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) { const ref = await attachFile(f); onChange({ resume: ref }); }
                    e.target.value = "";
                  }}
                />
              </button>
            )}
          </div>

          {/* photos */}
          <div>
            <div className="text-xs mb-1">Photos</div>
            <div className="relative inline-block">
              {p.photos?.[0] ? (
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
                    onClick={() => { setViewerPhotos(p.photos||[]); setViewerIndex(0); setViewerFile(p.photos[0]); }}
                    title="Tap to preview • long-press for menu"
                  >
                    <MiniPreview fileRef={p.photos[0]} />
                  </div>
                </LongPressShare>
              ) : (
                <button
                  type="button"
                  onClick={() => document.getElementById(`prospect-photos-${p.id}`)?.click()}
                  className="h-28 w-40 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center"
                >
                  <div className="text-3xl text-gray-400">+</div>
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
                    onChange({ photos: [...(p.photos||[]), ...refs] });
                  }
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* notes */}
          <div className="mt-2">
            <div className="text-sm font-medium">Notes</div>
            <textarea
              className="border rounded p-2 w-full text-sm placeholder-gray-400"
              placeholder="Type notes…"
              rows={3}
              value={p.notes || ''}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </div>
        </div>

        {viewerFile && (
          <Viewer
            fileRef={viewerFile}
            photos={viewerPhotos}
            startIndex={viewerIndex}
            onClose={()=>{ setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); }}
          />
        )}
        {Confirm}
      </div>
    </div>
  );
}

/* ===== Inline editors & selects ===== */
function StatusPill({ value, onChange }) {
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
  useEffect(()=>setVal(label||''),[label]);
  const commit=()=>{ onEdit((val||'').trim()); setEditing(false); };
  return editing? (
    <input className={`border rounded-full px-3 py-1 text-sm ${full?'w-full':''}`} autoFocus value={val} onChange={e=>setVal(e.target.value)} placeholder={placeholder} onKeyDown={e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') setEditing(false); }} onBlur={commit}/>
  ) : (
    <span className={`px-3 py-2 rounded-full text-sm border ${label?'bg-gray-100':'bg-white text-gray-400'} ${full?'w-full text-left inline-block':''}`} onClick={()=>setEditing(true)}>{label||placeholder}</span>
  );
}

function TrustSelect({ value, onChange }){
  return (
    <select className="border rounded-full px-3 py-2 text-sm w-full" value={value || ''} onChange={(e)=>onChange(e.target.value)}>
      <option value="" disabled>Select</option>
      {TRUST.map(s => (<option key={s} value={s}>{s}</option>))}
    </select>
  );
}

function EditableText({ value, onChange, className, inputClass, placeholder="name..." }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(value);
  useEffect(()=>setVal(value),[value]);
  return editing? (
    <input className={inputClass} value={val} autoFocus onChange={e=>setVal(e.target.value)} placeholder={placeholder} onKeyDown={e=>{ if(e.key==='Enter'){ onChange((val||'').trim()); setEditing(false);} if(e.key==='Escape'){ setEditing(false);} }} onBlur={()=>{ onChange((val||'').trim()); setEditing(false);} } />
  ) : (
    <button className={className} onClick={()=>setEditing(true)}>{value||<span className="text-gray-400">{placeholder}</span>}</button>
  );
}
/* ===== MyProfile ===== */
function MyProfile({ profile, saveProfile }){
  const profiles = ensureArray(profile?.profiles);
  const [viewerFile, setViewerFile] = useState(null);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [selId,setSelId]=useState(profiles[0]?.id||'');

  useEffect(()=>{ if(!selId && profiles[0]?.id) setSelId(profiles[0].id); },[profile?.profiles]);

  const addProfile=()=>{
    const newP={ id:uid(), name:'', photos:[], resume:null, blurb:'', updatedAt:Date.now() };
    const next=[...profiles,newP];
    saveProfile({ ...(profile||{}), profiles:next, updatedAt:Date.now() });
    setSelId(newP.id);
  };
  const updateProfile=(id,patch)=>{
    const next=profiles.map(k=> k.id===id?{...k,...patch,updatedAt:Date.now()}:k);
    saveProfile({ ...(profile||{}), profiles:next, updatedAt:Date.now() });
  };

  const selected=profiles.find(k=>k.id===selId);
  const { ask: askConfirm, Confirm } = useConfirm();

  return (
    <div className="space-y-4">
      {/* profile pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {profiles.map(k=> (
          <button key={k.id}
                  className={`px-3 py-1 rounded-full border ${selId===k.id?'bg-black text-white':'bg-white'}`}
                  onClick={()=>setSelId(k.id)}>
            {k.name||<span className="text-gray-400">name...</span>}
          </button>
        ))}
        <button className="px-3 py-1 rounded-full border" onClick={addProfile}>+</button>
      </div>

      {selected ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {/* resume */}
            <div>
              <div className="text-xs mb-1">Resume</div>
              {selected.resume ? (
                <LongPressShare
                  fileRef={selected.resume}
                  onDelete={async()=>{ const ok=await askConfirm(); if(!ok)return; await deleteFileRef(selected.resume); updateProfile(selected.id,{resume:null}); }}
                >
                  <div className="group cursor-pointer inline-block"
                       onClick={()=>{ setViewerFile(selected.resume); setViewerPhotos([]); setViewerIndex(0); }}>
                    <div className="w-40"><MiniPreview fileRef={selected.resume} /></div>
                  </div>
                </LongPressShare>
              ) : (
                <button type="button"
                        onClick={()=>document.getElementById(`profile-resume-${selected.id}`)?.click()}
                        className="h-28 w-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center">
                  <div className="text-3xl text-gray-400">+</div>
                  <div className="text-xs text-gray-500 mt-1">Add resume</div>
                  <input id={`profile-resume-${selected.id}`} type="file" accept="*/*" className="hidden"
                         onChange={async(e)=>{ const f=e.target.files?.[0]; if(f){ const ref=await attachFile(f); updateProfile(selected.id,{resume:ref}); } e.target.value=''; }} />
                </button>
              )}
            </div>

            {/* photos */}
            <div>
              <div className="text-xs mb-1">Photos</div>
              {selected.photos?.[0] ? (
                <LongPressShare
                  fileRef={selected.photos[0]}
                  onDelete={async()=>{ const ok=await askConfirm(); if(!ok)return;
                    const next=(selected.photos||[]).slice(1);
                    await deleteFileRef(selected.photos[0]);
                    updateProfile(selected.id,{photos:next}); }}
                >
                  <div className="w-40 h-28 border rounded-md overflow-hidden cursor-pointer"
                       onClick={()=>{ setViewerPhotos(selected.photos||[]); setViewerIndex(0); setViewerFile(selected.photos[0]); }}>
                    <MiniPreview fileRef={selected.photos[0]} />
                  </div>
                </LongPressShare>
              ) : (
                <button type="button"
                        onClick={()=>document.getElementById(`profile-photos-${selected.id}`)?.click()}
                        className="h-28 w-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center">
                  <div className="text-3xl text-gray-400">+</div>
                  <div className="text-xs text-gray-500 mt-1">Add photos</div>
                  <input id={`profile-photos-${selected.id}`} type="file" accept="image/*" multiple className="hidden"
                         onChange={async(e)=>{ const fs=Array.from(e.target.files||[]); if(fs.length){ const refs=[]; for(const f of fs) refs.push(await attachFile(f)); updateProfile(selected.id,{photos:[...(selected.photos||[]),...refs]}); } e.target.value=''; }} />
                </button>
              )}
            </div>
          </div>

          {/* blurb */}
          <div className="mt-2 max-w-xl">
            <div className="text-xs">Blurb</div>
            <textarea className="border rounded p-2 w-full text-xs placeholder-gray-400"
                      rows={2}
                      value={selected.blurb||''}
                      onChange={e=>updateProfile(selected.id,{blurb:e.target.value})}
                      placeholder="Type blurb…" />
          </div>

          {/* viewer */}
          {viewerFile && (
            <Viewer
              fileRef={viewerFile}
              photos={viewerPhotos}
              startIndex={viewerIndex}
              onClose={()=>{ setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); }}
              onDeletePhoto={async(i,ref)=>{ const ok=await askConfirm(); if(!ok)return;
                try{ if(ref) await deleteFileRef(ref);}catch{}
                const cur=ensureArray(selected.photos);
                const next=cur.filter((_,idx)=>idx!==i);
                updateProfile(selected.id,{photos:next});
                setViewerPhotos(next);
                if(next.length===0){ setViewerFile(null);} else {
                  const newIndex=Math.min(i,next.length-1);
                  setViewerIndex(newIndex); setViewerFile(next[newIndex]);
                } }}
            />
          )}
          {Confirm}
        </>
      ) : (
        <div className="text-xs text-gray-500">Add a profile to attach a resume or photos.</div>
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

  // unseen map
  const [unseenMap, setUnseenMap] = useState({});
  const saveSeenMap = async (map) => { setUnseenMap(map); try{ await dbProfile.setItem('seenProspects', map); }catch{} };

  // load saved sync
  useEffect(()=>{ (async()=>{
    try { const saved=await dbProfile.getItem('sync'); if(saved) setSync(saved); } catch {}
  })();},[]);

  // load & migrate
  useEffect(()=>{ (async()=>{
    let p = await dbProfile.getItem('me');
    const seen = await dbProfile.getItem('seenProspects'); setUnseenMap(seen||{});
    if(!p){ p={profiles:[],updatedAt:Date.now()}; await dbProfile.setItem('me',p); }
    setProfile(p);
    const arr=[]; await dbProspects.iterate((v)=>arr.push(v));
    setProspects(ensureArray(arr));
  })();},[]);

  useEffect(()=>{
    const profiles=ensureArray(profile?.profiles);
    if(activeProfileId && !profiles.some(k=>k.id===activeProfileId)) setActiveProfileId(profiles[0]?.id||'');
  },[profile,activeProfileId]);

  // save helpers
  const saveProfile=async(p)=>{ setProfile(p); await dbProfile.setItem('me',p); };
  const saveProspects=async(list)=>{ setProspects(list); await Promise.all(list.map(it=>dbProspects.setItem(it.id,it))); };

  // sync receive
  useEffect(()=>{
    if(!sync?.room) return;
    const unsub=subscribeRoom(sync.room, async(payload)=>{
      if(payload?.clientId===clientId) return;
      applyingRemoteRef.current=true; lastAppliedRef.current=Date.now();

      if(payload.profile) setProfile(payload.profile);
      if(Array.isArray(payload.prospects)) setProspects(payload.prospects);

      // handle incoming files
      if(Array.isArray(payload.files)){
        for(const f of payload.files){
          try{
            const blob=base64ToBlob(f.base64,f.type||'application/octet-stream');
            await dbFiles.setItem(f.id,blob);
          }catch{}
        }
      }
      applyingRemoteRef.current=false;
    });
    return()=>{ try{unsub?.();}catch{} };
  },[sync?.room]);

  // sync send
  useEffect(()=>{
    if(!sync?.room) return;
    if(lastAppliedRef.current && Date.now()-lastAppliedRef.current<800) return;
    if(applyingRemoteRef.current){ applyingRemoteRef.current=false; return; }

    const send=async()=>{
      const ids=new Map();
      const add=(r)=>{ if(r?.id) ids.set(r.id,r); };

      add(profile?.resume);
      ensureArray(profile?.photos).forEach(add);
      ensureArray(profile?.profiles).forEach(k=>{ add(k.resume); ensureArray(k.photos).forEach(add); });
      ensureArray(prospects).forEach(p=>{ add(p.resume); ensureArray(p.photos).forEach(add); });

      const files=[];
      for(const ref of ids.values()){
        const blob=await dbFiles.getItem(ref.id); if(!blob) continue;
        const b64=await fileToBase64(blob);
        files.push({...ref,base64:b64});
      }
      await saveRoom(sync.room,{profile,prospects,files,clientId}).catch(()=>{});
    };
    const t=setTimeout(send,400);
    return()=>clearTimeout(t);
  },[profile,prospects,sync?.room]);

  // export/import
  const importRef=useRef(null);
  const exportAll=async()=>{
    const ids=new Map();
    const add=(r)=>{ if(r?.id) ids.set(r.id,r); };
    add(profile?.resume); ensureArray(profile?.photos).forEach(add);
    ensureArray(profile?.profiles).forEach(k=>{ add(k.resume); ensureArray(k.photos).forEach(add); });
    ensureArray(prospects).forEach(p=>{ add(p.resume); ensureArray(p.photos).forEach(add); });

    const files=[];
    for(const ref of ids.values()){
      const blob=await dbFiles.getItem(ref.id); if(!blob) continue;
      const b64=await fileToBase64(blob);
      files.push({...ref,base64:b64});
    }
    const payload={version:3,profile,prospects,files};
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='backup.json'; a.click();
  };
  const importAll=async(file)=>{
    try{
      const text=await file.text(); const data=JSON.parse(text);
      if(data.profile) setProfile(data.profile);
      if(Array.isArray(data.prospects)) setProspects(data.prospects);
      if(Array.isArray(data.files)){
        for(const f of data.files){
          try{ const blob=base64ToBlob(f.base64,f.type||'application/octet-stream'); await dbFiles.setItem(f.id,blob); }catch{}
        }
      }
    }catch{ alert('Import failed'); }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto text-sm">
      <div className="text-xs text-gray-500 mb-1">Shidduch Organizer • v3.0 (with file sync)</div>

      {/* tabs */}
      <div className="mb-4 flex gap-2">
        <button className={`px-3 py-2 rounded-t ${tab==='prospects'?'bg-white border-b-0':'bg-gray-100'}`} onClick={()=>setTab('prospects')}>Resumes</button>
        <button className={`px-3 py-2 rounded-t ${tab==='profile'?'bg-white border-b-0':'bg-gray-100'}`} onClick={()=>setTab('profile')}>My Profile</button>
      </div>

      {/* settings */}
      <div className="mb-4">
        <SettingsFab onExport={exportAll} onImport={()=>importRef.current?.click()} onOpenSync={()=>setSyncOpen(true)} />
        <input ref={importRef} type="file" accept="application/json" className="hidden"
               onChange={e=>{ const f=e.target.files?.[0]; if(f) importAll(f); }} />
      </div>

      <SyncPanel open={syncOpen} initial={sync}
                 onSave={async(s)=>{ setSync(s); await dbProfile.setItem('sync',s); }}
                 onClear={async()=>{ setSync({config:'',room:''}); await dbProfile.removeItem('sync'); }}
                 onClose={()=>setSyncOpen(false)} />

      {tab==='prospects'
        ? <Prospects profile={profile} saveProfile={saveProfile}
                     prospects={prospects} setProspects={saveProspects}
                     activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId}
                     unseenMap={unseenMap} markSeen={async(id,ts)=>saveSeenMap({...unseenMap,[id]:ts})} />
        : <MyProfile profile={profile} saveProfile={saveProfile} />}
    </div>
  );
}
