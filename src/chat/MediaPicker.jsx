// The GIF + media picker (the GIF button by Send): search Klipy GIFs, star them into Saved Media,
// and Saved Media = starred GIFs + every picture / video / audio file on your Velora account.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, Star, X, Upload, Music, Play, Loader2 } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, getState, toast, errorText, ask, loadMedia, saveGif, unsaveGif, deleteMedia, saveFilesToMedia, getUploadLimits } from './store.js';

export function GifBadge() { return <span className="vc-gif-badge">GIF</span>; }

// the star on a GIF (picker tiles and GIFs in messages)
export function StarButton({ gif }) {
  const saved = useChat(s => s.savedMedia?.some(m => m.url === gif.url));
  return (
    <button type="button" className={`vc-star${saved ? ' on' : ''}`} title={saved ? 'Remove from Saved Media' : 'Save to Saved Media'}
      onClick={e => { e.preventDefault(); e.stopPropagation(); (saved ? unsaveGif(gif.url) : saveGif(gif)).catch(er => toast(errorText(er.message))); }}>
      <Star size={15} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}

export default function MediaPicker({ onPick, onClose }) {
  const [tab, setTab] = useState('saved'); // Saved Media opens first
  const box = useRef(null);
  // a file dragged onto the picker is saved to Saved Media (your Velora account), not sent to the conversation: the picker lights up
  // as the target and the window-wide "Drop to upload" overlay (Messages.jsx) stays out of the way because of data-drop-own.
  const [hot, setHot] = useState(false);
  const [uploading, setUploading] = useState(0);
  const depth = useRef(0);
  const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  async function add(files) {
    const list = [...files].slice(0, 10);
    if (!list.length) return;
    setUploading(n => n + list.length);
    await saveFilesToMedia(list);
    setUploading(n => n - list.length);
  }
  useEffect(() => {
    const reset = () => { depth.current = 0; setHot(false); };
    const leave = e => { if (e.relatedTarget == null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) reset(); };
    addEventListener('dragend', reset, true); addEventListener('drop', reset, true); addEventListener('dragleave', leave, true);
    return () => { removeEventListener('dragend', reset, true); removeEventListener('drop', reset, true); removeEventListener('dragleave', leave, true); };
  }, []);
  useEffect(() => {
    const off = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vc-gif-btn, .vc-modal-back')) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [onClose]);
  return (
    <div className={`vc-picker${hot ? ' drop-hot' : ''}`} ref={box} data-drop-own
      onDragEnter={e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setHot(true); }}
      onDragOver={e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={e => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setHot(false); }}
      onDrop={e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setHot(false); setTab('saved'); add(e.dataTransfer.files); }}>
      {hot && <div className="vc-picker-drop" aria-hidden="true"><Upload size={30} /><b>Drop to save to your Velora account</b><span>Kept in Saved Media - up to {getUploadLimits().saved_mb} MB per file</span></div>}
      <div className="vc-picker-tabs">
        <button type="button" className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved Media</button>
        <button type="button" className={tab === 'gifs' ? 'on' : ''} onClick={() => setTab('gifs')}>GIFs</button>
      </div>
      <div className="vc-picker-body" key={tab}>{tab === 'gifs' ? <Gifs onPick={onPick} /> : <Saved onPick={onPick} add={add} uploading={uploading} />}</div>
    </div>
  );
}

function Gifs({ onPick }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try { const d = await apiFetch(`/chat/gifs?q=${encodeURIComponent(q)}&page=1`); setList(d.gifs); setMore(d.has_more); setPage(1); }
      catch (e) { setErr(e.message); setList([]); }
      setBusy(false);
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { if (!getState().savedMedia) loadMedia(); }, []);
  async function loadMore() {
    if (busy || !more) return;
    setBusy(true);
    try { const d = await apiFetch(`/chat/gifs?q=${encodeURIComponent(q)}&page=${page + 1}`); setList(l => [...l, ...d.gifs.filter(g => !l.some(x => x.id === g.id))]); setMore(d.has_more); setPage(p => p + 1); }
    catch { /* keep what we have */ }
    setBusy(false);
  }
  return (
    <>
      <label className="vc-search vc-picker-search"><Search size={15} /><input autoFocus placeholder="Search KLIPY" value={q} onChange={e => setQ(e.target.value)} /><img className="vc-klipy-logo" src="/assets/klipy/powered-white.png" alt="Powered by KLIPY" /></label>
      <div className="vc-picker-scroll" onScroll={e => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore(); }}>
        {err === 'gifs_not_configured' && <div className="vc-empty-note">GIF search isn't set up yet (it needs a Klipy API key on the server).</div>}
        {err && err !== 'gifs_not_configured' && <div className="vc-empty-note">Couldn't load GIFs right now.</div>}
        {list && !list.length && !err && <div className="vc-empty-note">No GIFs found.</div>}
        <div className="vc-gif-grid">
          {(list || []).map((g, i) => (
            <button type="button" key={g.id} className="vc-gif-tile vl-rise" style={{ '--i': Math.min(i % 30, 12), aspectRatio: g.width && g.height ? `${g.width} / ${g.height}` : undefined }}
              onClick={() => onPick({ url: g.url, type: 'gif', name: g.title, width: g.width, height: g.height })} title={g.title}>
              <img src={g.preview} alt={g.title} loading="lazy" />
              <GifBadge />
              <StarButton gif={g} />
            </button>
          ))}
        </div>
        {busy && <div className="vc-loading"><i /><i /><i /></div>}
        <a className="vc-klipy" href="https://klipy.com" target="_blank" rel="noopener noreferrer"><img src="/assets/klipy/powered-white.png" alt="Powered by KLIPY" /></a>
      </div>
    </>
  );
}

const fmtSize = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function Saved({ onPick, add, uploading }) {
  const items = useChat(s => s.savedMedia);
  const [filter, setFilter] = useState('all');
  const file = useRef(null);
  useEffect(() => { loadMedia(); }, []);
  async function remove(m) {
    if (m.upload && !(await ask({ title: 'Delete this file?', text: `${m.name} is deleted from your Velora storage. Messages that already have it will show it as missing.`, confirm: 'Delete file', danger: true }))) return;
    try { await deleteMedia(m); } catch (e) { toast(errorText(e.message)); }
  }
  const shown = (items || []).filter(m => filter === 'all' || m.kind === filter || (filter === 'image' && m.kind === 'gif'));
  return (
    <>
      <div className="vc-picker-bar">
        {[['all', 'All'], ['image', 'Pictures + GIFs'], ['video', 'Videos'], ['audio', 'Audio']].map(([k, l]) => <button type="button" key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        <span className="grow" />
        <button type="button" className="vc-picker-up" onClick={() => file.current?.click()}>{uploading ? <Loader2 size={14} className="vc-spin" /> : <Upload size={14} />} Save a file</button>
        <input ref={file} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/*" onChange={e => { add(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="vc-picker-scroll">
        {items === null && <div className="vc-loading"><i /><i /><i /></div>}
        {items && !shown.length && <div className="vc-empty-note">Nothing here yet. Star a GIF, or save a picture, video or audio file - they're kept on your Velora account.</div>}
        <div className="vc-saved-grid">
          {shown.map((m, i) => (
            <div key={m.id} className={`vc-saved vl-rise k-${m.kind}`} style={{ '--i': Math.min(i, 12) }}>
              <button type="button" className="vc-saved-main" title={m.name} onClick={() => onPick({ url: m.url, type: m.kind, name: m.name, width: m.width, height: m.height, size: m.size })}
                onMouseEnter={e => e.currentTarget.querySelector('video')?.play().catch(() => {})} onMouseLeave={e => e.currentTarget.querySelector('video')?.pause()}>
                {(m.kind === 'gif' || m.kind === 'image') && <img src={m.preview || m.url} alt="" loading="lazy" />}
                {m.kind === 'video' && <><video src={`${m.url}#t=0.1`} muted loop playsInline preload="metadata" /><span className="vc-saved-play"><Play size={14} /></span></>}
                {m.kind === 'audio' && <span className="vc-saved-audio"><Music size={22} /><small>{m.name}</small></span>}
                {m.kind === 'gif' && <GifBadge />}
                {m.size ? <span className="vc-saved-size">{fmtSize(m.size)}</span> : null}
              </button>
              <button type="button" className="vc-saved-x" title={m.upload ? 'Delete from your Velora storage' : 'Remove from Saved Media'} onClick={() => remove(m)}><X size={12} /></button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// keep the picker inside the window
export function usePickerPlacement(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.left < 8) el.style.transform = `translateX(${8 - r.left}px)`;
  });
}
