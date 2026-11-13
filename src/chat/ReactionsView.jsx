// Who reacted: the little stacked faces on a reaction chip, and the "View Reactions" dialog (right-click a message or a chip).
// Nookara DMs / groups carry every reactor's name; server messages only the first 25, so an Ember server is asked for the
// whole list (GET /messages/:id/reactions, with each person's face). Old Nookara-hosted servers keep the 25 (no new features there).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, lookupMany, useFace } from './store.js';
import { instOpt } from './ids.js';
import { reactionId, reactionBase } from './msg-actions.js';
import { Avatar, useProfiles } from './Profile.jsx';
import { ReactionEmoji, reactionName } from './Reactions.jsx';

// names -> faces: the server's member list when it has them, else Nookara's public profiles (looked up in batches)
export function useNameFaces(names, sid) {
  const people = useChat(s => s.people);
  const members = useChat(s => (sid ? s.members[sid] : null));
  const key = names.join('\n');
  useEffect(() => {
    const miss = names.filter(n => !people[n] && !members?.some(m => m.username === n));
    if (miss.length) lookupMany(miss).catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => names.map(n => {
    const mem = members?.find(m => m.username === n);
    const p = people[n];
    return { username: n, ...(mem || {}), pfp: mem?.pfp || p?.pfp || null, display_name: mem?.display_name || p?.display_name || null };
  }), [key, people, members]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Face({ u, size }) {
  const f = useFace(u);
  return <Avatar user={f} size={size} />;
}

// up to 3 faces; with more people than that the third becomes "+N" (everyone not shown)
export function ReactorFaces({ r, sid }) {
  const names = r.users || [];
  const shown = r.count > 3 ? names.slice(0, 2) : names.slice(0, 3);
  const faces = useNameFaces(shown, sid);
  if (!faces.length) return null;
  return (
    <span className="vc-react-faces" aria-hidden="true">
      {faces.map(u => <Face key={u.username} u={u} size={16} />)}
      {r.count > 3 && <span className="vc-react-more">+{r.count - 2}</span>}
    </span>
  );
}

export function openReactionsView(m, emoji) {
  dispatchEvent(new CustomEvent('vc-reactions-view', { detail: { m, emoji: emoji || null } }));
}

export function ReactionsViewHost() {
  const [at, setAt] = useState(null);
  const { openMini, ui } = useProfiles();
  useEffect(() => {
    const on = e => setAt({ ...e.detail, k: Date.now() });
    addEventListener('vc-reactions-view', on);
    return () => removeEventListener('vc-reactions-view', on);
  }, []);
  return <>{at && <ReactionsDialog key={at.k} m={at.m} first={at.emoji} onClose={() => setAt(null)} onPerson={(u, el) => { const rect = el.getBoundingClientRect(); setAt(null); openMini(u.username, rect, 'right', u.inst ? u : undefined); }} />}{ui}</>;
}

function ReactionsDialog({ m, first, onClose, onPerson }) {
  const inst = instOpt(m.channel);
  const live = useChat(s => {
    for (const b of Object.values(s.msgs)) { const x = b?.list?.find(y => y === m || (y.id === m.id && y.channel === m.channel && y.imId === m.imId && y.gid === m.gid)); if (x) return x.reactions; }
    return null;
  }) || m.reactions || [];
  const [full, setFull] = useState(null); // an Ember server's whole list: [{ emoji, count, users: [person] }]
  const [tab, setTab] = useState(first || 'all');
  const counts = live.map(r => r.count).join(',');
  useEffect(() => {
    if (!inst) return undefined;
    let gone = false;
    apiFetch(`${reactionBase(reactionId(m))}/reactions`, { inst }).then(d => { if (!gone) setFull(d?.reactions || []); }).catch(() => {});
    return () => { gone = true; };
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = full ? live.map(r => ({ ...r, people: full.find(x => x.emoji === r.emoji)?.users?.map(u => ({ ...u, inst })) })) : live;
  const tabs = list.filter(r => r.count > 0);
  const rows = (tab === 'all' ? tabs : tabs.filter(r => r.emoji === tab)).flatMap(r => (r.people || (r.users || []).map(username => ({ username }))).map(u => ({ u, r })));
  const shown = tab === 'all' ? tabs.reduce((n, r) => n + r.count, 0) : tabs.find(r => r.emoji === tab)?.count || 0;
  const missing = Math.max(0, shown - rows.length); // (an old Nookara-hosted server only says who the first 25 were)
  const sid = m.server;
  return createPortal(
    <div className="vc-modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vc-dialog vc-rv" role="dialog" aria-label="Reactions">
        <div className="vc-rv-head"><b>Reactions</b><button type="button" className="vc-ico-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="vc-rv-body">
          <div className="vc-rv-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}><span className="vc-rv-all">All</span><span>{tabs.reduce((n, r) => n + r.count, 0)}</span></button>
            {tabs.map(r => (
              <button type="button" role="tab" key={r.emoji} aria-selected={tab === r.emoji} className={tab === r.emoji ? 'on' : ''} onClick={() => setTab(r.emoji)} title={reactionName(r.emoji, r.emoji_id ? r : null, sid)}>
                <ReactionEmoji emoji={r.emoji} info={r.emoji_id ? r : null} sid={sid} /><span>{r.count}</span>
              </button>
            ))}
          </div>
          <div className="vc-rv-list">
            {rows.map(({ u, r }) => <Person key={`${r.emoji}|${u.id || u.username}`} u={u} r={tab === 'all' ? r : null} sid={sid} onPick={onPerson} />)}
            {missing > 0 && <div className="vc-rv-more">and {missing} more</div>}
            {!rows.length && <div className="vc-rv-more">No reactions.</div>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Person({ u, r, sid, onPick }) {
  const [named] = useNameFaces(u.inst ? [] : [u.username], sid);
  const f = useFace(u.inst ? u : { ...u, ...named });
  const shown = f.display_name || u.display_name || named?.display_name || u.username;
  return (
    <button type="button" className="vc-rv-person" onClick={e => onPick(u, e.currentTarget)}>
      <Avatar user={f} size={32} />
      <span className="vc-rv-names"><b>{shown}</b>{shown !== u.username && <small>@{u.username}</small>}</span>
      {r && <span className="vc-rv-emoji"><ReactionEmoji emoji={r.emoji} info={r.emoji_id ? r : null} sid={sid} /></span>}
    </button>
  );
}

