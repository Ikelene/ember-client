// Click a sticker in a message: its name, where it came from (the Ember server whose sticker it is, or whose personal
// sticker it is), and Clone to server (a server of yours that has stickers = an Ember server where you have Manage server)
// + Add to personal stickers. Right-click has the same two choices (stickerMenuItems).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Sticker, Lock, History } from 'lucide-react';
import { ServerIcon, serverMenuIcon } from './ServerIcon.jsx';
import { apiFetch } from '../api.js';
import { go, getState, toast } from './store.js';
import { isInst } from './ids.js';
import { cloneTargets } from './cloneEmoji.js';
import { addSticker, savePersonalSticker, isMyPersonalSticker, LOCK_TOAST } from './personal.js';
import { stickerLock, stickerLockNow, rememberLock, LOCK_HINT, originLabel } from './cloneLock.js';
import { Avatar } from './Profile.jsx';
import { openMenu } from './Menu.jsx';

// s = { tid?, psid?, name, url, animated }; sid = the Ember server a server sticker belongs to (the message's server)
export const openStickerInfo = (s, sid, el) => dispatchEvent(new CustomEvent('vc-sticker-info', { detail: { s, sid: sid || null, rect: el.getBoundingClientRect() } }));

// only Ember servers have stickers
const stickerTargets = () => cloneTargets().filter(x => isInst(x.sid));

// s, fromSid: the sticker and the server it belongs to (null for a personal one); sid: where it goes
export async function cloneSticker(s, sid, fromSid = null) {
  const lock = await stickerLockNow(s, fromSid);
  if (lock) { toast(LOCK_TOAST[lock]); return; }
  const from = new URL(s.url, location.href).href;
  try {
    const res = await fetch(from, { credentials: 'omit' });
    if (!res.ok) throw new Error('gone');
    const blob = await res.blob();
    const gif = s.animated || blob.type === 'image/gif';
    const name = String(s.name || 'sticker').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) || 'sticker';
    if (!(await addSticker(sid, new File([blob], `${name}.${gif ? 'gif' : 'png'}`, { type: blob.type || 'image/png' }), name, from))) return;
    const srv = getState().servers.find(x => x.sid === sid);
    toast(`Added ${name} to ${srv?.name || 'your server'}'s stickers.`, true);
  } catch { toast("Couldn't get that sticker's picture."); }
}

const mine = s => !!s.psid && isMyPersonalSticker(s.psid);

// right-click: Clone to server (your Ember servers as a submenu) + Add to personal stickers. sid: the server a server sticker is from
export function stickerMenuItems(s, sid = null) {
  const targets = stickerTargets();
  const lock = stickerLock(s, sid);
  if (lock) return [
    { label: 'Clone to server', icon: Lock, disabled: true, hint: LOCK_HINT[lock] },
    getState().signedIn && { label: 'Add to personal stickers', icon: Lock, disabled: true, hint: LOCK_HINT[lock] },
  ].filter(Boolean);
  return [
    targets.length
      ? { label: 'Clone to server', icon: Copy, sub: targets.map(x => ({ label: x.name, icon: serverMenuIcon(x), onClick: () => cloneSticker(s, x.sid, sid) })) }
      : { label: 'Clone to server', icon: Copy, disabled: true, hint: 'Needs Manage server on an Ember server' },
    getState().signedIn && { label: mine(s) ? 'In your personal stickers' : 'Add to personal stickers', icon: Sticker, disabled: mine(s), onClick: () => savePersonalSticker(s, sid) },
  ].filter(Boolean);
}

export function StickerInfoHost() {
  const [info, setInfo] = useState(null); // { s, sid, rect }
  const [owner, setOwner] = useState(null); // a personal sticker's owner { username, pfp } (false = not found)
  const [pOrigin, setPOrigin] = useState(null); // a personal one's origin (a server sticker carries its own: s.origin)
  const box = useRef(null);
  useEffect(() => {
    const on = e => {
      const d = e.detail;
      setInfo(d); setOwner(null); setPOrigin(null);
      if (d.s.psid) apiFetch(`/chat/personal-stickers/${encodeURIComponent(d.s.psid)}/info`).then(x => { rememberLock(`s:${d.s.psid}`, !!x.locked); setOwner(x.owner || false); setPOrigin(x.origin || null); }).catch(() => setOwner(false));
    };
    addEventListener('vc-sticker-info', on);
    return () => removeEventListener('vc-sticker-info', on);
  }, []);
  useEffect(() => {
    if (!info) return undefined;
    const off = e => { if (box.current && !box.current.contains(e.target)) setInfo(null); };
    const key = e => { if (e.key === 'Escape') setInfo(null); };
    const t = setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', key);
    addEventListener('resize', () => setInfo(null), { once: true });
    return () => { clearTimeout(t); removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [info]);
  if (!info) return null;
  const { s, sid, rect: r } = info;
  const srv = sid ? getState().servers.find(x => x.sid === sid) : null;
  const below = innerHeight - r.bottom > 280;
  const style = { left: Math.max(8, Math.min(r.left + r.width / 2 - 150, innerWidth - 308)), ...(below ? { top: r.bottom + 8 } : { bottom: innerHeight - r.top + 8 }) };
  const targets = stickerTargets();
  const signedIn = !!getState().signedIn;
  // a personal one: known once its owner answered (owner !== null)
  const lock = s.psid && owner === null ? null : stickerLock(s, sid);
  const origin = s.psid ? pOrigin : s.origin || null; // a copy: where it was first seen
  return createPortal(
    <div className="vc-eminfo vc-stkinfo vl-rise" ref={box} style={style}>
      <div className="vc-eminfo-top">
        <img className="vc-eminfo-big" src={s.url} alt="" />
        <div className="vc-eminfo-txt">
          <b>{s.name || 'sticker'}</b>
          <small>{s.psid ? 'Personal sticker' : 'Server sticker'}{s.animated ? ' · animated' : ''}</small>
        </div>
      </div>
      {s.psid && owner && (
        <div className="vc-eminfo-srv vc-eminfo-owner">
          <Avatar user={{ username: owner.username, pfp: owner.pfp }} size={28} />
          <div className="grow"><b>{owner.username}</b><small>{mine(s) ? 'Your personal sticker' : 'Their personal sticker'}</small></div>
        </div>
      )}
      {s.psid && owner === false && <div className="vc-eminfo-srv"><div className="grow"><small>Its owner deleted it from their stickers.</small></div></div>}
      {!s.psid && (
        <div className="vc-eminfo-srv">
          <span className="vc-srv-ico"><ServerIcon src={srv?.icon} name={srv?.name || 'Server'} /></span>
          <div className="grow"><b>{srv?.name || 'An Ember server'}</b><small>From this server&apos;s stickers</small></div>
          {srv && <button type="button" className="btn btn-surface btn-sm" onClick={() => { setInfo(null); go({ kind: 'server', sid: srv.sid }); }}>Open</button>}
        </div>
      )}
      {origin && <div className="vc-eminfo-origin"><History size={13} /><span>Originally from <b>{originLabel(origin)}</b>{origin.type === 'server' && origin.host ? <small> {origin.host}</small> : null}</span></div>}
      {lock && owner !== false && (targets.length > 0 || signedIn) && <div className="vc-eminfo-lock"><Lock size={13} /><span>{lock === 'owner' ? 'Its owner locked their stickers, so it can\'t be cloned or added.' : 'This server doesn\'t allow copying its stickers.'}</span></div>}
      {!lock && (targets.length > 0 || (signedIn && !mine(s))) && (
        <div className="vc-eminfo-acts">
          {targets.length > 0 && <button type="button" className="btn btn-surface btn-sm" onClick={e => openMenu(e, targets.map(x => ({ label: x.name, icon: serverMenuIcon(x), onClick: () => { setInfo(null); cloneSticker(s, x.sid, sid); } })))}><Copy size={14} /> Clone to server</button>}
          {signedIn && !mine(s) && <button type="button" className="btn btn-surface btn-sm" onClick={() => { setInfo(null); savePersonalSticker(s, sid); }}><Sticker size={14} /> Add to personal</button>}
        </div>
      )}
    </div>,
    document.body,
  );
}
