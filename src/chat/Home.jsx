// Home (no conversation open): a greeting, one suggestion, then tabs: Friends (recent chats + who's on and off), Requests,
// Blocked, Group chats, Catch up (Dashboard.jsx: unread, servers, notifications) and Saved. One search box filters your
// friends and adds someone by username.
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, UserPlus, Check, X, House, Users, Inbox, ShieldOff, UsersRound, Sparkles, Bookmark, Search, Compass, Plus, ChevronRight } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, go, loadFriends, toast, errorText, ask, toggleBlock } from './store.js';
import { NameText, displayNameOf } from './displayNames.js';
import { Avatar, subtitle } from './Profile.jsx';
import { VeloraConnNote } from './Parts.jsx';
import Dashboard from './Dashboard.jsx';
import { SavedList } from './SidePanel.jsx';
import './dashboard.css';
import './home.css';

const hourWord = h => (h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
const statusText = p => subtitle(p) || (!p || p.status === 'offline' ? 'Offline' : p.status === 'dnd' ? 'Do not disturb' : p.status === 'idle' ? 'Idle' : 'Online');

export default function Home({ onUser }) {
  const me = useChat(s => s.me);
  const friends = useChat(s => s.friends);
  const friendsLoaded = useChat(s => s.friendsLoaded);
  const presence = useChat(s => s.presence);
  // friends wait for the first presence answer (or 1.5s), so nobody lands in Offline and then jumps to Online
  const presenceReady = useChat(s => s.presenceReady);
  const [waited, setWaited] = useState(false);
  useEffect(() => { if (presenceReady) return undefined; const t = setTimeout(() => setWaited(true), 1500); return () => clearTimeout(t); }, [presenceReady]);
  const friendsReady = presenceReady || waited;
  const dms = useChat(s => s.dms);
  const groups = useChat(s => s.groups);
  const servers = useChat(s => s.servers);
  const blocks = useChat(s => s.blocks);
  const people = useChat(s => s.people);
  const [tab, setTabRaw] = useState(() => { try { return localStorage.getItem('bf_home_tab') || 'friends'; } catch { return 'friends'; } });
  const setTab = t => { const k = { online: 'friends', all: 'friends', pending: 'requests', add: 'friends', home: 'catchup' }[t] || t; setTabRaw(k); try { localStorage.setItem('bf_home_tab', k); } catch { /* fine */ } };
  const [reqs, setReqs] = useState({ incoming: [], outgoing: [] });
  const [q, setQ] = useState('');
  const loadReqs = () => apiFetch('/friends/requests').then(setReqs).catch(() => {});
  useEffect(() => { loadReqs(); }, []);
  // message requests (dm-privacy.js): someone who isn't a friend asks before they can DM you. Nothing they wrote comes with it
  const [dmReqs, setDmReqs] = useState(null);
  const loadDmReqs = () => apiFetch('/account/dm-requests').then(setDmReqs).catch(() => {});
  useEffect(() => { loadDmReqs(); }, [tab]);
  const dmIn = dmReqs?.requests || [];
  async function answerDm(id, yes) {
    try { await apiFetch(`/account/dm-requests/${id}/${yes ? 'accept' : 'decline'}`, { method: 'POST' }); loadDmReqs(); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function setDmOn(on) {
    try { setDmReqs(await apiFetch('/account/dm-requests/settings', { method: 'POST', body: JSON.stringify({ requests_on: on }) }).then(d => ({ ...dmReqs, ...d }))); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function addFriend(name) {
    const u = String(name || '').trim().replace(/^@/, '');
    if (!u) return;
    try {
      const d = await apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username: u }) });
      toast(d.status === 'accepted' ? `You and ${u} are friends now!` : `Friend request sent to ${u}.`, true);
      setQ(''); loadReqs(); loadFriends();
    } catch (er) {
      toast({ already_friends: "You're already friends.", user_not_found: "Couldn't find anyone called that.", invalid_target: "That's you!", already_requested: 'You already sent them a request.' }[er.message] || errorText(er.message));
    }
  }
  async function cancel(r) {
    if (!(await ask({ title: `Cancel your request to ${r.to_username}?`, text: "They won't be told. You can send another one later.", confirm: 'Cancel request', cancel: 'Keep it', danger: true }))) return;
    try { await apiFetch(`/friends/request/${r.id}`, { method: 'DELETE' }); loadReqs(); toast('Request cancelled.', true); }
    catch (e) { toast(e.message === 'request_not_found' ? 'They already answered it.' : errorText(e.message)); loadReqs(); }
  }
  async function answer(id, yes) {
    try { await apiFetch(`/friends/request/${id}/${yes ? 'accept' : 'decline'}`, { method: 'PATCH' }); loadReqs(); loadFriends(); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function unblock(u) {
    if (!(await ask({ title: `Unblock ${u}?`, text: 'They can message you and see you again, as before.', confirm: 'Unblock' }))) return;
    toggleBlock(u, true);
  }

  const st = f => presence[f.friend_username]?.status || 'offline';
  const needle = q.trim().toLowerCase();
  const shown = friends.filter(f => !needle || f.friend_username.toLowerCase().includes(needle));
  const online = shown.filter(f => st(f) !== 'offline').sort((a, b) => a.friend_username.localeCompare(b.friend_username));
  const offline = shown.filter(f => st(f) === 'offline').sort((a, b) => a.friend_username.localeCompare(b.friend_username));
  const onlineAll = friends.filter(f => st(f) !== 'offline').length;
  // recent chats: the latest DM conversations (newest first, the server's order)
  const recent = useMemo(() => dms.filter(c => c.username !== 'System' && (!needle || c.username.toLowerCase().includes(needle))).slice(0, 10), [dms, needle]);
  const reqN = reqs.incoming.length + dmIn.length;
  const unreadN = dms.reduce((n, c) => n + (c.unread || 0), 0);

  // one suggestion at a time: requests first, then finding a server
  const tip = reqN ? { icon: UserPlus, title: `${reqN} ${reqN === 1 ? 'person wants' : 'people want'} to connect`, text: 'Friend and message requests are waiting for you.', btn: 'Review', on: () => setTab('requests') }
    : !servers.length ? { icon: Compass, title: 'Find your people', text: "You're not in any servers yet. Look around Discovery, or join one with an invite.", btn: 'Explore servers', on: () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'discover' } })) }
      : { icon: Compass, title: 'Looking for somewhere new?', text: 'Discovery has servers made by the Ember community.', btn: 'Explore', on: () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'discover' } })) };

  const tabs = [
    ['friends', Users, 'Friends', friends.length, false],
    ['requests', Inbox, 'Requests', reqN, true],
    ['blocked', ShieldOff, 'Blocked', blocks?.length || 0, false],
    ['groups', UsersRound, 'Group chats', 0, false],
    ['catchup', Sparkles, 'Catch up', unreadN, true],
    ['saved', Bookmark, 'Saved', 0, false],
  ];
  const now = new Date();
  // a plain function, not a component: a component made inside render is a new type every render, so every presence update
  // remounted (and re-animated) every friend. Rows animate once when they appear, all together.
  const friendRow = f => {
    const p = presence[f.friend_username];
    return (
      <div key={f.friend_username} className="hm-friend vl-rise">
        <button type="button" className="hm-friend-who" onClick={e => onUser(f.friend_username, e.currentTarget)}>
          <Avatar user={{ username: f.friend_username, pfp: f.pfp_url }} size={34} status={p?.status || 'offline'} />
          <span><b style={f.color ? { color: f.color } : undefined}><NameText u={{ username: f.friend_username }} fallback={f.friend_username} /></b><small>{statusText(p)}</small></span>
        </button>
        <button type="button" className="hm-friend-msg" title={`Message ${f.friend_username}`} onClick={() => go({ kind: 'dm', username: f.friend_username })}><MessageCircle size={16} /></button>
      </div>
    );
  };
  return (
    <div className="vc-home">
      <div className="vc-home-main">
        <div className="vc-head"><House size={20} className="vc-head-ico" /><b className="vc-head-name">Home</b></div>
        <div className="vc-home-body hm">
          <VeloraConnNote className="wide" />
          <div className="hm-wrap">
            <header className="hm-hello vl-rise">
              {me && <Avatar user={me} size={46} status={presence[me.username]?.status || 'online'} />}
              <div>
                <h2>{hourWord(now.getHours())}{me ? <>, <NameText u={{ username: me.username }} fallback={me.username} /></> : ''}</h2>
                <p>{onlineAll} {onlineAll === 1 ? 'friend' : 'friends'} online{unreadN ? ` · ${unreadN} unread ${unreadN === 1 ? 'message' : 'messages'}` : ''}</p>
              </div>
            </header>
            <section className="hm-tip vl-rise" style={{ '--i': 1 }}>
              <span className="hm-tip-ico"><tip.icon size={20} /></span>
              <div><b>{tip.title}</b><span>{tip.text}</span></div>
              <button type="button" className="btn btn-surface" onClick={tip.on}>{tip.btn}</button>
            </section>
            <nav className="hm-tabs" role="tablist">
              {tabs.map(([k, Icon, label, n, hot]) => (
                <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  <Icon size={15} /> {label}{n > 0 && <i className={hot ? 'hot' : ''}>{n > 99 ? '99+' : n}</i>}
                </button>
              ))}
            </nav>
            {tab === 'friends' && (
              <form className="hm-search" onSubmit={e => { e.preventDefault(); if (needle && !shown.length) addFriend(q); }}>
                <Search size={16} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a friend, or type a username to add them" aria-label="Find a friend or add someone" />
                <button type="button" className="hm-search-add" title={q.trim() ? `Send a friend request to ${q.trim()}` : 'Type a username to add someone'} disabled={!q.trim()} onClick={() => addFriend(q)}><UserPlus size={16} /></button>
              </form>
            )}

            {tab === 'friends' && (
              <div className="hm-body" key="friends">
                {recent.length > 0 && (
                  <>
                    <div className="hm-sub">Recent chats</div>
                    <div className="hm-recent">
                      {recent.map(c => (
                        <button type="button" key={c.username} className="hm-tile vl-rise" onClick={() => go({ kind: 'dm', username: c.username })}>
                          <Avatar user={{ username: c.username, pfp: c.pfp || people[c.username]?.pfp }} size={44} status={presence[c.username]?.status || 'offline'} />
                          <b><NameText u={{ username: c.username }} fallback={c.username} /></b>
                          {c.unread > 0 && <i>{c.unread > 99 ? '99+' : c.unread}</i>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {friendsLoaded && !friends.length && <div className="hm-empty"><UserPlus size={28} /><b>No friends yet</b><span>Type someone's username above to send them a request.</span></div>}
                {friends.length > 0 && needle && !shown.length && <div className="hm-empty"><Search size={24} /><b>None of your friends match "{q.trim()}"</b><button type="button" className="btn btn-primary" onClick={() => addFriend(q)}><UserPlus size={15} /> Add {q.trim()}</button></div>}
                {(!friendsLoaded || (!friendsReady && friends.length > 0)) && <div className="vc-loading"><i /><i /><i /></div>}
                {friendsReady && online.length > 0 && <><div className="hm-sub">Online - {online.length}</div><div className="hm-grid">{online.map(friendRow)}</div></>}
                {friendsReady && offline.length > 0 && <><div className="hm-sub">Offline - {offline.length}</div><div className="hm-grid off">{offline.map(friendRow)}</div></>}
              </div>
            )}

            {tab === 'requests' && (
              <div className="hm-body" key="requests">
                <div className="hm-sub">Wants to be your friend - {reqs.incoming.length}</div>
                {!reqs.incoming.length && <div className="hm-none">Nobody right now.</div>}
                <div className="hm-grid">{reqs.incoming.map(r => (
                  <div key={r.id} className="hm-friend"><span className="hm-friend-who"><Avatar user={{ username: r.from_username, pfp: r.pfp_url }} size={34} /><span><b>{r.from_username}</b><small>Friend request</small></span></span>
                    <button type="button" className="vc-round ok" title="Accept" onClick={() => answer(r.id, true)}><Check size={16} /></button>
                    <button type="button" className="vc-round no" title="Decline" onClick={() => answer(r.id, false)}><X size={16} /></button></div>))}</div>
                <div className="hm-sub">Wants to message you - {dmIn.length}</div>
                {!dmIn.length && <div className="hm-none">No message requests.</div>}
                <div className="hm-grid">{dmIn.map(r => (
                  <div key={r.id} className="hm-friend"><span className="hm-friend-who"><Avatar user={{ username: r.username, pfp: r.pfp }} size={34} /><span><b><NameText u={{ username: r.username }} fallback={r.username} /></b><small>Message request</small></span></span>
                    <button type="button" className="vc-round ok" title="Accept" onClick={() => answerDm(r.id, true)}><Check size={16} /></button>
                    <button type="button" className="vc-round no" title="Decline" onClick={() => answerDm(r.id, false)}><X size={16} /></button></div>))}</div>
                <div className="hm-sub">You sent - {reqs.outgoing.length}</div>
                {!reqs.outgoing.length && <div className="hm-none">No requests waiting on someone else.</div>}
                <div className="hm-grid">{reqs.outgoing.map(r => (
                  <div key={r.id} className="hm-friend"><span className="hm-friend-who"><Avatar user={{ username: r.to_username }} size={34} /><span><b>{r.to_username}</b><small>Waiting for them</small></span></span>
                    <button type="button" className="vc-round no" title="Cancel request" aria-label={`Cancel the request to ${r.to_username}`} onClick={() => cancel(r)}><X size={16} /></button></div>))}</div>
                {dmReqs?.can_turn_off && (
                  <label className="hm-check"><input type="checkbox" checked={dmReqs.requests_on} onChange={e => setDmOn(e.target.checked)} /> Ask me before people I don't know can message me</label>
                )}
              </div>
            )}

            {tab === 'blocked' && (
              <div className="hm-body" key="blocked">
                {!blocks?.length && <div className="hm-empty"><ShieldOff size={26} /><b>You haven't blocked anyone</b><span>People you block show up here.</span></div>}
                <div className="hm-grid">{blocks?.map(b => (
                  <div key={b.username} className="hm-friend"><span className="hm-friend-who"><Avatar user={{ username: b.username, pfp: b.pfp_url || people[b.username]?.pfp }} size={34} /><span><b>{b.username}</b><small>Blocked</small></span></span>
                    <button type="button" className="btn btn-surface btn-sm" onClick={() => unblock(b.username)}>Unblock</button></div>))}</div>
              </div>
            )}

            {tab === 'groups' && (
              <div className="hm-body" key="groups">
                <div className="hm-grid">
                  <button type="button" className="hm-friend hm-new" onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'group' } }))}><span className="hm-friend-who"><span className="hm-ico"><Plus size={18} /></span><span><b>New group chat</b><small>Up to 10 people</small></span></span></button>
                  {groups.map(g => (
                    <button type="button" key={g.room} className="hm-friend" onClick={() => go({ kind: 'group', room: g.room })}><span className="hm-friend-who"><span className="hm-ico"><UsersRound size={17} /></span><span><b>{g.name}</b><small>{g.members.length} members</small></span></span><ChevronRight size={16} className="hm-chev" /></button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'catchup' && <div className="hm-body dash" key="catchup"><Dashboard onUser={onUser} onTab={setTab} bare /></div>}
            {tab === 'saved' && <div className="hm-body hm-saved" key="saved"><SavedList /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
