// Click a sticker in a message: its name, where it came from (the Ember server whose sticker it is, or whose personal
// sticker it is), and Clone to server (a server of yours that has stickers = an Ember server where you have Manage server)
// + Add to personal stickers. Right-click has the same two choices (stickerMenuItems).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Sticker, Lock, History } from 'lucide-react';
import { ServerIcon } from './ServerIcon.jsx';
import { serverMenuIcon } from './serverMenuIcon.jsx';
import { apiFetch } from '../api.js';
import { go, getState } from './store.js';
import { savePersonalSticker } from './personal.js';
import { stickerLock, rememberLock, originLabel } from './cloneLock.js';
import { Avatar } from './Profile.jsx';
import { openMenu } from './menus.js';
import { stickerTargets, mine, cloneSticker } from './stickerInfo.js';

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
