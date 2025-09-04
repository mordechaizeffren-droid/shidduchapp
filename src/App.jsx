import React, { useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { fetchRoom, saveRoom, subscribeRoom } from "./lib/sync"; 

// =============================================================================
// Shidduch Organizer — Single File App (all features, compact)
// =============================================================================

// ===== DB =====
const dbProfile = localforage.createInstance({ name: "shidduch-db", storeName: "profile" });
const dbProspects = localforage.createInstance({ name: "shidduch-db", storeName: "prospects" });
const dbFiles = localforage.createInstance({ name: "shidduch-db", storeName: "files" });

// ===== Helpers & constants =====
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const ensureArray = (v) => (Array.isArray(v) ? v : []);
const STATUS = ["New", "Researching", "Dating", "On Hold", "Pass", "Reconsidering"];
const TRUST = ["Shadchan (met)", "Shadchan (never met)", "Friend", "Acquaintance", "Never met"];

// ===== File helpers =====
const attachFile = async (file) => {
  const id = uid();
  await dbFiles.setItem(id, file);
  return { id, name: file.name, type: file.type, size: file.size, addedAt: Date.now() };
};

const downloadRef = async (ref) => {
  const blob = await dbFiles.getItem(ref.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = ref.name || "download"; a.click();
  URL.revokeObjectURL(url);
};

const shareRef = async (ref, label = "file") => {
  try {
    const blob = await dbFiles.getItem(ref.id);
    if (!blob) { alert("File not found in storage"); return; }
    const fileName = ref.name || "file";
    const mime = ref.type || "application/octet-stream";
    const file = new File([blob], fileName, { type: mime });
    const navAny = navigator;

    // Best: Share with files
    if (navAny.share && navAny.canShare && navAny.canShare({ files: [file] })) {
      try { await navAny.share({ files: [file], title: fileName, text: `Sharing ${label}` }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }

    // Fallback: URL share
    const url = URL.createObjectURL(blob);
    if (navAny.share) {
      try { await navAny.share({ url, title: fileName, text: `Sharing ${label}` }); setTimeout(()=>URL.revokeObjectURL(url), 15000); return; } catch (_) {}
    }

    // Last resort: open tab or download
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) { await downloadRef(ref); setTimeout(()=>URL.revokeObjectURL(url), 0); }
    else { setTimeout(()=>URL.revokeObjectURL(url), 60000); }
  } catch (_) { try { await downloadRef(ref); } catch {} }
};

const shareText = async (text, title = 'Blurb') => {
  const t=(text||'').trim(); if(!t){ alert('Nothing to share'); return; }
  const navAny=navigator;
  try{ if(navAny.share){ await navAny.share({ title, text:t }); return; } }catch(e){ if(e?.name==='AbortError') return; }
  try{ await navigator.clipboard.writeText(t); alert('Copied to clipboard'); return; }catch{}
  const url=URL.createObjectURL(new Blob([t],{type:'text/plain'}));
  const a=document.createElement('a'); a.href=url; a.download=((title||'blurb').trim().replaceAll(' ','_'))+'.txt'; a.click(); URL.revokeObjectURL(url);
};

const shareKidAll = async (kid) => {
  if(!kid) return; const files=[];
  try{
    if(kid.photo?.id){ const b=await dbFiles.getItem(kid.photo.id); if(b) files.push(new File([b], kid.photo.name||'photo', { type:kid.photo.type||b.type||'application/octet-stream' })); }
    if(kid.resume?.id){ const b=await dbFiles.getItem(kid.resume.id); if(b) files.push(new File([b], kid.resume.name||'resume.pdf', { type:kid.resume.type||b.type||'application/pdf' })); }
    const text=(kid.blurb||'').trim(); const navAny=navigator;

    if(navAny.share && (files.length || text)){
      try{
        if(files.length && navAny.canShare && navAny.canShare({files})) { await navAny.share({ files, title:kid.name||'Shidduch info', text }); return; }
        if(text){ await navAny.share({ title:kid.name||'Shidduch info', text }); return; }
      }catch(e){ if(e?.name==='AbortError') return; }
    }
    // Fallbacks
    for (const f of files){ const url=URL.createObjectURL(f); const w=window.open(url,'_blank','noopener,noreferrer'); if(!w){ const a=document.createElement('a'); a.href=url; a.download=f.name||'file'; a.click(); } setTimeout(()=>URL.revokeObjectURL(url),60000); }
    if(text){ try{ await navigator.clipboard.writeText(text);}catch{} }
  }catch{ alert('Share failed. You can still Export from the top toolbar.'); }
};

const deleteFileRef = async (ref) => { try { if (ref?.id) await dbFiles.removeItem(ref.id); } catch {} };

// ===== Icons =====
const IconBtn = ({ label, onClick, className = "", children, ariaLabel }) => (
  <button type="button" aria-label={ariaLabel || label} title={label} onClick={onClick} className={`w-8 h-8 inline-flex items-center justify-center rounded-full border bg-white shadow-sm ${className}`}>
    {children}
    <span className="sr-only">{label}</span>
  </button>
);
const IconShare = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v10"/><path d="M8 7l4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>);
const IconDownload = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>);
const IconX = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 6l12 12"/><path d="M18 6l-12 12"/></svg>);
const IconPaste = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="6" y="4" width="12" height="16" rx="2"/>
    <path d="M9 4V2h6v2"/>
  </svg>
);
const IconGear = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...p}><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>);

// ===== Menus & small UI bits =====
const statusTone = (s)=>({ New:'bg-blue-100 text-blue-800 border-blue-200', Researching:'bg-amber-100 text-amber-800 border-amber-200', Dating:'bg-emerald-100 text-emerald-800 border-emerald-200', 'On Hold':'bg-slate-100 text-slate-800 border-slate-200', Pass:'bg-rose-100 text-rose-800 border-rose-200', Reconsidering:'bg-violet-100 text-violet-800 border-violet-200' }[s] || 'bg-gray-100 text-gray-800 border-gray-200');

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

function CityPill({ value, onChange }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(value||'');
  useEffect(()=>setVal(value||''),[value]); const commit=()=>{ onChange((val||'').trim()); setEditing(false); };
  return editing? (
    <input className="border rounded-full px-3 py-1 text-sm w-full" autoFocus value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') setEditing(false); }} onBlur={commit}/>
  ) : (
    <button type="button" className={`px-3 py-1 rounded-full text-sm font-medium border min-h-[36px] ${value? 'bg-indigo-100 text-indigo-800 border-indigo-200':'bg-white text-gray-400'}`} onClick={()=>setEditing(true)} aria-label={value? 'Edit city':'Add city'}>{value||'+'}</button>
  );
}

function InlinePill({ label, placeholder='', onEdit, full=false }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(label||'');
  useEffect(()=>setVal(label||''),[label]); const commit=()=>{ onEdit((val||'').trim()); setEditing(false); };
  return editing? (
    <input className={`border rounded-full px-3 py-1 text-sm ${full?'w-full':''}`} autoFocus value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape') setEditing(false); }} onBlur={commit}/>
  ) : (
    <button className={`px-3 py-2 rounded-full text-sm font-medium border ${label?'bg-gray-100 border-gray-200':'bg-white text-gray-400'} ${full?'w-full text-left':''} min-h-[36px]`} onClick={()=>setEditing(true)} title="Tap to edit">{label||placeholder||' '}</button>
  );
}

function TrustSelect({ value, onChange }){
  return (
    <select className="border rounded-full px-3 py-2 text-sm w-full min-h-[36px] bg-white" value={value || ''} onChange={(e)=>onChange(e.target.value)}>
      <option value="" disabled>Select</option>
      {TRUST.map(s => (<option key={s} value={s}>{s}</option>))}
    </select>
  );
}

function EditableText({ value, onChange, className, inputClass }){
  const [editing,setEditing]=useState(false); const [val,setVal]=useState(value);
  useEffect(()=>setVal(value),[value]);
  return editing? (
    <input className={inputClass} value={val} autoFocus onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ onChange((val||'').trim()); setEditing(false);} if(e.key==='Escape'){ setEditing(false);} }} onBlur={()=>{ onChange((val||'').trim()); setEditing(false);} } />
  ) : (
    <button className={className} onClick={()=>setEditing(true)} title="Tap to edit">{value}</button>
  );
}

// Upload + previews
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

function FileToolbar({ onShare, onDownload, onDelete }){
  return (
    <div className="flex items-center gap-2 mt-2">
      <IconBtn ariaLabel="Share" label="Share" onClick={onShare} className="border-blue-300 text-blue-700 hover:bg-blue-50"><IconShare/></IconBtn>
      <IconBtn ariaLabel="Download" label="Download" onClick={onDownload} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"><IconDownload/></IconBtn>
      <IconBtn ariaLabel="Delete" label="Delete" onClick={onDelete} className="border-rose-300 text-rose-700 hover:bg-rose-50"><IconX/></IconBtn>
    </div>
  );
}

function UploadBox({ emptyLabel, accept, file, onPick, onShare, onDownload, onClear }){
  const inputRef = useRef(null);
  const url = useFilePreview(file);
  const isImg = (file?.type || '').startsWith('image/');
  const handleChange = async (e) => {
    const f = e.target.files?.[0];
    if(f){ const ref = await attachFile(f); if(ref) onPick(ref); }
    e.target.value='';
  };
  if (!file) {
    return (
      <button type="button" onClick={()=>inputRef.current?.click()} className="h-28 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
        <div className="text-3xl leading-none text-gray-400">+</div>
        <div className="text-xs text-gray-500 mt-1">{emptyLabel}</div>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />
      </button>
    );
  }
  return (
    <div className="h-28 border rounded-lg bg-white p-2 flex flex-col">
      <div className="flex-1 overflow-hidden rounded border bg-gray-50 flex items-center justify-center">
        {url ? (
          isImg ? <img src={url} alt={file.name} className="object-contain w-full h-full"/> : <iframe key={file?.id || url} src={url} title="PDF preview" className="w-full h-full rounded" />
        ) : (
          <div className="text-xs text-gray-400">{file.name}</div>
        )}
      </div>
      <FileToolbar onShare={onShare} onDownload={onDownload} onDelete={onClear} />
    </div>
  );
}

// Quick Add menu
function AddDropdown(){
  const [open,setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);
  useEffect(()=>{ if(!open) return; const onDoc = (e)=>{ if(wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }; document.addEventListener('click', onDoc); return ()=> document.removeEventListener('click', onDoc); },[open]);
  const toggle = ()=>{ const MENU_W=176; if(wrapRef.current){ const r=wrapRef.current.getBoundingClientRect(); setAlignRight(r.left + MENU_W > window.innerWidth);} setOpen(o=>!o); };
  const triggerFiles = ()=>{ window.dispatchEvent(new Event('open-quick-add')); setOpen(false); };
  const triggerPaste = ()=>{ window.dispatchEvent(new Event('open-paste-add')); setOpen(false); };
  return (
    <div ref={wrapRef} className="relative inline-block">
      <button type="button" aria-expanded={open} className="px-3 py-1 rounded border flex items-center gap-1 text-black" onClick={toggle}>
        <IconDownload/>
        <span>Add</span>
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-44 rounded border bg-white shadow ${alignRight ? 'right-0' : 'left-0'}`}>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={triggerFiles}><IconDownload/><span>From files</span></button>
          <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={triggerPaste}><IconPaste/><span>Paste</span></button>
        </div>
      )}
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
        {(label||'Select')}
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-white w-full md:w-[28rem] rounded-t-2xl md:rounded-2xl p-4 shadow-lg" onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-semibold mb-2">Sync (optional)</div>
        <p className="text-xs text-gray-500 mb-3">Paste the config token and enter a room name to enable sync between devices.</p>
        <div className="space-y-2">
          <div>
            <div className="text-xs mb-1">Config token</div>
            <input className="border rounded w-full px-2 py-1 text-sm" value={cfg} onChange={(e)=>setCfg(e.target.value)} placeholder="Paste token…"/>
          </div>
          <div>
            <div className="text-xs mb-1">Room</div>
            <input className="border rounded w-full px-2 py-1 text-sm" value={room} onChange={(e)=>setRoom(e.target.value)} placeholder="family-1"/>
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

// ===== Prospects =====
function Prospects({ prospects, setProspects, profile, saveProfile, activeKidId, setActiveKidId }){
  const kids=ensureArray(profile?.kids);
  const safe=ensureArray(prospects);
  const [q,setQ]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [expanded,setExpanded]=useState({});
  const [pasteOn,setPasteOn]=useState(false);
  const pasteRef = useRef(null);

  // Clipboard API try, else show visible paste input
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
  useEffect(()=>{ const h=()=>beginPasteFlow(); window.addEventListener('open-paste-add', h); return ()=>window.removeEventListener('open-paste-add', h); },[kids,activeKidId,prospects]);
  const handlePaste = async (e) => {
    const items = e.clipboardData?.items || []; let file=null;
    for (const it of items) { if (it.kind === 'file' && (it.type.startsWith('image/') || it.type === 'application/pdf')) { file = it.getAsFile(); break; } }
    if (file) { await quickAddFromPickedFile(file); } else { alert('Clipboard does not contain a photo or PDF.'); }
    setPasteOn(false); e.preventDefault();
  };

  // Quick Add from file picker
  const quickRef = useRef(null);
  const quickAddFromPickedFile = async (f) => {
    if (!kids.length) { alert('Add a child first in My Info'); return; }
    const ref = await attachFile(f); if (!ref) return;
    const base = (f.name||'').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim(); const name = base || 'Untitled';
    const pid = activeKidId || kids[0].id;
    const p = { id: uid(), kidId: pid, fullName: name, status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photo:null, resume:null, updatedAt: Date.now() };
    if ((f.type||'').startsWith('image/')) p.photo = ref; else p.resume = ref;
    setProspects([...safe, p]);
  };
  useEffect(()=>{ const h=()=>quickRef.current?.click(); window.addEventListener('open-quick-add', h); return ()=>window.removeEventListener('open-quick-add', h); },[]);

  const toggleOpen=(id)=>setExpanded(s=>({...s,[id]:!s[id]}));
  const addKid=()=>{ const k={id:uid(), name:'', updatedAt:Date.now()}; saveProfile({ ...(profile||{}), kids:[...kids, k], updatedAt:Date.now() }); setActiveKidId(k.id); };
  const addProspect=()=>{ if(!kids.length){ alert('Add a child first in My Info'); return; } const p={ id:uid(), kidId:activeKidId||kids[0].id, fullName:'Untitled', status:'New', sourceName:'', sourceTrust:'', city:'', notes:'', photo:null, resume:null, updatedAt:Date.now() }; setProspects([...safe,p]); };
  const updateP=(id,patch)=> setProspects(safe.map(x=> x.id===id?{...x,...patch, updatedAt:Date.now()}:x));
  const removeP=(id)=> setProspects(safe.filter(x=>x.id!==id));
  const onDropFiles=async(pid, files)=>{ if(!files||!files.length) return; for(const f of Array.from(files)){ const ref=await attachFile(f); if(!ref) continue; if((f.type||'').startsWith('image/')) updateP(pid,{photo:ref}); else if(f.type==='application/pdf'||(f.name||'').toLowerCase().endsWith('.pdf')) updateP(pid,{resume:ref}); } };

  const filtered = safe
    .filter(p=>!activeKidId || p.kidId===activeKidId)
    .filter(p=>!statusFilter || p.status===statusFilter)
    .filter(p=>{ const t=q.trim().toLowerCase(); if(!t) return true; return ((p.fullName||'').toLowerCase().includes(t) || (p.city||'').toLowerCase().includes(t) || (p.sourceName||'').toLowerCase().includes(t) || (p.notes||'').toLowerCase().includes(t)); });

  return (
    <div className="space-y-3">
      {/* kid pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {kids.map(k=> (<button key={k.id} className={`px-3 py-1 rounded-full border ${activeKidId===k.id?'bg-black text-white':'bg-white'}`} onClick={()=>setActiveKidId(k.id)}>{k.name||'Unnamed'}</button>))}
        <button className="px-3 py-1 rounded-full border" onClick={addKid} aria-label="Add child">+</button>
      </div>

      {/* search + filter */}
      <div className="flex items-center gap-2">
        <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Search name, city, notes..." value={q} onChange={e=>setQ(e.target.value)} />
        {pasteOn && (<input ref={pasteRef} onPaste={handlePaste} className="border rounded px-2 py-1 text-sm" placeholder="Paste here…" aria-label="Paste here" />)}
        <PillMenu label={statusFilter||'All'} options={['All',...STATUS]} onPick={(s)=>setStatusFilter(s==='All'?'':s)} />
        <input ref={quickRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) quickAddFromPickedFile(f); e.target.value=''; }} />
      </div>

      {/* cards grid */}
      <div className="grid grid-cols-1 gap-2 w-full">
        {filtered.map(p=> (
          <div
  key={p.id}
  className={`border rounded bg-white shadow-sm ${expanded[p.id] ? 'p-4' : 'p-2'}`}
 onDragOver={(e)=>e.preventDefault()} onDrop={async(e)=>{ e.preventDefault(); await onDropFiles(p.id, e.dataTransfer?.files||null); }}>
            <div className="p-2 flex items-center gap-2">
              <EditableText value={p.fullName} onChange={(v)=>updateP(p.id,{fullName:v||'Untitled'})} className="font-medium truncate flex-1" inputClass="font-medium truncate flex-1 border rounded px-2 py-1" />
              {p.city ? <span className="text-xs text-gray-500 truncate max-w-[6rem]">{p.city}</span> : null}
              <button type="button" className="px-2 py-1 rounded-full border text-xs bg-white" onClick={()=>toggleOpen(p.id)} aria-label="Toggle details">{expanded[p.id]? 'Collapse':'Expand'}</button>
              <button type="button" aria-label="Delete resume" className="w-7 h-7 rounded-full border border-rose-300 text-rose-700 flex items-center justify-center hover:bg-rose-50" onClick={()=>removeP(p.id)}>×</button>
            </div>
            {expanded[p.id] && (
              <div className="p-2 pt-0">
                <div className="mt-1 grid grid-cols-2 gap-2 items-start">
                  <div><div className="text-xs mb-1">Status</div><StatusPill value={p.status||'New'} onChange={(s)=>updateP(p.id,{status:s})} /></div>
                  <div><div className="text-xs mb-1">City</div><CityPill value={p.city||''} onChange={(v)=>updateP(p.id,{city:v})} /></div>
                </div>
                <div className="mt-2 border rounded p-3 grid grid-cols-2 gap-3 items-start">
                  <div><div className="text-xs mb-1">Suggested by</div><InlinePill label={p.sourceName||''} placeholder="" onEdit={(v)=>updateP(p.id,{sourceName:v})} full /></div>
                  <div><div className="text-xs mb-1">Status</div><TrustSelect value={p.sourceTrust||''} onChange={(v)=>updateP(p.id,{sourceTrust:v})} /></div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 w-full">
                  <UploadBox emptyLabel="Add PDF" accept="application/pdf" file={p.resume} onPick={(ref)=>updateP(p.id,{resume:ref})} onShare={()=>p.resume && shareRef(p.resume,'resume')} onDownload={()=>p.resume && downloadRef(p.resume)} onClear={()=>{ if (p.resume) deleteFileRef(p.resume); updateP(p.id,{resume:null}); }} />
                  <UploadBox emptyLabel="Add photo" accept="image/*" file={p.photo} onPick={(ref)=>updateP(p.id,{photo:ref})} onShare={()=>p.photo && shareRef(p.photo,'photo')} onDownload={()=>p.photo && downloadRef(p.photo)} onClear={()=>{ if (p.photo) deleteFileRef(p.photo); updateP(p.id,{photo:null}); }} />
                </div>
                <div className="mt-2">
                  <div className="text-xs">Notes</div>
                  <div className="relative">
                    <textarea className="border rounded p-2 w-full text-xs pr-20" rows={2} value={p.notes} onChange={e=>updateP(p.id,{notes:e.target.value})} />
                    <button type="button" aria-label="Share notes" className="absolute right-2 bottom-2 px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700 disabled:opacity-50 shadow-sm" onClick={()=>shareText(p.notes||'', p.fullName||'Notes')} disabled={!((p.notes||'').trim())}>Share</button>
                  </div>
                </div>
                <div className="mt-2">
                  <button type="button" className="px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700 disabled:opacity-50" onClick={()=>shareKidAll({ name:(kids.find(k=>k.id===p.kidId)?.name)||p.fullName, photo:p.photo, resume:p.resume, blurb:(kids.find(k=>k.id===p.kidId)?.blurb)||'' })} disabled={!(((kids.find(k=>k.id===p.kidId)?.blurb||'').trim()) || p.photo || p.resume)}>Share</button>
                </div>
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={addProspect} className="h-40 border-2 border-dashed border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex flex-col items-center justify-center">
          <div className="text-4xl leading-none text-gray-400">+</div>
          <div className="text-xs text-gray-500 mt-1">Add resume</div>
        </button>
      </div>
    </div>
  );
}

// ===== My Info =====
function MyInfo({ profile, saveProfile }){
  const kids=ensureArray(profile?.kids);
  const [selId,setSelId]=useState(kids[0]?.id||'');
  useEffect(()=>{ setSelId(kids[0]?.id||''); },[profile?.kids]);
  const addKid=()=>{ const newKid={ id:uid(), name:'', photo:null, resume:null, updatedAt:Date.now() }; const next=[...kids,newKid]; saveProfile({ ...(profile||{}), kids:next, updatedAt:Date.now() }); setSelId(newKid.id); };
  const updateKid=(id,patch)=>{ const next=kids.map(k=> k.id===id?{...k,...patch,updatedAt:Date.now()}:k); saveProfile({ ...(profile||{}), kids:next, updatedAt:Date.now() }); };
  const selected=kids.find(k=>k.id===selId);
  const [editKidId,setEditKidId]=useState(''); const [editVal,setEditVal]=useState('');
  const [kidMenu,setKidMenu]=useState({open:false,kidId:'',x:0,y:0});
  const menuRef=useRef(null);
  useEffect(()=>{ if(!kidMenu.open) return; const close=(e)=>{ if(menuRef.current && !menuRef.current.contains(e.target)) setKidMenu(s=>({...s,open:false})); }; document.addEventListener('pointerdown', close, true); return ()=>document.removeEventListener('pointerdown', close, true); },[kidMenu.open]);
  const lpRef=useRef(null);
  const startLP=(el,id)=>{ clearTimeout(lpRef.current); lpRef.current=setTimeout(()=>{ const r=el?.getBoundingClientRect?.(); if(!r) return; setKidMenu({open:true,kidId:id,x:r.left+r.width/2,y:r.bottom+8}); },500); };
  const cancelLP=()=> clearTimeout(lpRef.current);
  const deleteKid=()=>{ const id=kidMenu.kidId; const next=kids.filter(k=>k.id!==id); saveProfile({ ...(profile||{}), kids:next, updatedAt:Date.now() }); if(selId===id) setSelId(next[0]?.id||''); setKidMenu(s=>({...s,open:false})); };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {kids.map(k=> (
          editKidId===k.id ? (
            <input key={k.id} className={`px-3 py-1 rounded-full border`} autoFocus value={editVal} onChange={(e)=>setEditVal(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ updateKid(k.id,{name:(editVal||'').trim()}); setEditKidId(''); } if(e.key==='Escape'){ setEditKidId(''); } }} onBlur={()=>{ updateKid(k.id,{name:(editVal||'').trim()}); setEditKidId(''); }} />
          ) : (
            <button key={k.id} className={`px-3 py-1 rounded-full border ${selId===k.id?'bg-black text-white':'bg-white'}`} onClick={()=>{ if(selId!==k.id) setSelId(k.id); else { setEditKidId(k.id); setEditVal(k.name||''); } }} onContextMenu={(e)=>{ e.preventDefault(); const r=e.currentTarget.getBoundingClientRect(); setKidMenu({open:true,kidId:k.id,x:r.left+r.width/2,y:r.bottom+8}); }} onMouseDown={(e)=>startLP(e.currentTarget,k.id)} onMouseUp={cancelLP} onMouseLeave={cancelLP} onTouchStart={(e)=>startLP(e.currentTarget,k.id)} onTouchEnd={cancelLP} onTouchMove={cancelLP}>{k.name||'Unnamed'}</button>
          )
        ))}
        <button className="px-3 py-1 rounded-full border" onClick={addKid} aria-label="Add child">+</button>
      </div>
      {kidMenu.open && (<div ref={menuRef} style={{position:'fixed', left:kidMenu.x, top:kidMenu.y, transform:'translateX(-50%)'}} className="z-50 rounded border bgwhite shadow">
  <button
    className="block w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
    onClick={deleteKid}
  >
    Delete
  </button>
</div>)}

{selected ? (
  <>
    <div className="grid grid-cols-2 gap-2">
      <UploadBox
        emptyLabel="Add PDF"
        accept="application/pdf"
        file={selected.resume}
        onPick={(ref)=>updateKid(selected.id,{resume:ref})}
        onShare={()=>selected.resume && shareRef(selected.resume,'resume')}
        onDownload={()=>selected.resume && downloadRef(selected.resume)}
        onClear={()=>{
          if (selected?.resume) deleteFileRef(selected.resume);
          updateKid(selected.id,{resume:null});
        }}
      />
      <UploadBox
        emptyLabel="Add photo"
        accept="image/*"
        file={selected.photo}
        onPick={(ref)=>updateKid(selected.id,{photo:ref})}
        onShare={()=>selected.photo && shareRef(selected.photo,'photo')}
        onDownload={()=>selected.photo && downloadRef(selected.photo)}
        onClear={()=>{
          if (selected?.photo) deleteFileRef(selected.photo);
          updateKid(selected.id,{photo:null});
        }}
      />
    </div>

    <div className="mt-2">
      <div className="text-xs">Blurb</div>
      <div className="relative">
        <textarea
          className="border rounded p-2 w-full text-xs pr-20"
          rows={2}
          value={selected.blurb || ''}
          onChange={e=>updateKid(selected.id,{blurb:e.target.value})}
        />
        <button
          type="button"
          aria-label="Share blurb"
          className="absolute right-2 bottom-2 px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700 disabled:opacity-50 shadow-sm"
          onClick={()=>shareText(selected.blurb||'', selected.name||'Blurb')}
          disabled={!((selected.blurb||'').trim())}
        >
          Share
        </button>
      </div>
    </div>

    <div className="mt-2">
      <button
        type="button"
        className="px-3 py-1 rounded-full border text-xs bg-white hover:bg-blue-50 border-blue-300 text-blue-700 disabled:opacity-50"
        disabled={!((selected?.blurb||'').trim() || selected?.photo || selected?.resume)}
        onClick={()=>shareKidAll(selected)}
      >
        Share all
      </button>
    </div>
  </>
) : (
  <div className="text-xs text-gray-500">
    Add a child to attach a photo or resume.
  </div>
)}

<div className="text-xs text-gray-500">
  This app stores data only on this device. Use Export/Import to sync between devices.
</div>
</div>
);
}

// ===== App (glue) =====
export default function App(){
  const [tab,setTab]=useState('prospects');
  const [profile,setProfile]=useState(null);
  const [prospects,setProspects]=useState([]);
  const [activeKidId, setActiveKidId] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [sync, setSync] = useState({ config:'', room:'' });

  // Load data from IndexedDB on first load
  useEffect(()=>{(async()=>{
    const p = await dbProfile.getItem('me'); if(p) setProfile(p);
    const s = await dbProfile.getItem('sync'); if(s) setSync(s);
    const arr=[]; await dbProspects.iterate((v)=>arr.push(v));
    setProspects(ensureArray(arr));
  })();},[]);

  // Keep activeKidId valid
  useEffect(()=>{
    const kids=ensureArray(profile?.kids);
    const exists=activeKidId && kids.some(k=>k.id===activeKidId);
    if(!exists) setActiveKidId(kids[0]?.id||'');
  },[profile,activeKidId]);

  // Save helpers
  const saveProfile = async (p) => {
    const safe={...(p||{}), kids:ensureArray(p?.kids)};
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

  // Minimal cloud sync (optional)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sync?.room) return;
      const cloud = await fetchRoom(sync.room);
      if (!cloud || cancelled) return;
      if (cloud.profile) setProfile(cloud.profile);
      if (Array.isArray(cloud.prospects)) setProspects(cloud.prospects);
    })();
    return () => { cancelled = true; };
  }, [sync?.room]);

  useEffect(() => {
    if (!sync?.room) return;
    const unsub = subscribeRoom(sync.room, (payload) => {
      if (payload?.profile) setProfile(payload.profile);
      if (Array.isArray(payload?.prospects)) setProspects(payload.prospects);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [sync?.room]);

  // Push changes (debounced)
  useEffect(() => {
    if (!sync?.room) return;
    const t = setTimeout(() => {
      saveRoom(sync.room, { profile, prospects }).catch(()=>{});
    }, 400);
    return () => clearTimeout(t);
  }, [profile, prospects, sync?.room]);

  // Export / Import
  const importRef=useRef(null);
  const b64ToBlob=(b64,type)=>{ const s=atob(b64); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return new Blob([a],{type}); };
  const exportAll = async () => {
    const prof = await dbProfile.getItem('me');
    const list = []; await dbProspects.iterate((v) => list.push(v));
    const ids = new Map(); const add = (r) => { if (r && r.id) ids.set(r.id, r); };
    if (prof) { add(prof.photo); add(prof.resume); ensureArray(prof.kids).forEach((k) => { add(k.photo); add(k.resume); }); }
    ensureArray(list).forEach((p) => { add(p.photo); add(p.resume); });
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
    const payload = { version: 1, exportedAt: Date.now(), profile: prof, prospects: list, files };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const backupFile = new File([blob], 'shidduch-backup.json', { type: 'application/json' });
    try {
      const navAny = navigator;
      if (navAny.share && navAny.canShare && navAny.canShare({ files: [backupFile] })) {
        await navAny.share({ files: [backupFile], title: 'Shidduch backup' });
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
      if(data.profile){ await dbProfile.setItem('me', data.profile); setProfile(data.profile); }
      const existing=new Map(ensureArray(prospects).map(p=>[p.id,p]));
      const merged=[...ensureArray(prospects)];
      for(const p of ensureArray(data.prospects)){
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
      await saveProspects(merged);
      alert('Import done');
    } catch {
      alert('Import failed');
    }
  };
  const saveSync = async (s)=>{ setSync(s); await dbProfile.setItem('sync', s); };
  const clearSync = async ()=>{ setSync({config:'', room:''}); try{ await dbProfile.removeItem('sync'); }catch{} };

  return (
    <div className="p-4 max-w-4xl mx-auto text-sm">
      <h1 className="text-xl font-semibold mb-3">Shidduch Organizer • v1.5 (Lite)</h1>

      <div className="flex gap-2 mb-4 items-center">
        <button
          className={`px-3 py-1 rounded border ${tab==='prospects'?'bg-black text-white':'bg-white'}`}
          onClick={()=>setTab('prospects')}
        >
          Resumes
        </button>

        <AddDropdown />

        <div className="ml-auto flex gap-2 items-center">
          <button
            className={`px-3 py-1 rounded border ${tab==='profile'?'bg-black text-white':'bg-white'}`}
            onClick={()=>setTab('profile')}
          >
            My Info
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e=>{ const f=e.target.files?.[0]; if(f) importAll(f); }}
          />
        </div>
      </div>

      <SettingsFab
        onExport={exportAll}
        onImport={() => importRef.current?.click()}
        onOpenSync={()=>setSyncOpen(true)}
      />

      <SyncPanel
        open={syncOpen}
        initial={sync}
        onSave={saveSync}
        onClear={clearSync}
        onClose={()=>setSyncOpen(false)}
      />

      {tab==='prospects' ? (
        <Prospects
          profile={profile}
          saveProfile={saveProfile}
          prospects={prospects}
          setProspects={saveProspects}
          activeKidId={activeKidId}
          setActiveKidId={setActiveKidId}
        />
      ) : (
        <MyInfo profile={profile} saveProfile={saveProfile} />
      )}
    </div>
  );
}

