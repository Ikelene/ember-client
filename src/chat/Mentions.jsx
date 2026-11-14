// Typing @ in the composer: pick a member, a role (that you're allowed to ping) or @everyone / @here.
import { useEffect, useMemo, useState } from 'react';
import { useChat, getState, botPresenceOf } from './store.js';
import { Avatar } from './Profile.jsx';
import { P, has, nameColor, ChannelIcon } from './roles.jsx';
import { loadEmojiData, emojiDataSync, emojiToken } from './EmojiPicker.jsx';
import { loadPersonalEmojis } from './personal.js';
import { shortName, allNames, Twemoji } from './emoji.jsx';
import { personName, displayNameOf, useDisplayNamesVersion, wantDisplayNames, serverOwnName } from './displayNames.js';

// the "@word" right before the caret, if there is one
export function mentionQuery(text, caret) {
  const m = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u.exec(text.slice(0, caret)); // (letters of any language: display names match too)
  return m ? { q: m[2], start: caret - m[2].length - 1 } : null;
}

// what's being typed right before the caret: @someone, :emoji or #channel
export function suggestQuery(text, caret) {
  const b = text.slice(0, caret);
  let m = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u.exec(b);
  if (m) return { ch: '@', q: m[2] };
  m = /(^|\s):([A-Za-z0-9_+-]{2,32})$/.exec(b);
  if (m) return { ch: ':', q: m[2] };
  m = /(^|\s)#([a-z0-9_-]{0,40})$/.exec(b);
  if (m) return { ch: '#', q: m[2] };
  return null;
}
export function useSuggestItems(view, sq) {
  const users = useMentionItems(view, sq?.ch === '@' ? sq.q : null);
  const emojis = useEmojiItems(sq?.ch === ':' ? sq.q : null);
  const chans = useChannelItems(view, sq?.ch === '#' ? sq.q : null);
  return sq?.ch === ':' ? emojis : sq?.ch === '#' ? chans : users;
}
function useEmojiItems(q) {
  const custom = useChat(s => s.emojis);
  const personal = useChat(s => s.personalEmojis?.list); // your personal emojis (usable anywhere), listed first
  const [data, setData] = useState(emojiDataSync);
  useEffect(() => { if (q != null && !data) loadEmojiData().then(setData); }, [q, data]);
  useEffect(() => { if (q != null && !getState().personalEmojis) loadPersonalEmojis(); }, [q]);
  return useMemo(() => {
    if (q == null) return [];
    const t = q.toLowerCase();
    const rank = n => (n.startsWith(t) ? 0 : 1);
    const seen = new Set();
    const cus = [...(personal || []).map(e => ({ ...e, server: 'Personal emoji' })), ...(custom || []).flatMap(s => s.emojis.map(e => ({ ...e, server: s.name })))]
      .filter(e => e.name.toLowerCase().includes(t) && !seen.has(e.eid) && seen.add(e.eid))
      .sort((a, b) => rank(a.name.toLowerCase()) - rank(b.name.toLowerCase())).slice(0, 6)
      .map(e => ({ kind: 'emoji', key: e.eid, label: `:${e.name}:`, token: emojiToken(e), img: e.url, hint: e.server }));
    const words = t.replace(/_/g, ' ');
    // Discord-style names first (:sob:), then the long names and tags
    const best = e => Math.min(...allNames(e).map(n => (n === t ? 0 : n.startsWith(t) ? 1 : n.includes(t) ? 2 : 9)), e[1].startsWith(words) ? 3 : e[1].includes(words) ? 4 : 9);
    const uni = (data || []).map(e => [e, best(e)]).filter(([e, r]) => r < 9 || String(e[3] || '').includes(t))
      .sort((a, b) => a[1] - b[1] || shortName(a[0]).length - shortName(b[0]).length).slice(0, 10 - cus.length)
      .map(([e]) => ({ kind: 'emoji', key: e[0], label: `:${shortName(e)}:`, token: e[0], char: e[0] }));
    return [...cus, ...uni];
  }, [q, custom, personal, data]);
}
function useChannelItems(view, q) {
  const list = useChat(s => (view.kind === 'channel' ? s.detail[view.sid]?.channels : null));
  return useMemo(() => {
    if (q == null || !list) return [];
    const t = q.toLowerCase();
    return list.filter(c => c.name.includes(t)).sort((a, b) => (b.name.startsWith(t) - a.name.startsWith(t)) || a.position - b.position).slice(0, 10)
      .map(c => ({ kind: 'channel', key: c.cid, label: c.name, token: `#${c.name}`, channel: c, hint: c.category || '' }));
  }, [q, list]);
}

export function useMentionItems(view, q) {
  const sid = view.kind === 'channel' ? view.sid : null;
  const members = useChat(s => (sid ? s.members[sid] : null));
  const detail = useChat(s => (sid ? s.detail[sid] : null));
  const group = useChat(s => (view.kind === 'group' ? s.groups.find(g => g.room === view.room) : null));
  const people = useChat(s => s.people);
  const dnv = useDisplayNamesVersion(); // display names arriving: match + label again
  return useMemo(() => {
    if (q == null) return [];
    const t = q.toLowerCase();
    const out = [];
    let users = [];
    if (sid) users = (members || []).map(m => m);
    else if (view.kind === 'dm') users = [{ username: view.username, ...(people[view.username] || {}) }, { ...getState().me }];
    else if (group) users = group.members.map(u => ({ username: u, ...(people[u] || {}) }));
    const st = getState();
    const online = u => (botPresenceOf(u) || st.presence[u.username]?.status || u.presence?.status || 'offline') !== 'offline';
    // usernames AND display names match (displayNames.js); what goes in is always the stable @username
    wantDisplayNames(users.filter(u => u.username && !serverOwnName(u)).map(u => u.username));
    const dn = u => personName(u, displayNameOf(u.username)) || u.username;
    const words = s => s.toLowerCase().split(/\s+/);
    // 0 starts the username or display name, 1 starts a word of the display name, 2 inside either, 9 no match
    const rank = u => { const un = u.username.toLowerCase(), d = dn(u).toLowerCase(); return un.startsWith(t) || d.startsWith(t) ? 0 : words(d).some(w => w.startsWith(t)) ? 1 : un.includes(t) || d.includes(t) ? 2 : 9; };
    users.filter(u => u.username && rank(u) < 9)
      .sort((a, b) => (rank(a) - rank(b)) || (online(b) - online(a)) || dn(a).localeCompare(dn(b)))
      .slice(0, 8)
      .forEach(u => { const name = dn(u), you = u.username === st.me?.username; out.push({ kind: 'user', key: `u${u.username}`, label: name, insert: `@${u.username} `, user: u, hint: [name !== u.username ? `@${u.username}` : '', you ? 'you' : ''].filter(Boolean).join(' - ') }); });
    if (detail) {
      const big = has(detail.server.perms, P.MENTION_EVERYONE);
      if (big) {
        [['everyone', 'Notify everyone who can see this channel.'], ['here', 'Notify everyone online right now.']]
          .filter(([n]) => n.startsWith(t)).forEach(([n, hint]) => out.push({ kind: 'all', key: n, label: `@${n}`, insert: `@${n} `, hint }));
      }
      (detail.roles || []).filter(r => !r.is_default && (r.mentionable || big) && r.name.toLowerCase().includes(t))
        .sort((a, b) => b.position - a.position).slice(0, 6)
        .forEach(r => out.push({ kind: 'role', key: r.rid, label: `@${r.name}`, insert: `@${r.name} `, role: r, hint: 'Notify people with this role.' }));
    }
    return out;
  }, [q, sid, members, detail, group, people, view.kind, view.username, dnv]);
}

export function MentionPicker({ items, sel, setSel, onPick, sid }) {
  useEffect(() => { if (sel >= items.length) setSel(0); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  let lastKind = null;
  return (
    <div className="vc-mentions" onMouseDown={e => e.preventDefault()}>
      {items.map((it, i) => {
        const head = it.kind !== lastKind ? ({ user: 'Members', all: 'Everyone', role: 'Roles', emoji: 'Emoji', channel: 'Channels' })[it.kind] : null;
        lastKind = it.kind;
        return (
          <div key={it.key}>
            {head && <div className="vc-mentions-head">{head}</div>}
            <button type="button" className={`vc-mention-row${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
              {it.kind === 'user' && <Avatar user={it.user} size={24} status={botPresenceOf(it.user) || getState().presence[it.user.username]?.status || it.user.presence?.status} />}
              {it.kind === 'emoji' && (it.img ? <img className="vc-sug-emoji" src={it.img} alt="" /> : <Twemoji char={it.char} className="vc-sug-emoji" />)}
              {it.kind === 'channel' && <span className="vc-sug-ch"><ChannelIcon c={it.channel} size={16} /></span>}
              <b style={it.kind === 'role' ? { color: it.role.color || undefined } : it.kind === 'user' ? { color: nameColor(sid, it.user) || undefined } : undefined}>{it.label}</b>
              {it.hint && <small>{it.hint}</small>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// @Role Name -> <@&rid> (what the server understands), and back again for editing
export function encodeRoleMentions(text, sid) {
  const roles = [...(getState().detail[sid]?.roles || [])].filter(r => !r.is_default).sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const r of roles) {
    const esc = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|\\s)@${esc}(?![\\w-])`, 'g'), `$1<@&${r.rid}>`);
  }
  return out;
}
export function decodeRoleMentions(text, sid) {
  const roles = getState().detail[sid]?.roles || [];
  return String(text || '').replace(/<@&(r[0-9a-f]{10})>/g, (m, id) => { const r = roles.find(x => x.rid === id); return r ? `@${r.name}` : '@deleted-role'; });
}
export function useMentionState() {
  const [sel, setSel] = useState(0);
  const [mq, setMq] = useState(null);
  return { sel, setSel, mq, setMq };
}
