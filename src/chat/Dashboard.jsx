// Home dashboard (the "Home" tab of the friends page, shown when no conversation is open): a rundown of what's going on.
// Everything here comes from data Ember already has (store: dms, groups, servers, friends, presence, voiceStates, modmail)
// plus three small reads: friend requests, message requests and the unread notifications (the bell's own endpoint).
// Works in both looks; dashboard.css draws it square by default and soft under html.vc-rounded.
import { useEffect, useMemo, useState } from 'react';
import { AtSign, Bell, Check, CheckCheck, ChevronRight, Headphones, Inbox, MessageCircle, MessageSquareText, Server, ShieldCheck, Sparkles, UserPlus, Users, UsersRound, Volume2, X } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, go, isMuted, readNotifs, followNotifLink, loadFriends, toast, errorText } from './store.js';
import { Avatar, subtitle } from './Profile.jsx';
import { ServerIcon } from './ServerIcon.jsx';
import { NotifIcon, NotifText, ago } from './Notifications.jsx';

const lc = s => String(s || '').toLowerCase();
// a message body as one plain line: custom emoji / mentions / links made readable, markdown marks dropped
export function snippet(body) {
  let t = String(body || '');
  if (!t.trim()) return '';
  t = t.replace(/<a?:(\w+):\w+>/g, ':$1:').replace(/<@&\w+>/g, '@role').replace(/<#\w+>/g, '#channel').replace(/<t:(\d+)(:\w)?>/g, (m, s) => new Date(Number(s) * 1000).toLocaleString());
  t = t.replace(/https?:\/\/(files\.|litter\.)?catbox\.moe\/\S+/g, '[file]').replace(/https?:\/\/\S+/g, u => { try { return new URL(u).host; } catch { return u; } });
  t = t.replace(/^(#{1,3}|-#|>>>|>)\s+/gm, '').replace(/(\*\*|__|~~|\|\||`)/g, '').replace(/\s+/g, ' ').trim();
  return t;
}
const hourWord = h => (h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Card({ icon: Icon, title, count, action, children, className = '' }) {
  return (
    <section className={`vc-dash-card ${className}`}>
      <header className="vc-dash-card-head">
        <span className="vc-dash-card-ico"><Icon size={17} /></span>
        <b>{title}</b>
        {count > 0 && <span className="vc-dash-pill">{count > 99 ? '99+' : count}</span>}
        <span className="grow" />
        {action}
      </header>
      <div className="vc-dash-card-body">{children}</div>
    </section>
  );
}
function Empty({ icon: Icon, children }) {
  return <div className="vc-dash-empty"><Icon size={20} /><span>{children}</span></div>;
}

export default function Dashboard({ onUser, onTab }) {
  const me = useChat(s => s.me);
  const dms = useChat(s => s.dms);
  const groups = useChat(s => s.groups);
  const unread = useChat(s => s.unread);
  const modmail = useChat(s => s.modmail);
  const servers = useChat(s => s.servers);
  const srvMentions = useChat(s => s.srvMentions);
  const unreadN = useChat(s => s.unreadN);
  const detail = useChat(s => s.detail);
  const voiceStates = useChat(s => s.voiceStates);
  const friends = useChat(s => s.friends);
  const presence = useChat(s => s.presence);
  const people = useChat(s => s.people);
  const notifUnread = useChat(s => s.notifUnread);
  useChat(s => s.notify); // mutes change what counts

  // requests (friends + message requests) and notifications: small reads, refreshed when the bell's count moves
  const [reqs, setReqs] = useState({ incoming: [], outgoing: [] });
  const [dmReqs, setDmReqs] = useState([]);
  const [notifs, setNotifs] = useState(null);
  const loadReqs = () => {
    apiFetch('/friends/requests').then(setReqs).catch(() => {});
    apiFetch('/account/dm-requests').then(d => setDmReqs(d?.requests || [])).catch(() => {});
  };
  useEffect(loadReqs, []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => apiFetch('/account/notifications?unread=1&limit=6').then(d => { if (live) setNotifs((d.notifications || []).filter(n => !n.read)); }).catch(() => { if (live) setNotifs(n => n || []); }), notifs ? 400 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [notifUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  async function answerFriend(id, yes) {
    try { await apiFetch(`/friends/request/${id}/${yes ? 'accept' : 'decline'}`, { method: 'PATCH' }); loadReqs(); loadFriends(); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function answerDm(id, yes) {
    try { await apiFetch(`/account/dm-requests/${id}/${yes ? 'accept' : 'decline'}`, { method: 'POST' }); loadReqs(); }
    catch (e) { toast(errorText(e.message)); }
  }
  const pickNotif = n => {
    setNotifs(l => (l || []).filter(x => x.id !== n.id));
    readNotifs([n.id]);
    if (n.link) followNotifLink(n.link);
  };
  const readAll = () => { setNotifs([]); readNotifs('all'); };

  // ── messages: unread first (DMs, groups, moderator chat), then the latest few to jump back into ──
  const convos = useMemo(() => {
    const list = dms.filter(c => c.username !== 'System' || c.unread).map(c => ({
      key: `d:${lc(c.username)}`, kind: 'dm', username: c.username, name: c.username === 'System' ? 'Nookara' : c.username,
      pfp: c.pfp || people[c.username]?.pfp, unread: c.unread || (unread[`d:${lc(c.username)}`] ? 1 : 0),
      text: c.last_message ? `${lc(c.last_message.from) === lc(me?.username) ? 'You: ' : ''}${snippet(c.last_message.body) || 'Sent a file'}` : '',
      at: c.last_message?.sent_at,
    }));
    groups.forEach(g => { if (unread[`g:${g.room}`]) list.push({ key: `g:${g.room}`, kind: 'group', room: g.room, name: g.name, unread: 1, text: `${plural(g.members.length, 'member')}`, at: null }); });
    if (modmail?.unread) list.push({ key: 'mm:', kind: 'modmail', name: 'Nookara Moderator Chat', unread: modmail.unread, text: "From Nookara's admins", at: null });
    const fresh = list.filter(c => c.unread).sort((a, b) => b.unread - a.unread);
    const recent = list.filter(c => !c.unread && c.username !== 'System').slice(0, Math.max(0, 6 - fresh.length));
    return { fresh, recent, unreadTotal: fresh.reduce((n, c) => n + c.unread, 0) };
  }, [dms, groups, unread, modmail, people, me]);
  const openConvo = c => go(c.kind === 'dm' ? { kind: 'dm', username: c.username } : c.kind === 'group' ? { kind: 'group', room: c.room } : { kind: 'modmail' });

  // ── servers: where you were mentioned, then where there's new stuff (muted servers stay quiet) ──
  const srv = useMemo(() => {
    const rows = servers.filter(s => !isMuted(s.sid)).map(s => {
      const live = Object.values(unreadN).reduce((n, u) => n + (u.sid === s.sid ? u.n : 0), 0);
      const chans = detail[s.sid]?.channels;
      const hot = chans ? chans.filter(c => (c.unread || c.mentions) && !isMuted(c.cid)).sort((a, b) => (b.mentions || 0) - (a.mentions || 0) || (b.unread_count || 0) - (a.unread_count || 0)).slice(0, 3).map(c => c.name) : [];
      return { s, mentions: (s.mentions || 0) + (srvMentions[s.sid] || 0), news: (s.unread_count || 0) + live, unread: !!s.unread || live > 0, hot };
    });
    const active = rows.filter(r => r.mentions || r.news || r.unread).sort((a, b) => b.mentions - a.mentions || b.news - a.news);
    return { active, mentions: rows.reduce((n, r) => n + r.mentions, 0), quiet: rows.length - active.length };
  }, [servers, srvMentions, unreadN, detail]);

  // ── people: who's around, who's in voice, who's playing something ──
  const friendNames = useMemo(() => new Set(friends.map(f => lc(f.friend_username))), [friends]);
  const online = friends.filter(f => { const st = presence[f.friend_username]?.status; return st && st !== 'offline' && st !== 'invisible'; });
  const playing = online.filter(f => presence[f.friend_username]?.activities?.length);
  const voice = useMemo(() => {
    const out = [];
    for (const [cid, users] of Object.entries(voiceStates)) {
      if (!Array.isArray(users) || !users.length) continue;
      const owner = servers.find(s => detail[s.sid]?.channels?.some(c => c.cid === cid));
      if (!owner) continue;
      const ch = detail[owner.sid].channels.find(c => c.cid === cid);
      const pals = users.filter(u => friendNames.has(lc(u.username)));
      out.push({ cid, sid: owner.sid, server: owner, channel: ch, users, pals });
    }
    return out.sort((a, b) => b.pals.length - a.pals.length || b.users.length - a.users.length).slice(0, 4);
  }, [voiceStates, servers, detail, friendNames]);

  const reqCount = reqs.incoming.length + dmReqs.length;
  const now = new Date();
  const parts = [
    convos.unreadTotal && plural(convos.unreadTotal, 'unread message'),
    srv.mentions && plural(srv.mentions, 'mention'),
    reqCount && plural(reqCount, 'request'),
    notifs?.length && plural(notifUnread || notifs.length, 'notification'),
  ].filter(Boolean);
  const summary = parts.length ? `You have ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.` : "You're all caught up. Nothing's waiting on you.";

  const stats = [
    { k: 'msgs', icon: MessageCircle, n: convos.unreadTotal, label: 'Unread messages', go: () => document.getElementById('vc-dash-msgs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { k: 'ment', icon: AtSign, n: srv.mentions, label: 'Mentions', go: () => document.getElementById('vc-dash-srv')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { k: 'on', icon: Users, n: online.length, label: 'Friends online', go: () => onTab('online') },
    { k: 'req', icon: UserPlus, n: reqCount, label: 'Requests', go: () => onTab('pending') },
  ];

  return (
    <div className="vc-dash">
      <div className="vc-dash-hero vl-rise">
        <div className="vc-dash-hello">
          {me && <Avatar user={me} size={56} />}
          <div>
            <small>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</small>
            <h2>{hourWord(now.getHours())}{me ? `, ${me.username}` : ''}</h2>
            <p>{summary}</p>
          </div>
        </div>
        <div className="vc-dash-stats">
          {stats.map((x, i) => (
            <button type="button" key={x.k} className={`vc-dash-stat${x.n ? ' hot' : ''} k-${x.k}`} style={{ '--i': i }} onClick={x.go}>
              <span className="vc-dash-stat-ico"><x.icon size={18} /></span>
              <b>{x.n > 999 ? '999+' : x.n}</b>
              <small>{x.label}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="vc-dash-grid">
        <div className="vc-dash-col">
          <div id="vc-dash-msgs" />
          <Card icon={MessageSquareText} title="Messages" count={convos.unreadTotal}>
            {!convos.fresh.length && !convos.recent.length && <Empty icon={Inbox}>No conversations yet. Say hi to a friend!</Empty>}
            {convos.fresh.length > 0 && <div className="vc-dash-sub">Unread</div>}
            {convos.fresh.map(c => <ConvoRow key={c.key} c={c} presence={presence} onClick={() => openConvo(c)} />)}
            {convos.recent.length > 0 && <div className="vc-dash-sub">{convos.fresh.length ? 'Recent' : "You're all caught up - jump back in"}</div>}
            {convos.recent.map(c => <ConvoRow key={c.key} c={c} presence={presence} onClick={() => openConvo(c)} />)}
          </Card>

          <div id="vc-dash-srv" />
          <Card icon={Server} title="Your servers" count={srv.mentions}>
            {!servers.length && <Empty icon={Server}>You're not in any servers yet.</Empty>}
            {servers.length > 0 && !srv.active.length && <Empty icon={CheckCheck}>Nothing new in your servers.</Empty>}
            {srv.active.slice(0, 6).map(({ s, mentions, news, hot }) => (
              <button type="button" key={s.sid} className="vc-dash-row" onClick={() => go({ kind: 'server', sid: s.sid })}>
                <span className="vc-dash-srv-ico"><ServerIcon src={s.icon} name={s.name} /></span>
                <span className="vc-dash-row-txt">
                  <b>{s.name}</b>
                  <small>{hot.length ? hot.map(h => `#${h}`).join(', ') : [news && plural(news, 'new message'), s.online != null && `${s.online} online`].filter(Boolean).join(' · ') || 'New messages'}</small>
                </span>
                {mentions > 0 && <span className="vc-dash-at"><AtSign size={12} />{mentions > 99 ? '99+' : mentions}</span>}
                {!mentions && news > 0 && <span className="vc-dash-new">{news > 99 ? '99+' : news} new</span>}
                <ChevronRight size={16} className="vc-dash-chev" />
              </button>
            ))}
            {srv.active.length > 0 && srv.quiet > 0 && <div className="vc-dash-foot">{plural(srv.quiet, 'other server')} with nothing new</div>}
          </Card>
        </div>

        <div className="vc-dash-col">
          <Card icon={Sparkles} title="Right now" action={<button type="button" className="vc-dash-link" onClick={() => onTab('online')}>All friends</button>}>
            {voice.map(v => (
              <button type="button" key={v.cid} className="vc-dash-voice" onClick={() => go({ kind: 'channel', sid: v.sid, cid: v.cid })}>
                <span className="vc-dash-voice-top"><Volume2 size={15} /><b>{v.channel?.name || 'Voice'}</b><small>{v.server.name}</small></span>
                <span className="vc-dash-faces">
                  {v.users.slice(0, 6).map(u => <Avatar key={u.username} user={{ username: u.username, pfp: people[u.username]?.pfp }} size={28} />)}
                  {v.users.length > 6 && <span className="vc-dash-more">+{v.users.length - 6}</span>}
                  <small>{v.pals.length ? `${v.pals.slice(0, 2).map(u => u.username).join(', ')}${v.pals.length > 2 ? ` +${v.pals.length - 2}` : ''} ${v.pals.length === 1 && v.users.length === 1 ? 'is' : 'are'} here` : plural(v.users.length, 'person', 'people')}</small>
                </span>
              </button>
            ))}
            {playing.slice(0, 4).map(f => {
              const p = presence[f.friend_username];
              return (
                <button type="button" key={f.friend_username} className="vc-dash-row" onClick={e => onUser(f.friend_username, e.currentTarget, 'left')}>
                  <Avatar user={{ username: f.friend_username, pfp: f.pfp_url }} size={36} status={p.status} />
                  <span className="vc-dash-row-txt"><b style={f.color ? { color: f.color } : undefined}>{f.friend_username}</b><small>{subtitle(p)}</small></span>
                </button>
              );
            })}
            {online.length > 0 && (
              <button type="button" className="vc-dash-online" onClick={() => onTab('online')}>
                <span className="vc-dash-faces">
                  {online.slice(0, 7).map(f => <Avatar key={f.friend_username} user={{ username: f.friend_username, pfp: f.pfp_url }} size={30} status={presence[f.friend_username]?.status} />)}
                </span>
                <small>{plural(online.length, 'friend')} online{online.length > 7 ? '' : ''}</small>
              </button>
            )}
            {!voice.length && !playing.length && !online.length && <Empty icon={Headphones}>It's quiet right now. When friends come online, start playing something or hop into voice, it shows up here.</Empty>}
          </Card>

          {(reqCount > 0 || reqs.outgoing.length > 0) && (
            <Card icon={UserPlus} title="Requests" count={reqCount} action={<button type="button" className="vc-dash-link" onClick={() => onTab('pending')}>See all</button>}>
              {reqs.incoming.slice(0, 4).map(r => (
                <div key={`f${r.id}`} className="vc-dash-row static">
                  <Avatar user={{ username: r.from_username, pfp: r.pfp_url }} size={36} />
                  <span className="vc-dash-row-txt"><b>{r.from_username}</b><small>Wants to be your friend</small></span>
                  <button type="button" className="vc-round ok" title="Accept" onClick={() => answerFriend(r.id, true)}><Check size={17} /></button>
                  <button type="button" className="vc-round no" title="Decline" onClick={() => answerFriend(r.id, false)}><X size={17} /></button>
                </div>
              ))}
              {dmReqs.slice(0, 3).map(r => (
                <div key={`m${r.id}`} className="vc-dash-row static">
                  <Avatar user={{ username: r.username, pfp: r.pfp }} size={36} />
                  <span className="vc-dash-row-txt"><b>{r.username}</b><small>Wants to message you</small></span>
                  <button type="button" className="vc-round ok" title="Accept" onClick={() => answerDm(r.id, true)}><Check size={17} /></button>
                  <button type="button" className="vc-round no" title="Decline" onClick={() => answerDm(r.id, false)}><X size={17} /></button>
                </div>
              ))}
              {!reqCount && <div className="vc-dash-foot">{plural(reqs.outgoing.length, 'request')} you sent, waiting for an answer</div>}
            </Card>
          )}

          <Card icon={Bell} title="Notifications" count={notifUnread} action={notifs?.length ? <button type="button" className="vc-dash-link" onClick={readAll}><CheckCheck size={14} /> Mark all read</button> : null}>
            {notifs === null && <div className="vc-dash-empty"><span>Loading...</span></div>}
            {notifs && !notifs.length && <Empty icon={CheckCheck}>No new notifications.</Empty>}
            {(notifs || []).slice(0, 5).map(n => (
              <button type="button" key={n.id} className="vc-dash-row vc-dash-notif" onClick={() => pickNotif(n)}>
                <NotifIcon n={n} />
                <span className="vc-dash-row-txt">
                  <b><NotifText text={n.title} /></b>
                  {n.body && <small><NotifText text={n.body} /></small>}
                </span>
                <time>{ago(n.created_at)}</time>
              </button>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConvoRow({ c, presence, onClick }) {
  const icon = c.kind === 'group' ? <span className="vc-av vc-grp-av" style={{ width: 'calc(36px * var(--av-k, 1))', height: 'calc(36px * var(--av-k, 1))' }}><UsersRound size={17} /></span>
    : c.kind === 'modmail' || c.username === 'System' ? <span className="vc-av vc-sys-av" style={{ width: 'calc(36px * var(--av-k, 1))', height: 'calc(36px * var(--av-k, 1))' }}><ShieldCheck size={18} /></span>
      : <Avatar user={{ username: c.username, pfp: c.pfp }} size={36} status={presence[c.username]?.status || 'offline'} />;
  return (
    <button type="button" className={`vc-dash-row${c.unread ? ' unread' : ''}`} onClick={onClick}>
      {icon}
      <span className="vc-dash-row-txt"><b>{c.name}</b>{c.text && <small>{c.text}</small>}</span>
      <span className="vc-dash-meta">
        {c.at && <time>{ago(c.at)}</time>}
        {c.unread > 0 && <span className="vc-count">{c.unread > 99 ? '99+' : c.unread}</span>}
      </span>
    </button>
  );
}
