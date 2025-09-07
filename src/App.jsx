import React, { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { fetchRoom, saveRoom, subscribeRoom } from "./lib/sync";

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

// ===== File helpers =====
const attachFile = async (file) => {
  const id = uid();
  await dbFiles.setItem(id, file);
  return { id, name: file.name, type: file.type, size: file.size, addedAt: Date.now() };
};

const getBlobFromRef = async (ref) => (ref?.id ? dbFiles.getItem(ref.id) : null);

const deleteFileRef = async (ref) => {
  try { if (ref?.id) await dbFiles.removeItem(ref.id); } catch {}
};

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

// Share all: resume + photos[] + text (notes/blurb), no name
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
      } catch (e) { if (e?.name === "AbortError") return; }
    }
    // Fallbacks
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) { const a = document.createElement("a"); a.href = url; a.download = f.name || "file"; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    if (t) { try { await navigator.clipboard.writeText(t); } catch {} }
  } catch { alert("Share failed. You can still Export from the settings menu."); }
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
    <div className="fixed inset-0 z-[2000] bg-black/40 flex items-center justify-center" onClick={() => { state.resolve(false); setState({ open: false, resolve: null }); }}>
      <div className="bg-white rounded-lg shadow p-4 w-[18rem]" onClick={(e)=>e.stopPropagation()}>
        <div className="text-sm">Are you sure?</div>
        <div className="mt-3 flex justify-end gap-2">
          <button className="px-3 py-1 rounded border" onClick={()=>{ state.resolve(false); setState({ open:false, resolve:null }); }}>Cancel</button>
          <button className="px-3 py-1 rounded border bg-rose-600 text-white" onClick={()=>{ state.resolve(true); setState({ open:false, resolve:null }); }}>Delete</button>
        </div>
      </div>
    </div>
  ) : null;
  // ESC support
  useEffect(()=>{
    const onKey=(e)=>{ if(!state.open) return; if(e.key==='Escape'){ state.resolve(false); setState({open:false, resolve:null}); } };
    window.addEventListener('keydown', onKey); return ()=>window.removeEventListener('keydown', onKey);
  },[state]);
  return { ask, Confirm };
}

// ===== Upload previews & viewer =====
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
        <img src={url} alt={fileRef.name || "image"} className="w-full h-full object-contain" />
      ) : isPdf && url ? (
        <iframe
          src={`${url}#view=FitH&zoom=page-fit`}
          title="Preview"
          className="w-full h-full"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">📄</div>
      )}
    </div>
  );
}

function Viewer({ fileRef, startIndex=0, photos=[], onClose }) {
  const url = useFilePreview(fileRef);
  const isImg = (fileRef?.type || "").startsWith("image/");
  const [drag, setDrag] = useState({ active:false, startY:0, dy:0 });

  // ESC to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // swipe down to dismiss (images)
  const onTouchStart = (e) => { setDrag({ active:true, startY:e.touches[0].clientY, dy:0 }); };
  const onTouchMove = (e) => { if(!drag.active) return; const dy = e.touches[0].clientY - drag.startY; setDrag((d)=>({ ...d, dy })); };
  const onTouchEnd = () => {
    if (!drag.active) return;
    if (drag.dy > 60) onClose();
    setDrag({ active:false, startY:0, dy:0 });
  };

  // gallery navigation for photos (swipe left/right in viewer)
  const [idx, setIdx] = useState(startIndex);
  useEffect(()=>setIdx(startIndex),[startIndex, fileRef?.id]);

  const canLeft = isImg && photos.length > 1;
  const goLeft = () => { if (!canLeft) return; setIdx((i)=> (i-1+photos.length)%photos.length); };
  const goRight = () => { if (!canLeft) return; setIdx((i)=> (i+1)%photos.length); };

  useEffect(()=>{ if(!isImg || photos.length<2) return;
    const onKey=(e)=>{ if(e.key==='ArrowLeft') goLeft(); if(e.key==='ArrowRight') goRight(); };
    window.addEventListener('keydown', onKey); return ()=>window.removeEventListener('keydown', onKey);
  },[isImg, photos.length]);

  const currentRef = isImg && photos.length ? photos[idx] : fileRef;
  const currentUrl = useFilePreview(currentRef);
  const currentIsImg = (currentRef?.type || "").startsWith("image/");
  const currentIsPdf = (currentRef?.type || "").toLowerCase() === "application/pdf" || (currentRef?.name || "").toLowerCase().endsWith(".pdf");

  return (
    <div
      className="fixed inset-0 z-[3000] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Viewer"
    >
      <div
        className="max-w-[1000px] w-full max-h-[95vh] bg-white rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: drag.active ? `translateY(${Math.max(0, drag.dy)}px)` : undefined, transition: drag.active ? 'none' : 'transform 160ms ease-out' }}
      >
        {/* Grab handle for PDFs (iframe eats touches) */}
        <div className="h-5 flex items-center justify-center bg-gray-50">
          <div className="w-12 h-1.5 rounded-full bg-gray-300" />
        </div>

        <div className="relative">
          {currentUrl ? (
            currentIsImg ? (
              <img src={currentUrl} alt={currentRef?.name || 'image'} className="w-full h-[85vh] object-contain select-none" draggable={false} />
            ) : currentIsPdf ? (
              <iframe key={currentRef?.id || currentUrl} src={`${currentUrl}#view=FitH&zoom=page-fit`} title="Preview" className="w-full h-[85vh]" />
            ) : (
              <div className="p-6 text-center text-sm text-gray-500">No inline preview available.</div>
            )
          ) : (
            <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
          )}

          {/* Open in new tab fallback */}
          {currentUrl && (
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-3 right-3 text-xs px-2 py-1 rounded border bg-white/90 hover:bg-white"
              onClick={(e)=>e.stopPropagation()}
            >
              Open in new tab
            </a>
          )}

          {/* Left/right controls for multi-photos */}
          {isImg && photos.length > 1 && (
            <>
              <button className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full w-8 h-8 flex items-center justify-center"
                onClick={goLeft} aria-label="Previous photo">‹</button>
              <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full w-8 h-8 flex items-center justify-center"
                onClick={goRight} aria-label="Next photo">›</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function PillMenu({ label, options, onPick, strong }){
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);
  useEffect(()=>{ if(!open) return; const onDoc=(ev)=>{ if(wrapRef.current && !wrapRef.current.contains(ev.target)) setOpen(false); }; document.addEventListener('click', onDoc); return ()=> document.removeEventListener('click', onDoc); },[open]);
  const toggle=(e)=>{ e.stopPropagation(); const MENU_W=176; if (wrapRef.current){ const r=wrapRef.current.getBoundingClientRect(); setAlignRight(r.left + MENU_W > window.innerWidth);} setOpen(o=>!o); };
  const choose=(s)=>{ onPick(s); setOpen(false); };
  return (
    <div ref={wrapRef} className="relative inline-block">
      <button type="button" aria-expanded={open} className={`px-3 py-1 rounded-full text-sm font-medium border ${strong?'':'bg-white'}`} onClick={toggle}>
        <span className="inline-block w-4 h-3 align-middle mr-1">
          <span className="block w-4 h-0.5 bg-gray-400 rounded mb-0.5"></span>
          <span className="block w-4 h-0.5 bg-gray-400 rounded mb-0.5"></span>
          <span className="block w-4 h-0.5 bg-gray-400 rounded"></span>
        </span>
        {label || 'Select'}
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-44 rounded border bg-white shadow ${alignRight ? 'right-0' : 'left-0'}`}>
          {(options||[]).map((s)=> (
            <button key={s} type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={(e)=>{ e.stopPropagation(); choose(s); }}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddDropdown({ disabled=false }){
  const [open,setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);
  useEffect(()=>{ if(!open) return; const onDoc = (e)=>{ if(wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }; document.addEventListener('click', onDoc); return ()=> document.removeEventListener('click', onDoc); },[open]);
  const toggle = ()=>{ if(disabled) return; const MENU_W=176; if(wrapRef.current){ const r=wrapRef.current.getBoundingClientRect(); setAlignRight(r.left + MENU_W > window.innerWidth);} setOpen(o=>!o); };
  const triggerFiles = ()=>{ if(disabled) { alert("Add a profile first."); return; } window.dispatchEvent(new Event('open-quick-add')); setOpen(false); };
  const triggerPaste = ()=>{ if(disabled) { alert("Add a profile first."); return; } window.dispatchEvent(new Event('open-paste-add')); setOpen(false); };
  return (
    <div ref={wrapRef} className="relative inline-block">
      <button type="button" aria-label="Add" title="Add" className={`px-2 py-1 rounded border flex items-center gap-1 ${disabled ? 'opacity-40' : ''}`} onClick={toggle}>
        <IconDownload/>
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-44 rounded border bg-white shadow ${alignRight ? 'right-0' : 'left-0'}`}>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={triggerFiles}><IconDownload/><span>From files</span></button>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={triggerPaste}><span className="text-lg leading-none">📋</span><span>Paste</span></button>
        </div>
      )}
    </div>
  );
}

function SettingsFab({ onExport, onImport, onOpenSync }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(()=>{ if(!open) return; const onDoc=(e)=>{ if(wrap.current && !wrap.current.contains(e.target)) setOpen(false); }; document.addEventListener('click', onDoc); return ()=> document.removeEventListener('click', onDoc); },[open]);
  return (
    <div ref={wrap} className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-2 w-48 rounded border bg-white shadow">
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => { onExport(); setOpen(false); }}>Export</button>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => { onImport(); setOpen(false); }}>Import</button>
          <div className="my-1 border-t" />
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => { onOpenSync?.(); setOpen(false); }}>Sync settings…</button>
        </div>
      )}
      <button type="button" aria-label="Settings" className="w-11 h-11 rounded-full border border-gray-200 bg-white shadow-sm flex items-center justify-center" onClick={() => setOpen(o => !o)}>
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
function Prospects({ prospects, setProspects, profile, saveProfile, activeProfileId, setActiveProfileId, unseenMap, markSeen }){
  const profiles=ensureArray(profile?.profiles);
  const safe=ensureArray(prospects);
  const [q,setQ]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [expanded,setExpanded]=useState({});
  const [pasteOn,setPasteOn]=useState(false);
  const pasteRef = useRef(null);
  const [viewerFile, setViewerFile] = useState(null);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const { ask: askConfirm, Confirm } = useConfirm();

  // first-use tip (once)
  const [showTip, setShowTip] = useState(false);
  useEffect(()=>{
    const ok = localStorage.getItem("tip-expand-shown");
    if (!ok && safe.length > 0 && !Object.values(expanded).some(Boolean)) {
      setShowTip(true);
      const t = setTimeout(()=> setShowTip(false), 9000);
      return ()=> clearTimeout(t);
    }
  }, [safe.length]);

  // Clipboard API path (paste image/pdf)
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

  // Quick Add from file picker
  const quickRef = useRef(null);
  const quickAddFromPickedFile = async (f) => {
    if (!profiles.length) { alert('Add a profile first'); return; }
    const ref = await attachFile(f); if (!ref) return;
    const base = (f.name||'').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
    const name = base || '';
    const pid = activeProfileId || profiles[0].id;
    const p = { id: uid(), profileId: pid, fullName: name, status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photos:[], resume:null, updatedAt: Date.now() };
    // Heuristic: images → photos; everything else → resume (override by tile drop elsewhere)
    if ((f.type||'').startsWith('image/')) p.photos = [ref]; else p.resume = ref;
    setProspects([...safe, p]);
    if (!localStorage.getItem("tip-expand-shown")) setShowTip(true);
  };
  useEffect(()=>{ const h=()=>quickRef.current?.click(); window.addEventListener('open-quick-add', h); return ()=>window.removeEventListener('open-quick-add', h); },[]);

  const toggleOpen=(id)=>{
    setExpanded(s=>({ ...s, [id]: !s[id] }));
    if (!expanded[id]) {
      const p = safe.find(x=>x.id===id);
      if (p) markSeen(p.id, p.updatedAt || Date.now());
      if (showTip) { localStorage.setItem('tip-expand-shown','1'); setShowTip(false); }
    }
  };
  const addProfile=()=>{ const k={id:uid(), name:'', photos:[], resume:null, blurb:'', updatedAt:Date.now()}; saveProfile({ ...(profile||{}), profiles:[...profiles, k], updatedAt:Date.now() }); setActiveProfileId(k.id); };
  const addProspect=()=>{ if(!profiles.length){ alert('Add a profile first'); return; } const p={ id:uid(), profileId:activeProfileId||profiles[0].id, fullName:'', status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photos:[], resume:null, updatedAt:Date.now() }; setProspects([...safe,p]); };
  const updateP=(id,patch)=> setProspects(safe.map(x=> x.id===id?{...x,...patch, updatedAt:Date.now()}:x));
  const removeP=async(id)=>{
    const ok = await askConfirm(); if (!ok) return;
    const p = safe.find(x=>x.id===id);
    try {
      if (p?.resume) await deleteFileRef(p.resume);
      for (const ph of ensureArray(p?.photos)) await deleteFileRef(ph);
    } catch {}
    setProspects(safe.filter(x=>x.id!==id));
  };
  const onDropFiles=async(pid, files, into='auto')=>{
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
    .filter(p=>{ const t=q.trim().toLowerCase(); if(!t) return true; return ((p.fullName||'').toLowerCase().includes(t) || (p.city||'').toLowerCase().includes(t) || (p.sourceName||'').toLowerCase().includes(t) || (p.notes||'').toLowerCase().includes(t)); });

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
          <button key={k.id} className={`px-3 py-1 rounded-full border ${activeProfileId===k.id?'bg-black text-white':'bg-white'}`} onClick={()=>setActiveProfileId(k.id)}>
            {k.name ? k.name : <span className="text-gray-400">name...</span>}
          </button>
        ))}
        <button className="px-3 py-1 rounded-full border" onClick={addProfile} aria-label="Add profile">+</button>
      </div>

      {/* search + filter */}
      <div className="flex items-center gap-2">
        <input className="border rounded px-2 py-1 text-sm flex-1 select-text" placeholder="Search name, city, notes..." value={q} onChange={e=>setQ(e.target.value)} />
        {pasteOn && (<input ref={pasteRef} onPaste={handlePaste} className="border rounded px-2 py-1 text-sm select-text" placeholder="Paste here…" aria-label="Paste here" />)}
        <PillMenu label={statusFilter||'All'} options={['All',...STATUS]} onPick={(s)=>setStatusFilter(s==='All'?'':s)} />
        <input ref={quickRef} type="file" accept="*/*" multiple className="hidden" onChange={e=>{
          const fileList = e.target.files; if(fileList?.length){ for(const f of Array.from(fileList)) quickAddFromPickedFile(f); }
          e.target.value=''; }} />
        <AddDropdown disabled={!profiles.length} />
      </div>

      {/* tip */}
      {showTip && (
        <div className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-flex items-center gap-2">
          Tap the tab to expand
          <button className="text-gray-500" onClick={()=>{ localStorage.setItem('tip-expand-shown','1'); setShowTip(false); }}>×</button>
        </div>
      )}

      {/* cards */}
      <div className="grid grid-cols-1 gap-2 w-full">
        {filtered.map(p=> {
          const isOpen = !!expanded[p.id];
          return (
            <div
              key={p.id}
              className={`relative border rounded bg-white shadow-sm p-2 overflow-visible`}
              onDragOver={(e)=>e.preventDefault()}
            >
              {/* header */}
              <div className="p-2 flex items-center gap-2">
                {/* unread green dot */}
                {(p.updatedAt || 0) > (unseenMap[p.id] || 0) ? <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" title="New/updated" /> : <span className="w-2 h-2" />}
                {/* editable name */}
                <EditableText
                  value={p.fullName || ''}
                  placeholder="name..."
                  onChange={(v)=>updateP(p.id,{fullName:v})}
                  className="font-medium truncate flex-1 text-left"
                  inputClass="font-medium truncate flex-1 border rounded px-2 py-1 select-text"
                />
                {/* delete */}
                <button
                  type="button"
                  aria-label="Delete"
                  title="Delete"
                  className="w-7 h-7 rounded-full border border-rose-300 text-rose-700 flex items-center justify-center hover:bg-rose-50"
                  onClick={()=>removeP(p.id)}
                >
                  ×
                </button>
              </div>

              {/* collapsed pills: Status → Suggested by → City */}
              <div className="px-2 -mt-2 flex flex-wrap gap-2">
                {p.status ? <DisplayPill tone={statusTone(p.status)}>{p.status}</DisplayPill> : null}
                {(p.sourceName||'').trim() ? <DisplayPill>{p.sourceName}</DisplayPill> : null}
                {(p.city||'').trim() ? <DisplayPill>{p.city}</DisplayPill> : null}
              </div>

              {/* details (animated) */}
              <div
                className={`transition-[max-height,opacity,transform] duration-200 ease-out overflow-hidden ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-0.5'}`}
                style={{ maxHeight: isOpen ? 2000 : 0 }}
                onTransitionEnd={()=>{ if (isOpen) markSeen(p.id, p.updatedAt || Date.now()); }}
              >
                <div className="p-2 pt-1">
                  <div className="mt-1 grid grid-cols-2 gap-2 items-start">
                    <div>
                      <div className="text-xs mb-1">Status</div>
                      <StatusPill value={p.status||'New'} onChange={(s)=>updateP(p.id,{status:s})} />
                    </div>
                    <div>
                      <div className="text-xs mb-1">City</div>
                      <InlinePill label={p.city||''} placeholder="..." onEdit={(v)=>updateP(p.id,{city:v})} full />
                    </div>
                  </div>

                  <div className="mt-2 border rounded p-3 grid grid-cols-2 gap-3 items-start">
                    <div>
                      <div className="text-xs mb-1">Suggested by</div>
                      <InlinePill label={p.sourceName||''} placeholder="name..." onEdit={(v)=>updateP(p.id,{sourceName:v})} full />
                    </div>
                    <div>
                      <div className="text-xs mb-1">known status</div>
                      <TrustSelect value={p.sourceTrust||''} onChange={(v)=>updateP(p.id,{sourceTrust:v})} />
                    </div>
                  </div>

                  {/* two columns: resume & photos */}
                  <div className="mt-2 grid grid-cols-2 gap-2 w-full">
                    {/* Resume */}
                    <div
                      onDrop={async(e)=>{ e.preventDefault(); await onDropFiles(p.id, e.dataTransfer?.files||null, 'resume'); }}
                      onDragOver={(e)=>e.preventDefault()}
                    >
                      <div className="text-xs mb-1">Resume</div>
                      {p.resume ? (
                        <div className="group cursor-pointer" onClick={()=>{ setViewerFile(p.resume); setViewerPhotos([]); setViewerIndex(0); }}>
                          <MiniPreview fileRef={p.resume} />
                          <div className="flex items-center gap-2 mt-2">
                            <IconBtn ariaLabel="Share" label="Share" onClick={(e)=>{ e.stopPropagation(); shareRef(p.resume,'resume'); }} className="border-blue-300 text-blue-700 hover:bg-blue-50"><IconShare/></IconBtn>
                            <IconBtn ariaLabel="Download" label="Download" onClick={(e)=>{ e.stopPropagation(); downloadRef(p.resume); }} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"><IconDownload/></IconBtn>
                            <IconBtn ariaLabel="Delete" label="Delete" onClick={async(e)=>{ e.stopPropagation(); const ok=await askConfirm(); if(!ok) return; if (p.resume) await deleteFileRef(p.resume); updateP(p.id,{resume:null}); }} className="border-rose-300 text-rose-700 hover:bg-rose-50"><IconX/></IconBtn>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={()=>document.getElementById(`file-resume-${p.id}`)?.click()}
                          className="h-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 w-full flex flex-col items-center justify-center"
                        >
                          <div className="text-3xl leading-none text-gray-400">+</div>
                          <div className="text-xs text-gray-500 mt-1">Add resume</div>
                          <input id={`file-resume-${p.id}`} type="file" accept="*/*" className="hidden" onChange={async(e)=>{ const f=e.target.files?.[0]; if(f){ const ref=await attachFile(f); updateP(p.id,{resume:ref}); } e.target.value=""; }} />
                        </button>
                      )}
                    </div>

                    {/* Photos */}
                    <div
                      onDrop={async(e)=>{ e.preventDefault(); const files = Array.from(e.dataTransfer?.files||[]).filter(f=> (f.type||'').startsWith('image/')); if(files.length){ for(const f of files){ const ref=await attachFile(f); updateP(p.id,{photos:[...(p.photos||[]), ref]}); }} }}
                      onDragOver={(e)=>e.preventDefault()}
                    >
                      <div className="text-xs mb-1">Photos</div>
                      <div className="flex items-center gap-2">
                        {ensureArray(p.photos).length ? (
                          <div className="relative cursor-pointer" onClick={()=>{ setViewerPhotos(p.photos||[]); setViewerIndex(0); setViewerFile(p.photos?.[0]); }}>
                            <div className="w-40 h-28 rounded-md bg-white border overflow-hidden">
                              <MiniPreview fileRef={p.photos[0]} />
                            </div>
                            {p.photos.length > 1 && (
                              <div className="absolute -right-2 top-2 w-20 h-14 border rounded-md overflow-hidden bg-white shadow-sm">
                                <MiniPreview fileRef={p.photos[1]} />
                              </div>
                            )}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          onClick={()=>document.getElementById(`file-photos-${p.id}`)?.click()}
                          className="h-28 w-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center"
                          title="Add photos"
                        >
                          <div className="text-3xl leading-none text-gray-400">+</div>
                          <div className="text-[11px] text-gray-500 mt-1">Add photos</div>
                          <input id={`file-photos-${p.id}`} type="file" accept="image/*" multiple className="hidden" onChange={async(e)=>{ const fs=Array.from(e.target.files||[]); if(fs.length){ const refs=[]; for(const f of fs){ refs.push(await attachFile(f)); } updateP(p.id,{photos:[...(p.photos||[]), ...refs]}); } e.target.value=""; }} />
                        </button>
                      </div>

                      {ensureArray(p.photos).length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {p.photos.map((ph, i)=>(
                            <div key={ph.id} className="relative">
                              <div className="w-24 h-16 border rounded overflow-hidden cursor-pointer" onClick={()=>{ setViewerPhotos(p.photos||[]); setViewerIndex(i); setViewerFile(ph); }}>
                                <MiniPreview fileRef={ph} />
                              </div>
                              <button className="absolute -top-2 -right-2 w-6 h-6 rounded-full border border-rose-300 bg-white text-rose-700 flex items-center justify-center"
                                title="Delete photo"
                                onClick={async()=>{ const ok=await askConfirm(); if(!ok) return; await deleteFileRef(ph); const next = (p.photos||[]).filter(x=>x.id!==ph.id); updateP(p.id,{photos:next}); }}
                              >×</button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                    </div>
                  </div>

                  {/* Notes */}
                  <div className="mt-2">
                    <div className="text-xs">Notes</div>
                    <div className="relative">
                      <textarea className="border rounded p-2 w-full text-xs pr-12 select-text placeholder-gray-400" placeholder="..." rows={2} value={p.notes||''} onChange={e=>updateP(p.id,{notes:e.target.value})} />
                      <IconBtn ariaLabel="Share" label="Share" onClick={()=>shareText(p.notes||'')} className="absolute right-2 bottom-2 border-blue-300 text-blue-700 hover:bg-blue-50"><IconShare/></IconBtn>
                    </div>
                  </div>

                  {/* Share all (bottom) — show only when ≥ 2 items exist */}
                  {hasTwoShareItems(p) ? (
                    <div className="mt-3">
                      <button type="button" className="px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700"
                        onClick={()=>shareAll({ resume:p.resume, photos:p.photos||[], text:p.notes||'' })}
                      >
                        Share all
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* hanging expand tab (both states) */}
              <button
                type="button"
                aria-label={isOpen ? "Collapse details" : "Expand details"}
                title={isOpen ? "Collapse" : "Expand"}
                onClick={()=>toggleOpen(p.id)}
                className="absolute right-2 -bottom-3 w-[44px] h-[32px] bg-white border rounded-t-md shadow-sm flex items-center justify-center hover:bg-gray-50"
                style={{ borderBottom: 'none' }}
              >
                <span className="text-sm">{isOpen ? '^' : 'v'}</span>
              </button>
            </div>
          );
        })}

        {/* Add card */}
        <button type="button" onClick={addProspect} className="h-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
          <div className="text-4xl leading-none text-gray-400">+</div>
          <div className="text-xs text-gray-500 mt-1">Add resume</div>
        </button>
      </div>

      {/* Viewer & Confirm */}
      {viewerFile && (<Viewer fileRef={viewerFile} photos={viewerPhotos} startIndex={viewerIndex} onClose={()=> { setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); }} />)}
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

function EditableText({ value, onChange, className, inputClass, placeholder="name..." }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(value);
  useEffect(()=>setVal(value),[value]);
  return editing? (
    <input className={`${inputClass} placeholder-gray-400`} value={val} autoFocus onChange={e=>setVal(e.target.value)} placeholder={placeholder} onKeyDown={e=>{ if(e.key==='Enter'){ onChange((val||'').trim()); setEditing(false);} if(e.key==='Escape'){ setEditing(false);} }} onBlur={()=>{ onChange((val||'').trim()); setEditing(false);} } />
  ) : (
    <button className={className} onClick={()=>setEditing(true)} title="Tap to edit">
      {value ? value : <span className="text-gray-400">{placeholder}</span>}
    </button>
  );
}

// ===== My Profile =====
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
            {/* Resume */}
            <div>
              <div className="text-xs mb-1">Resume</div>
              {selected.resume ? (
                <div className="group cursor-pointer" onClick={()=>{ setViewerFile(selected.resume); setViewerPhotos([]); setViewerIndex(0); }}>
                  <MiniPreview fileRef={selected.resume} />
                  <div className="flex items-center gap-2 mt-2">
                    <IconBtn ariaLabel="Share" label="Share" onClick={(e)=>{ e.stopPropagation(); shareRef(selected.resume,'resume'); }} className="border-blue-300 text-blue-700 hover:bg-blue-50"><IconShare/></IconBtn>
                    <IconBtn ariaLabel="Download" label="Download" onClick={(e)=>{ e.stopPropagation(); downloadRef(selected.resume); }} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"><IconDownload/></IconBtn>
                    <IconBtn ariaLabel="Delete" label="Delete" onClick={async(e)=>{ e.stopPropagation(); const ok=await askConfirm(); if(!ok) return; if (selected.resume) await deleteFileRef(selected.resume); updateProfile(selected.id,{resume:null}); }} className="border-rose-300 text-rose-700 hover:bg-rose-50"><IconX/></IconBtn>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={()=>document.getElementById(`profile-resume-${selected.id}`)?.click()}
                  className="h-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 w-full flex flex-col items-center justify-center"
                >
                  <div className="text-3xl leading-none text-gray-400">+</div>
                  <div className="text-xs text-gray-500 mt-1">Add resume</div>
                  <input id={`profile-resume-${selected.id}`} type="file" accept="*/*" className="hidden" onChange={async(e)=>{ const f=e.target.files?.[0]; if(f){ const ref=await attachFile(f); updateProfile(selected.id,{resume:ref}); } e.target.value=""; }} />
                </button>
              )}
            </div>

            {/* Photos */}
            <div>
              <div className="text-xs mb-1">Photos</div>
              <div className="flex items-center gap-2">
                {ensureArray(selected.photos).length ? (
                  <div className="relative cursor-pointer" onClick={()=>{ setViewerPhotos(selected.photos||[]); setViewerIndex(0); setViewerFile(selected.photos?.[0]); }}>
                    <div className="w-40 h-28 rounded-md bg-white border overflow-hidden">
                      <MiniPreview fileRef={selected.photos[0]} />
                    </div>
                    {selected.photos.length > 1 && (
                      <div className="absolute -right-2 top-2 w-20 h-14 border rounded-md overflow-hidden bg-white shadow-sm">
                        <MiniPreview fileRef={selected.photos[1]} />
                      </div>
                    )}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={()=>document.getElementById(`profile-photos-${selected.id}`)?.click()}
                  className="h-28 w-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center"
                >
                  <div className="text-3xl leading-none text-gray-400">+</div>
                  <div className="text-[11px] text-gray-500 mt-1">Add photos</div>
                  <input id={`profile-photos-${selected.id}`} type="file" accept="image/*" multiple className="hidden" onChange={async(e)=>{ const fs=Array.from(e.target.files||[]); if(fs.length){ const refs=[]; for(const f of fs){ refs.push(await attachFile(f)); } updateProfile(selected.id,{photos:[...(selected.photos||[]), ...refs]}); } e.target.value=""; }} />
                </button>
              </div>

              {ensureArray(selected.photos).length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.photos.map((ph, i)=>(
                    <div key={ph.id} className="relative">
                      <div className="w-24 h-16 border rounded overflow-hidden cursor-pointer" onClick={()=>{ setViewerPhotos(selected.photos||[]); setViewerIndex(i); setViewerFile(ph); }}>
                        <MiniPreview fileRef={ph} />
                      </div>
                      <button className="absolute -top-2 -right-2 w-6 h-6 rounded-full border border-rose-300 bg-white text-rose-700 flex items-center justify-center"
                        title="Delete photo"
                        onClick={async()=>{ const ok=await askConfirm(); if(!ok) return; await deleteFileRef(ph); const next = (selected.photos||[]).filter(x=>x.id!==ph.id); updateProfile(selected.id,{photos:next}); }}
                      >×</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Viewer + Confirm */}
            {viewerFile && (<Viewer fileRef={viewerFile} photos={viewerPhotos} startIndex={viewerIndex} onClose={()=> { setViewerFile(null); setViewerPhotos([]); setViewerIndex(0); }} />)}
            {Confirm}
          </div>

          {/* Blurb */}
          <div className="mt-2">
            <div className="text-xs">Blurb</div>
            <div className="relative">
              <textarea className="border rounded p-2 w-full text-xs pr-12 select-text placeholder-gray-400" rows={2} value={selected.blurb || ''} onChange={e=>updateProfile(selected.id,{blurb:e.target.value})} placeholder="..." />
              <IconBtn ariaLabel="Share" label="Share" onClick={()=>shareText(selected.blurb||'')} className="absolute right-2 bottom-2 border-blue-300 text-blue-700 hover:bg-blue-50"><IconShare/></IconBtn>
            </div>
          </div>

          {/* Share all (bottom) — must have at least 2 of resume/photos/blurb */}
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

  // Minimal cloud sync
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sync?.room) return;
      const cloud = await fetchRoom(sync.room);
      if (!cloud || cancelled) return;
      let prof = cloud.profile;
      if (prof?.kids && !prof.profiles) {
        prof = { ...prof, profiles: ensureArray(prof.kids).map(k=>({ ...k, photos: k.photos || (k.photo?[k.photo]:[]), photo: undefined })), kids: undefined };
      }
      if (prof) setProfile(prof);
      let list = Array.isArray(cloud.prospects) ? cloud.prospects : [];
      list = list.map(it => !Array.isArray(it.photos) ? ({ ...it, photos: it.photo?[it.photo]:[], photo: undefined, profileId: it.profileId || it.kidId }) : it);
      setProspects(list);
    })();
    return () => { cancelled = true; };
  }, [sync?.room]);

  useEffect(() => {
    if (!sync?.room) return;
    const unsub = subscribeRoom(sync.room, (payload) => {
      if (payload?.clientId === clientId) return;
      applyingRemoteRef.current = true;
      lastAppliedRef.current = Date.now();

      let prof = payload?.profile;
      if (prof?.kids && !prof.profiles) {
        prof = { ...prof, profiles: ensureArray(prof.kids).map(k=>({ ...k, photos: k.photos || (k.photo?[k.photo]:[]), photo: undefined })), kids: undefined };
      }
      if (prof) setProfile(prof);

      let list = Array.isArray(payload?.prospects) ? payload.prospects : [];
      list = list.map(it => !Array.isArray(it.photos) ? ({ ...it, photos: it.photo?[it.photo]:[], photo: undefined, profileId: it.profileId || it.kidId }) : it);
      setProspects(list);

      applyingRemoteRef.current = false;
    });
    return () => { try { unsub?.(); } catch {} };
  }, [sync?.room]);

  // Debounced push
  useEffect(() => {
    if (!sync?.room) return;
    if (lastAppliedRef.current && Date.now() - lastAppliedRef.current < 800) return;
    if (applyingRemoteRef.current) { applyingRemoteRef.current = false; return; }
    const t = setTimeout(() => { saveRoom(sync.room, { profile, prospects, clientId }).catch(()=>{}); }, 400);
    return () => clearTimeout(t);
  }, [profile, prospects, sync?.room]);

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
    <div className="p-4 max-w-4xl mx-auto text-sm select-none">
      {/* Version label */}
      <div className="text-xs text-gray-500 mb-1">Shidduch Organizer • v2.0 (Lite)</div>

      {/* Folder Tabs */}
      <div role="tablist" aria-label="Sections" className="mb-4 border-b">
        <div className="flex items-end gap-2">
          <button
            role="tab"
            aria-selected={tab==='prospects'}
            className={`px-3 py-2 rounded-t-lg border ${tab==='prospects' ? 'bg-white border-b-white' : 'bg-gray-50 text-gray-700'} -mb-px`}
            onClick={()=>setTab('prospects')}
          >
            Resumes
          </button>

          <div className="flex-1" />

          <button
            role="tab"
            aria-selected={tab==='profile'}
            className={`px-3 py-2 rounded-t-lg border ${tab==='profile' ? 'bg-white border-b-white' : 'bg-gray-50 text-gray-700'} -mb-px`}
            onClick={()=>setTab('profile')}
          >
            My Profile
          </button>
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
