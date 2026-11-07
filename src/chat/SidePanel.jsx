// The right-hand side panel: one place for the people here, pinned messages, your Inbox and search, switched by the icon
// tabs along its top. Server channel: Members / Pins / Inbox / Search. DM: Profile / Pins / Inbox. Group chat: Members / Pins / Inbox.
// The Inbox (Mentions / Unread / Saved / Notifications) took over the bell's notifications.
import { useEffect, useMemo, useState } from 'react';
import { AtSign, Bell, Bookmark, CheckCheck, Inbox as InboxIco, MessageCircle, Pin, Search, Settings, UserRound, Users, UsersRound, X, Hash, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, getState, go, jumpToMessage, toast, errorText, isMuted, readNotifs, loadNotifs, closeNotifs } from './store.js';
import { MemberList } from './Parts.jsx';
import { PinsPanel } from './MsgTools.jsx';
import { ProfileCard, Avatar } from './Profile.jsx';
import { NotifList, ago } from './Notifications.jsx';
import { ServerIcon } from './ServerIcon.jsx';
import { snippet } from './Dashboard.jsx';
import { loadMentions, loadSaved, unsaveMessage } from './inbox.js';
import { siteHref } from './hosts.js';
import { stampOf } from './text.jsx';
import { shownName } from './aliases.js';

const TAB_KEY = 'bf_panel_tab';
const savedTab = () => { try { return localStorage.getItem(TAB_KEY) || 'people'; } catch { return 'people'; } };

export function useInboxCount() {
  const notif = useChat(s => s.notifUnread);
  const servers = useChat(s => s.servers);
  const srvMentions = useChat(s => s.srvMentions);
  useChat(s => s.notify);
  const pings = servers.reduce((n, s) => n + (isMuted(s.sid) ? 0 : (s.mentions || 0) + (srvMentions[s.sid] || 0)), 0);
  return notif + pings;
}

export function SidePanel({ view, channel, detail, group, onUser, onLeaveGroup }) {
  const [tab, setTabRaw] = useState(savedTab);
  const setTab = t => { setTabRaw(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* fine */ } };
  const isServer = view.kind === 'channel';
  const pinnable = isServer ? channel && (['text', 'logs', 'welcome', undefined].includes(channel.type) || (channel.type === 'game' && channel.config?.purpose === 'chat')) : view.kind === 'dm' || view.kind === 'group';
  const tabs = [
    ['people', view.kind === 'dm' ? UserRound : Users, view.kind === 'dm' ? 'Profile' : 'Members'],
    pinnable && ['pins', Pin, 'Pinned messages'],
    ['inbox', InboxIco, 'Inbox'],
    isServer && ['search', Search, 'Search'],
  ].filter(Boolean);
  const cur = tabs.some(t => t[0] === tab) ? tab : 'people';
  const inboxN = useInboxCount();
  // "See all pinned messages" (system line) and other places that want the pins open
  useEffect(() => { const f = () => setTab('pins'); addEventListener('vc-open-pins', f); return () => removeEventListener('vc-open-pins', f); }, []);
  useEffect(() => { const f = e => setTab(e.detail || 'inbox'); addEventListener('vc-panel-tab', f); return () => removeEventListener('vc-panel-tab', f); }, []);
  return (
    <aside className="vc-panel" aria-label="Side panel">
      <div className="vc-panel-tabs" role="tablist">
        {tabs.map(([k, Icon, label]) => (
          <button type="button" key={k} role="tab" aria-selected={cur === k} className={cur === k ? 'on' : ''} title={label} onClick={() => setTab(k)}>
            <Icon size={18} />
            {k === 'inbox' && inboxN > 0 && <span className="vc-panel-dot">{inboxN > 99 ? '99+' : inboxN}</span>}
          </button>
        ))}
      </div>
      <div className="vc-panel-body" key={`${cur}-${view.sid || view.username || view.room}`}>
        {cur === 'people' && isServer && <MemberList sid={view.sid} onUser={onUser} embedded />}
        {cur === 'people' && view.kind === 'dm' && <div className="vc-panel-profile"><ProfileCard username={view.username} onExpand={rect => dispatchEvent(new CustomEvent('vc-open-big', { detail: { username: view.username, rect } }))} /></div>}
        {cur === 'people' && view.kind === 'group' && group && (
          <div className="vc-panel-scroll">
            <PanelHead title="Members" count={group.members.length} />
            {group.members.map((u, i) => (
              <button type="button" key={u} className="vc-member vl-rise" style={{ '--i': i }} onClick={e => onUser(u, e.currentTarget, 'left')}>
                <Avatar user={{ username: u, pfp: getState().people[u]?.pfp }} size={32} status={getState().presence[u]?.status || undefined} />
                <span className="vc-member-txt"><b>{u}</b>{u === group.owner && <small>Group owner</small>}</span>
              </button>
            ))}
            <button type="button" className="vc-more danger" onClick={onLeaveGroup}>Leave group</button>
          </div>
        )}
        {cur === 'pins' && <div className="vc-panel-scroll"><PanelHead title="Pinned messages" /><PinsPanel channel={channel} sid={view.sid} view={isServer ? undefined : view} onClose={() => setTab('people')} embedded /></div>}
        {cur === 'inbox' && <Inbox />}
        {cur === 'search' && isServer && <SearchTab view={view} channel={channel} detail={detail} />}
      </div>
    </aside>
  );
}

function PanelHead({ title, count, children }) {
  return <div className="vc-panel-head"><b>{title}</b>{count != null && <span className="vc-panel-count">{count}</span>}<span className="grow" />{children}</div>;
}

// ── Inbox ──
function Inbox() {
  const [sub, setSub] = useState(() => { try { return localStorage.getItem('bf_inbox_tab') || 'mentions'; } catch { return 'mentions'; } });
  const pick = k => { setSub(k); try { localStorage.setItem('bf_inbox_tab', k); } catch { /* fine */ } };
  const notifN = useChat(s => s.notifUnread);
  const unreadRows = useUnreadRows();
  const mentionsN = useChat(s => (s.inboxMentions?.list || []).filter(m => m.unread).length);
  const subs = [['mentions', AtSign, 'Mentions', mentionsN], ['unread', MessageCircle, 'Unread', unreadRows.length], ['saved', Bookmark, 'Saved', 0], ['notifs', Bell, 'Notifications', notifN]];
  return (
    <div className="vc-inbox">
      <PanelHead title="Inbox" />
      <div className="vc-inbox-subs" role="tablist">
        {subs.map(([k, Icon, label, n]) => (
          <button type="button" key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => pick(k)} title={label}>
            <Icon size={14} /><span>{label}</span>{n > 0 && <i>{n > 99 ? '99+' : n}</i>}
          </button>
        ))}
      </div>
      <div className="vc-panel-scroll">
        {sub === 'mentions' && <MentionsList />}
        {sub === 'unread' && <UnreadList rows={unreadRows} />}
        {sub === 'saved' && <SavedList />}
        {sub === 'notifs' && <InboxNotifs />}
      </div>
    </div>
  );
}

function InboxRow({ face, icon, title, where, time, text, unread, onClick, onRemove }) {
  return (
    <div className={`vc-inbox-row${unread ? ' unread' : ''}`}>
      <button type="button" className="vc-inbox-main" onClick={onClick}>
        <span className="vc-inbox-top">
          {face ? <Avatar user={face} size={22} /> : icon}
          <b>{title}</b>
          {where && <small className="vc-inbox-where">{where}</small>}
          <span className="grow" />
          {time && <time>{time}</time>}
        </span>
        {text && <span className="vc-inbox-text">{text}</span>}
      </button>
      {onRemove && <button type="button" className="vc-inbox-x" title="Remove from saved" onClick={onRemove}><X size={14} /></button>}
    </div>
  );
}
const Note = ({ icon: Icon, children }) => <div className="vc-inbox-empty"><Icon size={22} /><span>{children}</span></div>;

function MentionsList() {
  const box = useChat(s => s.inboxMentions);
  useEffect(() => { if (!box || Date.now() - (box.at || 0) > 15000) loadMentions(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = box?.list || [];
  return (
    <>
      {list.map(m => (
        <InboxRow key={m.id} unread={m.unread} face={m.author} title={shownName(m)} where={`#${m.channel_name} · ${m.server_name}`} time={ago(m.created_at)} text={snippet(m.body) || (m.attachments?.length ? 'Sent an attachment' : '')}
          onClick={() => jumpToMessage({ kind: 'channel', sid: m.server, cid: m.channel }, m.id)} />
      ))}
      {box?.loading && <div className="vc-loading"><i /><i /><i /></div>}
      {box?.error && <Note icon={AtSign}>Couldn't load your mentions. <button type="button" className="vc-link-btn" onClick={() => loadMentions()}>Try again</button></Note>}
      {box && !box.loading && !box.error && !list.length && <Note icon={CheckCheck}>No mentions in the last 30 days.</Note>}
      {box?.has_more && !box.loading && <button type="button" className="vc-more" onClick={() => loadMentions({ more: true })}>Load more</button>}
    </>
  );
}

// everything waiting: DMs, group chats, moderator chat, and channels (or whole servers whose channels aren't loaded yet)
function useUnreadRows() {
  const dms = useChat(s => s.dms);
  const groups = useChat(s => s.groups);
  const unread = useChat(s => s.unread);
  const modmail = useChat(s => s.modmail);
  const servers = useChat(s => s.servers);
  const detail = useChat(s => s.detail);
  const unreadN = useChat(s => s.unreadN);
  const mentions = useChat(s => s.mentions);
  const people = useChat(s => s.people);
  useChat(s => s.notify);
  return useMemo(() => {
    const rows = [];
    if (modmail?.unread) rows.push({ k: 'mm', icon: <span className="vc-inbox-ico"><ShieldCheck size={14} /></span>, title: 'Nookara Moderator Chat', text: `${modmail.unread} new`, n: modmail.unread, go: { kind: 'modmail' } });
    dms.forEach(c => { if (c.unread || unread[`d:${c.username.toLowerCase()}`]) rows.push({ k: `d:${c.username}`, face: c.username === 'System' ? null : { username: c.username, pfp: c.pfp || people[c.username]?.pfp }, icon: <span className="vc-inbox-ico"><Bell size={14} /></span>, title: c.username === 'System' ? 'Nookara' : c.username, where: 'Direct message', time: c.last_message?.sent_at ? ago(c.last_message.sent_at) : '', text: snippet(c.last_message?.body), n: c.unread || 1, go: { kind: 'dm', username: c.username } }); });
    groups.forEach(g => { if (unread[`g:${g.room}`]) rows.push({ k: `g:${g.room}`, icon: <span className="vc-inbox-ico"><UsersRound size={14} /></span>, title: g.name, where: 'Group chat', n: 1, go: { kind: 'group', room: g.room } }); });
    servers.forEach(s => {
      if (isMuted(s.sid)) return;
      const icon = <span className="vc-inbox-srv"><ServerIcon src={s.icon} name={s.name} /></span>;
      const chans = detail[s.sid]?.channels;
      if (chans) {
        chans.forEach(c => {
          if (isMuted(c.cid)) return;
          const n = (c.unread ? c.unread_count || 0 : 0) + (unreadN[c.cid]?.n || 0);
          const ping = (c.mentions || 0) + (mentions[c.cid] || 0);
          if (n || c.unread || unread[`c:${c.cid}`]) rows.push({ k: c.cid, icon, title: `#${c.name}`, where: s.name, text: ping ? `${ping} mention${ping === 1 ? '' : 's'} · ${n || 'new'} message${n === 1 ? '' : 's'}` : `${n || 'New'} message${n === 1 ? '' : 's'}`, n: n || 1, ping, go: { kind: 'channel', sid: s.sid, cid: c.cid } });
        });
      } else if (s.unread || s.unread_count) rows.push({ k: s.sid, icon, title: s.name, text: `${s.unread_count || 'New'} message${s.unread_count === 1 ? '' : 's'}`, n: s.unread_count || 1, ping: s.mentions || 0, go: { kind: 'server', sid: s.sid } });
    });
    return rows.sort((a, b) => (b.ping || 0) - (a.ping || 0));
  }, [dms, groups, unread, modmail, servers, detail, unreadN, mentions, people]);
}
function UnreadList({ rows }) {
  if (!rows.length) return <Note icon={CheckCheck}>You're all caught up.</Note>;
  return rows.map(r => <InboxRow key={r.k} unread face={r.face} icon={r.icon} title={r.title} where={r.where} time={r.time} text={r.text} onClick={() => go(r.go)} />);
}

function SavedList() {
  const box = useChat(s => s.savedMsgs);
  useEffect(() => { loadSaved(); }, []);
  const list = box?.list || [];
  const open = x => {
    const m = x.message;
    if (x.kind === 'channel') jumpToMessage({ kind: 'channel', sid: m.server, cid: m.channel }, m.id);
    else if (x.kind === 'dm') jumpToMessage({ kind: 'dm', username: x.with }, m.id);
    else go({ kind: 'group', room: m.room });
  };
  return (
    <>
      {list.map(x => {
        if (x.missing || x.hidden || !x.message) return <InboxRow key={x.id} icon={<span className="vc-inbox-ico"><Bookmark size={14} /></span>} title={x.hidden ? 'A direct message' : 'Message unavailable'} text={x.hidden ? "This app can't read your DMs." : 'It was deleted, or you no longer have access to it.'} time={ago(x.saved_at)} onRemove={() => unsaveMessage(x.id)} />;
        const m = x.message;
        const where = x.kind === 'channel' ? `#${m.channel_name} · ${m.server_name}` : x.kind === 'dm' ? `DM with ${x.with}` : m.room_name || 'Group chat';
        const author = x.kind === 'group' ? { username: m.user, pfp: getState().people[m.user]?.pfp } : m.author;
        return <InboxRow key={x.id} face={author} title={author?.username || 'Someone'} where={where} time={ago(m.created_at || x.saved_at)} text={snippet(m.body ?? m.message) || 'Attachment'} onClick={() => open(x)} onRemove={() => unsaveMessage(x.id)} />;
      })}
      {box?.loading && <div className="vc-loading"><i /><i /><i /></div>}
      {box && !box.loading && !list.length && !box.error && <Note icon={Bookmark}>Nothing saved yet. Right-click a message and pick Save message.</Note>}
      {box?.error && <Note icon={Bookmark}>Couldn't load your saved messages.</Note>}
      {box?.has_more && !box.loading && <button type="button" className="vc-more" onClick={() => loadSaved({ more: true })}>Load more</button>}
    </>
  );
}

function InboxNotifs() {
  const unread = useChat(s => s.notifUnread);
  const n = useChat(s => s.notifs?.list?.length || 0);
  useEffect(() => { loadNotifs(); return () => closeNotifs(); }, []);
  return (
    <div className="vc-inbox-notifs">
      <div className="vc-inbox-bar">
        <button type="button" className="vc-link-btn" disabled={!unread && !n} onClick={() => readNotifs('all')}><CheckCheck size={14} /> Mark all read</button>
        <span className="grow" />
        <a className="vc-link-btn" href={siteHref('/me#notifications')} target="_blank" rel="noopener noreferrer">View all</a>
        <a className="vc-ico-btn" href={siteHref('/me#settings/notifications')} target="_blank" rel="noopener noreferrer" title="Notification settings"><Settings size={15} /></a>
      </div>
      <NotifList />
    </div>
  );
}

// ── Search (this server, or just this channel) ──
function SearchTab({ view, channel, detail }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('server');
  const [res, setRes] = useState(null); // { q, results, total }
  async function run(e) {
    e?.preventDefault();
    const text = q.trim();
    if (!text || !channel) { setRes(null); return; }
    setRes({ q: text, results: null });
    try {
      const d = scope === 'server' ? await apiFetch(`/chat/servers/${view.sid}/search?q=${encodeURIComponent(text)}`) : await apiFetch(`/chat/channels/${channel.cid}/search?q=${encodeURIComponent(text)}`);
      setRes({ q: text, results: d.messages, total: d.total ?? d.messages.length });
    } catch (er) { toast(errorText(er.message)); setRes(null); }
  }
  return (
    <div className="vc-inbox">
      <PanelHead title="Search" />
      <form className="vc-panel-search" onSubmit={run}>
        <Search size={15} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={scope === 'server' ? `Search ${detail?.server.name || 'this server'}` : `Search #${channel?.name || ''}`} />
        {q && <button type="button" className="vc-ico-btn" title="Clear" onClick={() => { setQ(''); setRes(null); }}><X size={14} /></button>}
      </form>
      <div className="vc-panel-scope">
        <button type="button" className={scope === 'server' ? 'on' : ''} onClick={() => setScope('server')}>Whole server</button>
        <button type="button" className={scope === 'channel' ? 'on' : ''} onClick={() => setScope('channel')}><Hash size={12} />{channel?.name || 'channel'}</button>
      </div>
      <div className="vc-panel-scroll">
        {!res && <div className="vc-results-tip">Filters: <code>from:name</code> <code>in:channel</code> <code>has:image</code> <code>has:file</code> <code>has:link</code></div>}
        {res && !res.results && <div className="vc-loading"><i /><i /><i /></div>}
        {res?.results && <div className="vc-panel-sub">{res.total} result{res.total === 1 ? '' : 's'}</div>}
        {res?.results?.map(m => (
          <InboxRow key={m.id} face={m.author} title={shownName(m)} where={m.channel_name ? `#${m.channel_name}` : ''} time={stampOf(m.created_at)} text={m.body || (m.attachments?.length ? `[${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}]` : '')}
            onClick={() => jumpToMessage({ kind: 'channel', sid: view.sid, cid: m.channel }, m.id)} />
        ))}
        {res?.results && !res.results.length && <Note icon={Search}>Nothing found.</Note>}
      </div>
    </div>
  );
}
