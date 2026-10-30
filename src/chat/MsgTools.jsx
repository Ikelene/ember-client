// Forwarding messages (to a DM, group chat or channel) and the pinned-messages panel.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Hash, UsersRound, Pin, X, Forward } from 'lucide-react';
import { apiFetch } from '../api.js';
import { instOpt } from './ids.js';
import { useChat, getState, sendMessage, refreshServer, toast, errorText } from './store.js';
import { Dialog } from './Dialogs.jsx';
import { Avatar } from './Profile.jsx';
import { ChannelIcon, P, has } from './roles.jsx';
import { decodeRoleMentions } from './Mentions.jsx';
import { renderBody, stampOf } from './text.jsx';
import { GameInvites } from './GameInvite.jsx';
import { AliasMark, aliasOf, aliasFace, shownName } from './Alias.jsx';

// ── forwarding ──
// the forwarded copy says where it came from; @everyone / @here inside it never ping again
function forwardText(m, from) {
  const st = getState();
  let where = '';
  if (from.kind === 'channel') { const d = st.detail[from.sid]; const c = d?.channels.find(x => x.cid === from.cid); if (c) where = ` in #${c.name}${d ? ` (${d.server.name})` : ''}`; }
  else if (from.kind === 'group') where = ` in ${st.groups.find(g => g.room === from.room)?.name || 'a group chat'}`;
  const body = (from.kind === 'channel' ? decodeRoleMentions(m.body || '', from.sid) : String(m.body || ''))
    .replace(/@(everyone|here)\b/g, '@​$1');
  return `-# Forwarded from @${m.author?.username || 'Nookara'}${where}\n${body}`.trim();
}
export function ForwardDialog({ message, from, onClose }) {
  const dms = useChat(s => s.dms);
  const friends = useChat(s => s.friends);
  const groups = useChat(s => s.groups);
  const servers = useChat(s => s.servers);
  const detail = useChat(s => s.detail);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState({});
  // channel lists for every server (so you can forward anywhere you can post)
  useEffect(() => { getState().servers.filter(s => !getState().detail[s.sid]).slice(0, 20).forEach(s => refreshServer(s.sid)); }, []);
  const targets = useMemo(() => {
    const out = [];
    const seen = new Set();
    [...dms.map(c => c.username), ...friends.map(f => f.friend_username)].forEach(u => {
      if (u === 'System' || seen.has(u.toLowerCase())) return;
      seen.add(u.toLowerCase());
      out.push({ key: `d:${u}`, label: u, hint: 'Direct message', v: { kind: 'dm', username: u }, user: { username: u, pfp: getState().people[u]?.pfp } });
    });
    groups.forEach(g => out.push({ key: `g:${g.room}`, label: g.name, hint: 'Group chat', v: { kind: 'group', room: g.room }, group: true }));
    servers.forEach(s => (detail[s.sid]?.channels || []).filter(c => c.can_post !== false && ['text', 'welcome', undefined].includes(c.type) && (!c.locked || has(detail[s.sid].server.perms, P.MANAGE_MESSAGES)))
      .forEach(c => out.push({ key: `c:${c.cid}`, label: c.name, hint: s.name, v: { kind: 'channel', sid: s.sid, cid: c.cid }, channel: c })));
    const t = q.trim().toLowerCase();
    return (t ? out.filter(x => x.label.toLowerCase().includes(t) || x.hint.toLowerCase().includes(t)) : out).slice(0, 60);
  }, [dms, friends, groups, servers, detail, q]);
  function send(t) {
    sendMessage(t.v, forwardText(message, from), { attachments: message.attachments || [] });
    if (note.trim()) sendMessage(t.v, note.trim());
    setSent(x => ({ ...x, [t.key]: true }));
  }
  return (
    <Dialog title="Forward message" onClose={onClose}>
      {close => (
        <>
          <div className="vc-fwd-preview">
            <span className="vc-fwd-from"><Forward size={13} /> {message.author?.username || 'Nookara'}</span>
            <FwdBody body={message.body || (message.attachments?.length ? '(attachment)' : '')} />
          </div>
          <input className="form-input" maxLength={2000} placeholder="Add a message (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <label className="vc-search"><Search size={15} /><input autoFocus placeholder="Where to? Search people, groups and channels" value={q} onChange={e => setQ(e.target.value)} /></label>
          <div className="vc-fwd-list">
            {targets.map(t => (
              <div key={t.key} className="vc-fwd-row">
                {t.user ? <Avatar user={t.user} size={28} /> : t.group ? <span className="vc-fwd-ico"><UsersRound size={16} /></span> : <span className="vc-fwd-ico"><ChannelIcon c={t.channel} size={16} /></span>}
                <span className="vc-fwd-txt"><b>{t.channel ? `#${t.label}` : t.label}</b><small>{t.hint}</small></span>
                <button type="button" className={`btn btn-sm ${sent[t.key] ? 'btn-surface' : 'btn-primary'}`} disabled={sent[t.key]} onClick={() => send(t)}>{sent[t.key] ? 'Sent' : 'Send'}</button>
              </div>
            ))}
            {!targets.length && <div className="vc-empty-note">Nowhere matches that.</div>}
          </div>
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Done</button></div>
        </>
      )}
    </Dialog>
  );
}

// ── pinned messages (channel header button) ──
export function PinsButton({ channel, sid }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const f = () => setOpen(true); addEventListener('vc-open-pins', f); return () => removeEventListener('vc-open-pins', f); }, []);
  useEffect(() => { setOpen(false); }, [channel.cid]);
  return (
    <span className="vc-pins-wrap">
      <button type="button" className={`vc-ico-btn${open ? ' on' : ''}`} title="Pinned messages" onClick={() => setOpen(o => !o)}><Pin size={18} /></button>
      {open && <PinsPanel channel={channel} sid={sid} onClose={() => setOpen(false)} />}
    </span>
  );
}
function PinsPanel({ channel, sid, onClose }) {
  const [list, setList] = useState(null);
  const ver = useChat(s => s.pinsVersion[channel.cid] || 0);
  const canMod = useChat(s => has(s.detail[sid]?.server.perms, P.MANAGE_MESSAGES));
  const box = useRef(null);
  useEffect(() => { apiFetch(`/chat/channels/${channel.cid}/pins`).then(d => setList(d.messages)).catch(() => setList([])); }, [channel.cid, ver]);
  useEffect(() => {
    const off = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vc-pins-wrap')) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [onClose]);
  const jump = m => {
    const el = document.querySelector(`.vc-msg[data-id="${m.id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); onClose(); }
    else toast("That message is further up - scroll up to load it.");
  };
  return (
    <div className="vc-pins" ref={box}>
      <div className="vc-pins-head"><Pin size={15} /> <b>Pinned messages</b><span className="grow" /><button type="button" className="vc-ico-btn" onClick={onClose} title="Close"><X size={15} /></button></div>
      <div className="vc-pins-list">
        {list === null && <div className="vc-loading"><i /><i /><i /></div>}
        {list?.length === 0 && <div className="vc-empty-note">Nothing pinned in #{channel.name} yet.{canMod ? ' Right-click a message and pick Pin message.' : ''}</div>}
        {list?.map((m, i) => (
          <div key={m.id} className="vc-pin vl-rise" style={{ '--i': Math.min(i, 10) }}>
            <div className="vc-pin-top">
              {m.author && <Avatar user={aliasFace(aliasOf(m), m.author)} size={22} />}
              <b>{shownName(m)}</b>{aliasOf(m) && <AliasMark alias={aliasOf(m)} by={m.author} size={12} />}
              <small>{stampOf(m.created_at)}</small>
              <span className="grow" />
              <button type="button" className="vc-pin-jump" onClick={() => jump(m)}>Jump</button>
              {canMod && <button type="button" className="vc-ico-btn" title="Unpin" onClick={() => apiFetch(`/chat/messages/${m.id}/pin`, { method: 'DELETE', inst: instOpt(m.channel || channel.cid) }).catch(e => toast(errorText(e.message)))}><X size={14} /></button>}
            </div>
            <PinBody body={m.body || (m.attachments?.length ? '(attachment)' : '')} ctx={{ channels: getState().detail[sid]?.channels, roles: getState().detail[sid]?.roles }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// forward preview / pinned list: the text, and a game invite as a button-less card
function FwdBody({ body }) {
  const r = renderBody(body, { linkImages: false });
  return <div className="vc-fwd-body">{r.nodes}<GameInvites invites={r.invites} inert /></div>;
}
function PinBody({ body, ctx }) {
  const r = renderBody(body, ctx);
  return <div className="vc-pin-body">{r.nodes}<GameInvites invites={r.invites} inert /></div>;
}
