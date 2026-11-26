// Home, the sidebar and a DM's header while Ember runs on a v2 homeserver session (PROTOCOL 4c): friends, requests, blocks
// and DMs come from the home homeserver's social API (store.js: state.social), not from Nookara. A DM here is a hidden
// one-channel server on the homeserver that hosts it, so the conversation itself is the normal channel view.
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, UserPlus, Check, X, House, Users, Inbox, ShieldOff, UsersRound, Search, Plus, LockOpen, Pencil, LogOut, UserMinus, Ban } from 'lucide-react';
import { useChat, go, toast, ask, getState, addSocialFriend, socialFriendAction, startSocialDm, socialDmAction, socialProfileById } from './store.js';
import { Avatar } from './Profile.jsx';
import { Dialog } from './Dialogs.jsx';
import { openMenu } from './Menu.jsx';
import { accountName, shownHandle, dmTitle, dmUnread, sameAccount } from './social.js';
import './dashboard.css';
import './home.css';

const STATUS = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };
const hourWord = h => (h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
const face = a => ({ username: a.id, pfp: a.avatar_url || null });
const useDomain = () => useChat(s => s.home?.domain || '');

// someone's card: what their homeserver says about them (GET /social/profile/:id), and what I can do
function PersonCard({ person, onClose }) {
  const domain = useDomain();
  const social = useChat(s => s.social);
  const [p, setP] = useState(null);
  useEffect(() => { let gone = false; socialProfileById(person.id).then(x => !gone && setP(x || {})).catch(() => !gone && setP({})); return () => { gone = true; }; }, [person.id]);
  const who = { ...person, ...(p || {}) };
  const isFriend = social.friends.some(f => f.id === person.id), blocked = social.blocked.some(f => f.id === person.id);
  const status = p?.presence?.status || social.presence[person.id] || 'offline';
  return (
    <Dialog title={accountName(who, domain)} sub={shownHandle(who, domain) ? `@${shownHandle(who, domain)}` : undefined} onClose={onClose}>
      {close => (
        <div className="sh-card">
          <div className="sh-card-top"><Avatar user={face(who)} size={64} status={status} /><div><b>{STATUS[status]}{p?.presence?.activity ? ` - ${p.presence.activity}` : ''}</b>{who.pronouns && <small>{who.pronouns}</small>}{p?.stale && <small>Their homeserver can't be reached right now.</small>}</div></div>
          {who.bio && <p className="sh-bio">{who.bio}</p>}
          <div className="dialog-actions">
            {!blocked && <button type="button" className="btn btn-primary" onClick={() => { close(); startSocialDm({ ids: [person.id] }); }}><MessageCircle size={15} /> Message</button>}
            {!isFriend && !blocked && <button type="button" className="btn btn-surface" onClick={() => { close(); addSocialFriend(who.handle || person.handle || ''); }}><UserPlus size={15} /> Add friend</button>}
            {isFriend && <button type="button" className="btn btn-surface" onClick={async () => { if (await ask({ title: `Remove ${accountName(who, domain)} from your friends?`, confirm: 'Remove friend', danger: true })) { close(); socialFriendAction('remove', person.id); } }}><UserMinus size={15} /> Remove friend</button>}
            <button type="button" className="btn btn-surface" onClick={async () => { if (blocked || await ask({ title: `Block ${accountName(who, domain)}?`, text: "They can't send you friend requests or start conversations with you. They aren't told.", confirm: 'Block', danger: true })) { close(); socialFriendAction(blocked ? 'unblock' : 'block', person.id); } }}><Ban size={15} /> {blocked ? 'Unblock' : 'Block'}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// start a conversation: friends to tick, and names to type for anyone else
function NewDm({ onClose }) {
  const domain = useDomain();
  const friends = useChat(s => s.social.friends);
  const [picked, setPicked] = useState(() => new Set());
  const [typed, setTyped] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const handles = typed.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
  const n = picked.size + handles.length;
  const toggle = id => setPicked(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  return (
    <Dialog title="New conversation" sub="One person makes a direct message, more make a group (up to 10 of you)." onClose={onClose}>
      {close => (
        <form onSubmit={async e => { e.preventDefault(); if (!n || busy) return; setBusy(true); const dm = await startSocialDm({ ids: [...picked], handles, name: n > 1 ? name.trim() : '', group: n > 1 }); setBusy(false); if (dm) close(); }}>
          {friends.length > 0 && <div className="sh-pick">{friends.map(f => (
            <label key={f.id} className="sh-pick-row"><input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} /><Avatar user={face(f)} size={26} /><span>{accountName(f, domain)}</span><small>{shownHandle(f, domain)}</small></label>
          ))}</div>}
          <label className="vc-field"><span>{friends.length ? 'Anyone else' : 'Who'}</span><input value={typed} onChange={e => setTyped(e.target.value)} placeholder="alice, bob@example.org" autoFocus={!friends.length} /></label>
          {n > 1 && <label className="vc-field"><span>Group name (optional)</span><input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>}
          <p className="vc-hint sh-noe2ee"><LockOpen size={13} /> Conversations on homeservers are not end-to-end encrypted yet.</p>
          <div className="dialog-actions"><button type="button" className="btn btn-surface" onClick={close}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!n || busy}>{n > 1 ? 'Create group' : 'Message'}</button></div>
        </form>
      )}
    </Dialog>
  );
}

const dmMenu = (e, dm, domain) => {
  const me = getState().home?.id;
  const title = dmTitle(dm, domain);
  openMenu(e, [
    { label: 'Open', onClick: () => go({ kind: 'sdm', id: dm.id }) },
    dm.group && { label: 'Rename group', icon: Pencil, onClick: async () => { const name = window.prompt('Group name', dm.name || ''); if (name != null && name.trim()) socialDmAction('rename', dm.id, name.trim().slice(0, 60)); } },
    dm.group && sameAccount(dm.owner, me, domain) && dm.others.length > 0 && { label: 'Remove someone', icon: UserMinus, sub: dm.others.map(m => ({ label: accountName(m, domain), onClick: async () => { if (await ask({ title: `Remove ${accountName(m, domain)} from ${title}?`, confirm: 'Remove', danger: true })) socialDmAction('remove', dm.id, m.id); } })) },
    dm.group && { label: 'Leave group', icon: LogOut, danger: true, onClick: async () => { if (await ask({ title: `Leave ${title}?`, text: 'Someone in the group will have to add you back.', confirm: 'Leave group', danger: true })) socialDmAction('leave', dm.id); } },
  ]);
};
function DmFace({ dm, size, presence }) {
  if (dm.group || !dm.others.length) return <span className="vc-av vc-grp-av" style={{ width: size, height: size }}><UsersRound size={Math.round(size / 2)} /></span>;
  const o = dm.others[0];
  return <Avatar user={face(o)} size={size} status={presence[o.id] || 'offline'} />;
}

export function SocialSidebar() {
  const view = useChat(s => s.view);
  const dms = useChat(s => s.social.dms);
  const presence = useChat(s => s.social.presence);
  const reqs = useChat(s => s.social.incoming.length);
  const domain = useDomain();
  const [fresh, setFresh] = useState(false);
  return (
    <div className="vc-side">
      <div className="vc-side-head"><button type="button" className="vc-quick" onClick={() => setFresh(true)}><span>New conversation</span><Plus size={15} /></button></div>
      <div className="vc-side-scroll">
        <div className="vc-side-list">
          <button type="button" className={`vc-ch vc-home-link${view.kind === 'home' ? ' on' : ''}`} onClick={() => go({ kind: 'home' })}><House size={18} /> <span>Home</span>{reqs > 0 && <span className="vc-count">{reqs}</span>}</button>
          {dms.map(dm => {
            const on = view.dm === dm.id;
            return (
              <button type="button" key={dm.id} className={`vc-dm${on ? ' on' : ''}${!on && dm.unread ? ' unread' : ''}`} onClick={() => go({ kind: 'sdm', id: dm.id })} onContextMenu={e => dmMenu(e, dm, domain)}>
                <DmFace dm={dm} size={32} presence={presence} />
                <span className="vc-dm-txt"><b>{dmTitle(dm, domain)}</b><small>{dm.group ? `${dm.members.length} members` : !dm.hosted_here && dm.host && dm.host !== domain ? `on ${dm.host}` : dm.preview && !on ? dm.preview : ''}</small></span>
                {dm.unread > 0 && !on && <span className="vc-count">{dm.unread > 99 ? '99+' : dm.unread}</span>}
              </button>
            );
          })}
          {!dms.length && <div className="vc-side-empty">No conversations yet. Start one with a friend, or with anyone by their name.</div>}
        </div>
      </div>
      {fresh && <NewDm onClose={() => setFresh(false)} />}
    </div>
  );
}

// what the header of a DM shows instead of a channel name
export function SocialDmHead({ id }) {
  const dm = useChat(s => s.social.dms.find(x => x.id === id));
  const presence = useChat(s => s.social.presence);
  const domain = useDomain();
  const [card, setCard] = useState(null);
  if (!dm) return <b className="vc-head-name">Conversation</b>;
  const one = !dm.group && dm.others[0];
  return (
    <>
      <button type="button" className="vc-head-user" onClick={e => (one ? setCard(one) : dmMenu(e, dm, domain))}>
        <DmFace dm={dm} size={26} presence={presence} />
        <b className="vc-head-name">{dmTitle(dm, domain)}</b>
      </button>
      <span className="vc-head-topic sh-noe2ee" title="Homeservers can read conversations they host. End-to-end encryption for them is not there yet."><LockOpen size={13} /> Not end-to-end encrypted</span>
      {!dm.hosted_here && dm.host && <span className="vc-head-topic">on {dm.host}</span>}
      {card && <PersonCard person={card} onClose={() => setCard(null)} />}
    </>
  );
}

export default function SocialHome() {
  const me = useChat(s => s.me);
  const home = useChat(s => s.home);
  const social = useChat(s => s.social);
  const servers = useChat(s => s.servers);
  const domain = home?.domain || '';
  const [tab, setTab] = useState('friends');
  const [q, setQ] = useState('');
  const [card, setCard] = useState(null);
  const [fresh, setFresh] = useState(false);
  const needle = q.trim().toLowerCase().replace(/^@/, '');
  const match = f => !needle || accountName(f, domain).toLowerCase().includes(needle) || String(f.handle || '').toLowerCase().includes(needle);
  const st = f => social.presence[f.id] || 'offline';
  const shown = social.friends.filter(match);
  const online = shown.filter(f => st(f) !== 'offline'), offline = shown.filter(f => st(f) === 'offline');
  const recent = useMemo(() => social.dms.slice(0, 10), [social.dms]);
  const unreadN = dmUnread(social.dms);
  const tabs = [['friends', Users, 'Friends', social.friends.length, false], ['requests', Inbox, 'Requests', social.incoming.length, true], ['blocked', ShieldOff, 'Blocked', social.blocked.length, false]];
  const row = (f, sub, tools) => (
    <div key={f.id} className="hm-friend vl-rise">
      <button type="button" className="hm-friend-who" onClick={() => setCard(f)}>
        <Avatar user={face(f)} size={34} status={sub == null ? st(f) : undefined} />
        <span><b>{accountName(f, domain)}</b><small>{sub ?? STATUS[st(f)]}{shownHandle(f, domain) && shownHandle(f, domain).includes('@') ? ` - ${shownHandle(f, domain)}` : ''}</small></span>
      </button>
      {tools}
    </div>
  );
  const add = () => addSocialFriend(q).then(ok => { if (ok) setQ(''); });
  return (
    <div className="vc-home">
      <div className="vc-home-main">
        <div className="vc-head"><House size={20} className="vc-head-ico" /><b className="vc-head-name">Home</b></div>
        <div className="vc-home-body hm">
          <div className="hm-wrap">
            <header className="hm-hello vl-rise">
              {me && <Avatar user={{ username: me.username, pfp: me.pfp }} size={46} status="online" />}
              <div>
                <h2>{hourWord(new Date().getHours())}{me ? `, ${me.display_name || me.username}` : ''}</h2>
                <p>{home?.account?.handle} - {online.length} {online.length === 1 ? 'friend' : 'friends'} online{unreadN ? ` - ${unreadN} unread ${unreadN === 1 ? 'message' : 'messages'}` : ''}</p>
              </div>
            </header>
            {!servers.length && (
              <section className="hm-tip vl-rise" style={{ '--i': 1 }}>
                <span className="hm-tip-ico"><Search size={20} /></span>
                <div><b>Find your people</b><span>You're not in any servers yet. Look around Discovery, or join one by its address.</span></div>
                <button type="button" className="btn btn-surface" onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'discover' } }))}>Explore servers</button>
              </section>
            )}
            <nav className="hm-tabs" role="tablist">
              {tabs.map(([k, Icon, label, n, hot]) => (
                <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon size={15} /> {label}{n > 0 && <i className={hot ? 'hot' : ''}>{n > 99 ? '99+' : n}</i>}</button>
              ))}
              <button type="button" onClick={() => setFresh(true)}><Plus size={15} /> New conversation</button>
            </nav>
            {tab === 'friends' && (
              <form className="hm-search" onSubmit={e => { e.preventDefault(); if (needle && !shown.length) add(); }}>
                <Search size={16} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a friend, or add someone: alice or alice@example.org" aria-label="Find a friend or add someone" />
                <button type="button" className="hm-search-add" title={q.trim() ? `Send a friend request to ${q.trim()}` : 'Type a name to add someone'} disabled={!q.trim()} onClick={add}><UserPlus size={16} /></button>
              </form>
            )}
            {tab === 'friends' && (
              <div className="hm-body" key="friends">
                {recent.length > 0 && !needle && (
                  <>
                    <div className="hm-sub">Recent chats</div>
                    <div className="hm-recent">
                      {recent.map(dm => (
                        <button type="button" key={dm.id} className="hm-tile vl-rise" onClick={() => go({ kind: 'sdm', id: dm.id })} onContextMenu={e => dmMenu(e, dm, domain)}>
                          <DmFace dm={dm} size={44} presence={social.presence} />
                          <b>{dmTitle(dm, domain)}</b>
                          {dm.unread > 0 && <i>{dm.unread > 99 ? '99+' : dm.unread}</i>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {!social.loaded && <div className="vc-loading"><i /><i /><i /></div>}
                {social.loaded && !social.friends.length && <div className="hm-empty"><UserPlus size={28} /><b>No friends yet</b><span>Type someone's name above to send them a request. People on other homeservers are name@their.homeserver.</span></div>}
                {social.friends.length > 0 && needle && !shown.length && <div className="hm-empty"><Search size={24} /><b>None of your friends match "{q.trim()}"</b><button type="button" className="btn btn-primary" onClick={add}><UserPlus size={15} /> Add {q.trim()}</button></div>}
                {online.length > 0 && <><div className="hm-sub">Online - {online.length}</div><div className="hm-grid">{online.map(f => row(f, null, <button type="button" className="hm-friend-msg" title={`Message ${accountName(f, domain)}`} onClick={() => startSocialDm({ ids: [f.id] })}><MessageCircle size={16} /></button>))}</div></>}
                {offline.length > 0 && <><div className="hm-sub">Offline - {offline.length}</div><div className="hm-grid off">{offline.map(f => row(f, null, <button type="button" className="hm-friend-msg" title={`Message ${accountName(f, domain)}`} onClick={() => startSocialDm({ ids: [f.id] })}><MessageCircle size={16} /></button>))}</div></>}
              </div>
            )}
            {tab === 'requests' && (
              <div className="hm-body" key="requests">
                <div className="hm-sub">Wants to be your friend - {social.incoming.length}</div>
                {!social.incoming.length && <div className="hm-none">Nobody right now.</div>}
                <div className="hm-grid">{social.incoming.map(r => row(r, r.message || 'Friend request', <>
                  <button type="button" className="vc-round ok" title="Accept" onClick={() => socialFriendAction('accept', r.id).then(ok => ok && toast(`You and ${accountName(r, domain)} are friends now!`, true))}><Check size={16} /></button>
                  <button type="button" className="vc-round no" title="Decline" onClick={() => socialFriendAction('remove', r.id)}><X size={16} /></button></>))}</div>
                <div className="hm-sub">You sent - {social.outgoing.length}</div>
                {!social.outgoing.length && <div className="hm-none">No requests waiting on someone else.</div>}
                <div className="hm-grid">{social.outgoing.map(r => row(r, 'Waiting for them', <button type="button" className="vc-round no" title="Cancel request" onClick={async () => { if (await ask({ title: `Cancel your request to ${accountName(r, domain)}?`, confirm: 'Cancel request', cancel: 'Keep it', danger: true })) socialFriendAction('remove', r.id); }}><X size={16} /></button>))}</div>
              </div>
            )}
            {tab === 'blocked' && (
              <div className="hm-body" key="blocked">
                {!social.blocked.length && <div className="hm-empty"><ShieldOff size={26} /><b>You haven't blocked anyone</b><span>People you block show up here.</span></div>}
                <div className="hm-grid">{social.blocked.map(b => row(b, 'Blocked', <button type="button" className="btn btn-surface btn-sm" onClick={() => socialFriendAction('unblock', b.id)}>Unblock</button>))}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      {card && <PersonCard person={card} onClose={() => setCard(null)} />}
      {fresh && <NewDm onClose={() => setFresh(false)} />}
    </div>
  );
}
