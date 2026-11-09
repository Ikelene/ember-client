// Settings > Personal emojis (your Nookara account) and Server settings > Stickers (an Ember server). personal.js does the calls.
import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { useChat } from './store.js';
import { loadPersonalEmojis, addPersonalEmoji, renamePersonalEmoji, deletePersonalEmoji, loadStickers, addSticker, renameSticker, deleteSticker } from './personal.js';

function ItemRow({ url, name, animated, onRename, onDelete, big }) {
  return (
    <div className={`vc-emoji-row${big ? ' vc-sticker-row' : ''}`}>
      <img src={url} alt="" />
      {!big && <span className="vc-emoji-colon">:</span>}
      <input className="form-input" defaultValue={name} maxLength={32} onBlur={ev => { const v = ev.target.value.trim(); if (v && v !== name) onRename(v); }} aria-label="Name" />
      {!big && <span className="vc-emoji-colon">:</span>}
      {animated && <small className="vc-chip">animated</small>}
      <button type="button" className="vc-ico-btn" title="Delete" onClick={onDelete}><Trash2 size={15} /></button>
    </div>
  );
}

export function PersonalEmojisPage() {
  const box = useChat(s => s.personalEmojis);
  const [busy, setBusy] = useState(0);
  const file = useRef(null);
  useEffect(() => { loadPersonalEmojis(); }, []);
  const list = box?.list || null;
  const full = !!list && list.length >= (box?.max || 25);
  async function add(files) {
    for (const f of [...files].slice(0, 20)) { setBusy(n => n + 1); await addPersonalEmoji(f, undefined, { quiet: true }); setBusy(n => n - 1); }
  }
  return (
    <div className="vc-emoji-man">
      <p className="vc-dialog-sub">Your personal emojis live on your Nookara account, so you can use them on any Ember server, in DMs and in group chats, from any app signed in as you. Only you have them in your picker; anyone can clone one to their own server or personal emojis. PNG, JPG, WebP or GIF, up to 2 MB. {list ? `${list.length} / ${box.max} used${box.max < box.pro_max ? ` (${box.pro_max} with Pro)` : ''}.` : ''}</p>
      <button type="button" className="btn btn-primary" disabled={busy > 0 || full || !list} onClick={() => file.current?.click()}><Upload size={14} /> {busy ? 'Uploading...' : 'Add emoji'}</button>
      <input ref={file} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { add(e.target.files); e.target.value = ''; }} />
      <div className="vc-emoji-list" data-drop-own onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}>
        {!list && <div className="vc-loading"><i /><i /><i /></div>}
        {list && !list.length && <div className="vc-empty-note">No personal emojis yet. Add one here, or right-click any custom emoji and pick Add to personal emojis.</div>}
        {list?.map(e => <ItemRow key={e.eid} url={e.url} name={e.name} animated={e.animated} onRename={v => renamePersonalEmoji(e.eid, v)} onDelete={() => deletePersonalEmoji(e.eid)} />)}
      </div>
    </div>
  );
}

export function StickerManager({ sid }) {
  const box = useChat(s => s.stickers?.[sid]);
  const [busy, setBusy] = useState(0);
  const file = useRef(null);
  useEffect(() => { loadStickers(sid); }, [sid]);
  const list = box?.list || null;
  const max = box?.max || 30;
  async function add(files) {
    for (const f of [...files].slice(0, 10)) { setBusy(n => n + 1); await addSticker(sid, f); setBusy(n => n - 1); }
  }
  return (
    <div className="vc-emoji-man">
      <p className="vc-dialog-sub">Stickers are big pictures people can send on their own from the Stickers tab of the emoji picker. PNG, GIF or WebP (animated ones stay animated), up to 512 KB; they show at about 160 px. {list ? `${list.length} / ${max} used.` : ''}</p>
      <button type="button" className="btn btn-primary" disabled={busy > 0 || !list || list.length >= max} onClick={() => file.current?.click()}><Upload size={14} /> {busy ? 'Uploading...' : 'Upload sticker'}</button>
      <input ref={file} type="file" multiple hidden accept="image/png,image/gif,image/webp" onChange={e => { add(e.target.files); e.target.value = ''; }} />
      <div className="vc-emoji-list" data-drop-own onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}>
        {!list && <div className="vc-loading"><i /><i /><i /></div>}
        {list && !list.length && <div className="vc-empty-note">No stickers yet.</div>}
        {list?.map(s => <ItemRow key={s.tid} big url={s.url} name={s.name} animated={s.animated} onRename={v => renameSticker(sid, s.tid, v)} onDelete={() => deleteSticker(sid, s.tid)} />)}
      </div>
    </div>
  );
}
