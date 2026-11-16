// Click an emoji in a message: its name, and for a custom one the server it's from (join it if it's in Discover).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Lock, Copy, SmilePlus, History } from 'lucide-react';
import { emojiLock, rememberLock, originLabel } from './cloneLock.js';
import { serverMenuIcon } from './ServerIcon.jsx';
import { apiFetch } from '../api.js';
import { go, loadServersOf, toast, errorText, customEmoji, getState } from './store.js';
import { instOpt } from './ids.js';
import { Twemoji, nameOfChar } from './emoji.jsx';
import { emojiDataSync, loadEmojiData } from './EmojiPicker.jsx';
import { cloneTargets, cloneEmoji } from './cloneEmoji.js';
import { addPersonalFromEmoji, isPersonalEmoji } from './personal.js';
import { Avatar } from './Profile.jsx';
import { openMenu } from './Menu.jsx';

export function EmojiInfoHost() {
  const [info, setInfo] = useState(null); // { char } | { eid, name, animated, server? } + rect
  const [srv, setSrv] = useState(null);
  const [owner, setOwner] = useState(null); // a personal emoji's owner { username, pfp }
  const [external, setExternal] = useState(null); // one a Discord / Fluxer bridge brought in: { platform, server }
  const [origin, setOrigin] = useState(null); // a copy: where it was first seen ({ type: 'user', username } | { type: 'server', name, host })
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    const on = e => {
      const d = e.detail;
      setInfo(d); setSrv(null); setOwner(null); setOrigin(null); setExternal(null);
      // an instance's emoji is asked about on that instance (the one whose emoji list has it), the rest (personal emojis) on Nookara
      const from = getState().emojis?.find(sv => sv.emojis?.some(x => x.eid === d.eid))?.sid;
      // (one in none of my lists - a bridge brought it in, say - is asked about where its message lives)
      const where = instOpt(from) || (d.inst && d.inst !== 'velora' ? d.inst : undefined);
      if (d.eid) apiFetch(`/chat/emojis/${encodeURIComponent(d.eid)}/info`, { inst: where }).then(x => { if (x.personal) rememberLock(`e:${d.eid}`, !!x.personal.locked); setSrv(x.server || false); setOwner(x.personal?.owner || null); setExternal(x.external || null); setOrigin(x.personal?.origin || x.origin || null); }).catch(() => setSrv(false));
      else if (!emojiDataSync()) loadEmojiData().then(() => setInfo(x => (x ? { ...x } : x)));
    };
    addEventListener('vc-emoji-info', on);
    return () => removeEventListener('vc-emoji-info', on);
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
  const r = info.rect;
  const below = innerHeight - r.bottom > 240; // (room for the popup under it: it got taller with the bigger emoji)
  const style = { left: Math.max(8, Math.min(r.left + r.width / 2 - 150, innerWidth - 308)), ...(below ? { top: r.bottom + 8 } : { bottom: innerHeight - r.top + 8 }) };
  const name = info.eid ? info.name : nameOfChar(info.char, emojiDataSync());
  // locked: its owner locked their personal emojis, or its Ember server doesn't allow copying (known once the info answered)
  const lock = info.eid && srv !== null ? emojiLock(info) : null;
  async function join() {
    setBusy(true);
    try { await apiFetch(`/chat/servers/${srv.sid}/join`, { method: 'POST', body: JSON.stringify({}) }); await loadServersOf(srv.sid); setInfo(null); go({ kind: 'server', sid: srv.sid }); }
    catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  return createPortal(
    <div className="vc-eminfo vl-rise" ref={box} style={style}>
      <div className="vc-eminfo-top">
        {info.eid ? <img className="vc-eminfo-big" src={customEmoji(info.eid, info.animated)} alt="" /> : <Twemoji char={info.char} className="vc-eminfo-big" />}
        <div className="vc-eminfo-txt">
          <b>{name ? `:${name}:` : info.char}</b>
          <small>{!info.eid ? 'A standard emoji' : owner || isPersonalEmoji(info.eid) ? 'Personal emoji' : 'Custom server emoji'}</small>
        </div>
      </div>
      {info.eid && srv && (
        <div className="vc-eminfo-srv">
          <span className="vc-srv-ico">{srv.icon ? <img src={srv.icon} alt="" /> : srv.name.slice(0, 2)}</span>
          <div className="grow"><b>{srv.name}</b><small>{srv.discoverable ? <><Users size={11} /> {srv.member_count} members</> : <><Lock size={11} /> Invite only</>}</small></div>
          {srv.joined ? <button type="button" className="btn btn-surface btn-sm" onClick={() => { setInfo(null); go({ kind: 'server', sid: srv.sid }); }}>Open</button>
            : srv.discoverable ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={join}>Join</button> : null}
        </div>
      )}
      {info.eid && owner && (
        <div className="vc-eminfo-srv vc-eminfo-owner">
          <Avatar user={{ username: owner.username, pfp: owner.pfp }} size={28} />
          <div className="grow"><b>{owner.username}</b><small>Their personal emoji</small></div>
        </div>
      )}
      {info.eid && external && <div className="vc-eminfo-origin"><History size={13} /><span>From <b>{external.platform}</b>{external.server ? <small> {external.server}</small> : null}</span></div>}
      {info.eid && origin && <div className="vc-eminfo-origin"><History size={13} /><span>Originally from <b>{originLabel(origin)}</b>{origin.type === 'server' && origin.host ? <small> {origin.host}</small> : null}</span></div>}
      {lock && (cloneTargets().length > 0 || getState().signedIn) && <div className="vc-eminfo-lock"><Lock size={13} /><span>{lock === 'owner' ? 'Its owner locked their emojis, so it can\'t be cloned or added.' : 'This server doesn\'t allow copying its emojis.'}</span></div>}
      {info.eid && !lock && (cloneTargets().length > 0 || (getState().signedIn && !isPersonalEmoji(info.eid))) && (
        <div className="vc-eminfo-acts">
          {cloneTargets().length > 0 && <button type="button" className="btn btn-surface btn-sm" onClick={e => { const emoji = { eid: info.eid, name: info.name, animated: info.animated }; openMenu(e, cloneTargets().map(x => ({ label: x.name, icon: serverMenuIcon(x), onClick: () => { setInfo(null); cloneEmoji(emoji, x.sid); } }))); }}><Copy size={14} /> Clone emoji</button>}
          {getState().signedIn && !isPersonalEmoji(info.eid) && <button type="button" className="btn btn-surface btn-sm" onClick={() => { const emoji = { eid: info.eid, name: info.name, animated: info.animated }; setInfo(null); addPersonalFromEmoji(emoji); }}><SmilePlus size={14} /> Add to personal</button>}
        </div>
      )}
    </div>,
    document.body,
  );
}
