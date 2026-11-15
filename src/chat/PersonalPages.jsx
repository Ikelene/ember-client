// Settings > Personal emojis + Personal stickers (your Nookara account) and Server settings > Stickers (an Ember server).
// personal.js does the calls.
import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { useChat, toast, errorText, refreshServer, loadEmojis } from './store.js';
import { apiFetch } from '../api.js';
import { isInst } from './ids.js';
import { Toggle } from './roles.jsx';
import { imgHint, warnImage } from './imgHints.js';
import { loadPersonalEmojis, addPersonalEmoji, renamePersonalEmoji, deletePersonalEmoji, loadStickers, addSticker, renameSticker, deleteSticker, loadPersonalStickers, addPersonalSticker, renamePersonalSticker, deletePersonalSticker } from './personal.js';

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
    for (const f of [...files].slice(0, 20)) { warnImage(f, 'personalEmoji'); setBusy(n => n + 1); await addPersonalEmoji(f, undefined, { quiet: true }); setBusy(n => n - 1); }
  }
  return (
    <div className="vc-emoji-man">
      <p className="vc-dialog-sub">Your personal emojis live on your Nookara account, so you can use them on any Ember server, in DMs and in group chats, from any app signed in as you. Only you have them in your picker; anyone can clone one to their own server or personal emojis. {imgHint('personalEmoji')} {list ? `${list.length} / ${box.max} used${box.max < box.pro_max ? ` (${box.pro_max} with Pro)` : ''}.` : ''}</p>
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

export function PersonalStickersPage() {
  const box = useChat(s => s.personalStickers);
  const [busy, setBusy] = useState(0);
  const file = useRef(null);
  useEffect(() => { loadPersonalStickers(); }, []);
  const list = box?.list || null;
  const full = !!list && list.length >= (box?.max || 10);
  async function add(files) {
    for (const f of [...files].slice(0, 10)) { warnImage(f, 'personalSticker'); setBusy(n => n + 1); await addPersonalSticker(f, undefined, { quiet: true }); setBusy(n => n - 1); }
  }
  return (
    <div className="vc-emoji-man">
      <p className="vc-dialog-sub">Your personal stickers live on your Nookara account, so you can send them anywhere: Ember servers, DMs and group chats, from the Stickers tab of the emoji picker. A sticker is sent as its picture link, so other apps show it as a picture. Anyone can save one you sent to their own stickers. {imgHint('personalSticker')} {list ? `${list.length} / ${box.max} used${box.max < box.pro_max ? ` (${box.pro_max} with Pro)` : ''}.` : ''}</p>
      <button type="button" className="btn btn-primary" disabled={busy > 0 || full || !list} onClick={() => file.current?.click()}><Upload size={14} /> {busy ? 'Uploading...' : 'Add sticker'}</button>
      <input ref={file} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { add(e.target.files); e.target.value = ''; }} />
      <div className="vc-emoji-list" data-drop-own onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}>
        {!list && <div className="vc-loading"><i /><i /><i /></div>}
        {list && !list.length && <div className="vc-empty-note">No personal stickers yet. Add one here, or right-click any sticker in a chat and pick Save to my stickers.</div>}
        {list?.map(s => <ItemRow key={s.sid} big url={s.url} name={s.name} animated={s.animated} onRename={v => renamePersonalSticker(s.sid, v)} onDelete={() => deletePersonalSticker(s.sid)} />)}
      </div>
    </div>
  );
}

// Ember servers: Server settings > Emojis / Stickers > "Allow cloning server emojis & stickers" (settings emojis.allow_cloning, on
// by default). Off = other servers and people's personal emojis/stickers can't copy them (cloneLock.js); the owner and admins still can.
export function CloneSetting({ sid }) {
  const [on, setOn] = useState(null); // null = not loaded
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isInst(sid)) return undefined;
    let off = false;
    setOn(null);
    apiFetch(`/chat/servers/${sid}/settings`).then(d => { if (!off) setOn(d.settings?.emojis?.allow_cloning !== false); }).catch(() => { if (!off) setOn(true); });
    return () => { off = true; };
  }, [sid]);
  if (!isInst(sid) || on === null) return null;
  async function flip(next) {
    setBusy(true);
    try {
      const d = await apiFetch(`/chat/servers/${sid}/settings`, { method: 'PATCH', body: JSON.stringify({ emojis: { allow_cloning: next } }) });
      setOn(d.settings?.emojis?.allow_cloning !== false); refreshServer(sid); loadEmojis();
    } catch (e) { toast(e.message === 'invalid_emojis' ? 'This server needs an update before it has this setting.' : errorText(e.message)); }
    setBusy(false);
  }
  return <Toggle label="Allow cloning server emojis & stickers" hint={on ? 'On: anyone can copy them to their own server or personal emojis and stickers.' : 'Off: only this server\'s owner and admins can copy them somewhere else.'} on={on} disabled={busy} onChange={flip} />;
}

export function StickerManager({ sid }) {
  const box = useChat(s => s.stickers?.[sid]);
  const [busy, setBusy] = useState(0);
  const file = useRef(null);
  useEffect(() => { loadStickers(sid); }, [sid]);
  const list = box?.list || null;
  const max = box?.max || 30;
  async function add(files) {
    for (const f of [...files].slice(0, 10)) { warnImage(f, 'sticker', true); setBusy(n => n + 1); await addSticker(sid, f); setBusy(n => n - 1); }
  }
  return (
    <div className="vc-emoji-man">
      <p className="vc-dialog-sub">Stickers are big pictures people can send on their own from the Stickers tab of the emoji picker. {imgHint('sticker', true)} They show at about 160 px. {list ? `${list.length} / ${max} used.` : ''}</p>
      <CloneSetting sid={sid} />
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
