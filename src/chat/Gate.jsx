// What shows where there's nothing to show yet: a server whose instance isn't connected / signed in (instead of its channels),
// and Nookara-only places (friends, DMs, groups) while you're signed out of Nookara.
import { useState } from 'react';
import { ShieldCheck, LogIn, RefreshCw, Users, Server, TriangleAlert, Trash2, KeyRound, Globe, Ban, LifeBuoy, LogOut, UserRound, Moon, Unplug } from 'lucide-react';
import { useChat, go, toast, errorText, ask, RESTRICTED_TEXT } from './store.js';
import { initials } from './initials.js';
import { reconnect, joinCommunity, removeInstance } from './instances.js';
import { joinLabel, joinHint } from './community.js';
import { startSignIn, signOutHome } from './session.js';
import { HomeserverLogin } from './HomeserverLogin.jsx';
import { useHomeSession } from './homeSessions.js';
import { signOut, savedAccounts, switchTo } from './profileActions.js';
import { StatusLink } from './StatusLink.jsx';
import { statusIdForHost } from './status.js';
import { homeDomainOf } from './homeservers.js';
import { serverOfInst } from './addresses.js';
import { K } from './ids.js';
import { lockText, SUPPORT_URL } from './gateText.jsx';
import { RetryIn } from './RetryIn.jsx';

const dialog = (kind, extra) => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind, ...extra } }));

function Box({ icon, spin, title, children }) {
  return (
    <div className="vc-gate" role="status">
      <div className="vc-gate-box vl-rise">
        {spin ? <i className="vc-ring vc-gate-ring" aria-hidden="true" /> : icon}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Ember and DMs are off for the account (store.js lockAccount: staff switched them off, or Nookara's birthday gate): this is
// the whole app, nothing else of Ember shows. Signing out / another saved account on this device still works (that's the
// account, not Ember); it lifts by itself (the `restrictions` push, e.g. the moment the birthday is saved).
export function LockedScreen() {
  const me = useChat(s => s.me);
  const reason = useChat(s => s.lockReason);
  const [busy, setBusy] = useState('');
  const others = savedAccounts().filter(a => a.username.toLowerCase() !== String(me?.username || '').toLowerCase()).slice(0, 3);
  const L = lockText(reason);
  return (
    <Box icon={L.icon} title={L.title}>
      <p>{L.text}</p>
      <div className="vc-gate-btns">{L.action}</div>
      <div className="vc-gate-links">
        {others.map(a => <button key={a.username} type="button" className="vc-gate-link" disabled={!!busy} onClick={() => switchTo(a, setBusy)}><UserRound size={12} /> {busy === a.username ? 'Switching...' : `Use ${a.username}`}</button>)}
        <button type="button" className="vc-gate-link" disabled={!!busy} onClick={() => { setBusy('-'); signOut(); }}><LogOut size={12} /> {busy === '-' ? 'Signing out...' : me?.username ? `Sign out of ${me.username}` : 'Sign out'}</button>
      </div>
    </Box>
  );
}

// The login screen: nookara.cc (the default homeserver) or another one. Signed in on a homeserver already (and not with
// Nookara): that account, and what it can't do yet.
export function SignInPrompt({ what = 'direct messages, group chats and friends', nookaraOnly = null, back }) {
  const home = useHomeSession();
  if (home) { // (your profile, DMs, group chats and friends are on your homeserver: only what Nookara itself hosts needs Nookara)
    return (
      <Box icon={<ShieldCheck size={34} />} title={`Signed in as ${home.account.handle}`}>
        <p>Your account, profile, direct messages, group chats and friends are on {home.name}.{nookaraOnly ? ` ${nookaraOnly} need a Nookara account.` : ''}</p>
        {nookaraOnly && <div className="vc-gate-btns"><button type="button" className="btn btn-primary" onClick={() => startSignIn(back)}><ShieldCheck size={15} /> Sign in with Nookara</button></div>}
        <div className="vc-gate-links"><button type="button" className="vc-gate-link" onClick={() => signOutHome(home.origin)}><LogOut size={12} /> Sign out of {home.account.handle}</button></div>
      </Box>
    );
  }
  return (
    <Box icon={<ShieldCheck size={34} />} title="Sign in to Ember">
      <p>Your account lives on a homeserver and is needed for {what}.</p>
      <HomeserverLogin back={back} />
    </Box>
  );
}

// the whole sidebar of Home while signed out
export function SignedOutSidebar() {
  return (
    <div className="vc-side">
      <div className="vc-side-head" />
      <div className="vc-side-list"><div className="vc-side-empty">Your direct messages, group chats and friends show here once you're signed in.</div></div>
    </div>
  );
}

// view.kind === 'instance': the server's sidebar and channels stay out until its socket is up and signed in
export function InstanceGate({ origin }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const then = useChat(s => (s.view.kind === 'instance' && s.view.inst === origin ? s.view.then?.sid || null : null)); // (the server it is opening, on a homeserver with several)
  const srv = useChat(s => serverOfInst(s.servers, origin, { viewSid: then, communitySid: s.instances.find(i => i.origin === origin)?.community?.sid }));
  const lockReason = useChat(s => s.lockReason);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  if (!inst) return null;
  const { status, community } = inst;
  const host = inst.v2 ? homeDomainOf(inst, srv) : inst.host; // (a server on a homeserver: the homeserver's domain, not where it runs)
  const name = community?.name || inst.name;
  const retry = <button type="button" className="btn btn-surface" onClick={() => reconnect(origin)}><RefreshCw size={15} /> Retry</button>;
  const remove = <button type="button" className="btn btn-surface" onClick={async () => { if (await ask({ title: `Remove ${name}?`, text: `${host} leaves your server list. Your account there stays as it is - you can add it again any time.`, confirm: 'Remove from list', danger: true })) removeInstance(origin); }}><Trash2 size={15} /> Remove from list</button>;

  if ((status === 'connecting' && !inst.failed) || (srv && status === 'open')) return <Box spin title={`Connecting to ${name || host}`}><p>Establishing connection to chat server</p><small className="vc-gate-host"><Globe size={12} /> {host}</small></Box>;
  if (status === 'asleep') { // sleep mode let it go, or you disconnected it: opening it again is one click
    return (
      <Box icon={inst.sleep === 'manual' ? <Unplug size={34} /> : <Moon size={34} />} title={inst.sleep === 'manual' ? `You disconnected ${name || host}` : `${name || host} is asleep`}>
        <p>{inst.sleep === 'manual' ? 'It stays off until you connect it again.' : "Nobody was chatting there, so Ember let it go to save data. It checks for new messages every few minutes."}</p>
        <div className="vc-gate-btns"><button type="button" className="btn btn-primary" onClick={() => reconnect(origin)}><RefreshCw size={15} /> Connect</button></div>
      </Box>
    );
  }
  if (status === 'login') {
    return (
      <Box icon={<KeyRound size={34} />} title={`Signed out of ${host}`}>
        <p>{inst.needsNookara ? 'This server signs you in with your Nookara account.' : 'Log in to open this server.'}</p>
        <div className="vc-gate-btns">
          {inst.needsNookara ? <button type="button" className="btn btn-primary" onClick={() => startSignIn()}><ShieldCheck size={15} /> Sign in with Nookara</button>
            : <button type="button" className="btn btn-primary" onClick={() => (inst.v2 && inst.source ? dialog('chat-settings', { page: 'homeservers' }) : dialog('add-instance', { url: origin }))}><LogIn size={15} /> {inst.v2 ? `Sign in to ${host}` : 'Log in'}</button>}
          {retry}
        </div>
      </Box>
    );
  }
  if (status === 'restricted') { // Ember is off for this account: calm and final until it's switched back (the socket tells us)
    const L = lockReason && lockReason !== 'staff' ? lockText(lockReason) : null; // (Nookara's birthday gate: its own words, not the instance's)
    return (
      <Box icon={L ? L.icon : <Ban size={34} />} title={L ? L.title : 'Ember is switched off'}>
        <small className="vc-gate-host"><Globe size={12} /> {host}</small>
        <p>{L ? L.text : `${inst.restricted || RESTRICTED_TEXT} Contact Nookara support if you think this is a mistake.`}</p>
        <div className="vc-gate-btns">{L ? L.action : <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer"><LifeBuoy size={15} /> Nookara support</a>}</div>
      </Box>
    );
  }
  if (status === 'banned') return <Box icon={<TriangleAlert size={34} />} title={`You're banned from ${host}`}><div className="vc-gate-btns">{remove}</div></Box>;
  if (status !== 'open') { // (also while it retries by itself: the box stays put until a try works)
    return (
      <Box icon={<Server size={34} />} title={inst.error === 'homeserver_rate_limited' ? `${host} is busy` : `Couldn't reach ${host}`}>
        {inst.error === 'homeserver_rate_limited' && <p>It's getting a lot of sign-ins right now. It's tried again once it says it's ready.</p>}
        {inst.error && inst.error !== 'instance_unreachable' && inst.error !== 'homeserver_rate_limited' && <p>{errorText(inst.error === 'insufficient_scope' ? 'inst_scope' : inst.error)}</p>}
        <RetryIn at={inst.retryAt} busy={status === 'connecting'} />
        <div className="vc-gate-btns"><button type="button" className="btn btn-primary" onClick={() => reconnect(origin)}><RefreshCw size={15} /> Retry now</button>{statusIdForHost(inst.host) && <StatusLink id={statusIdForHost(inst.host)} className="btn btn-surface" size={15} />}{remove}</div>
      </Box>
    );
  }
  // connected, signed in, but not in the community yet (or there isn't one yet)
  if (!community) {
    return (
      <Box icon={<Server size={34} />} title={inst.claimed ? `${host} isn't set up yet` : `Nobody owns ${host} yet`}>
        <p>{inst.claimed ? 'Its owner has not made the server yet.' : 'Whoever has its setup code can claim it and set it up.'}</p>
        <div className="vc-gate-btns">{(!inst.claimed || inst.isAdmin) && <button type="button" className="btn btn-primary" onClick={() => dialog('setup', { origin })}>Set it up</button>}{remove}</div>
      </Box>
    );
  }
  async function join(c, which) {
    setBusy(which || true);
    try {
      const r = await joinCommunity(origin, c, c ? undefined : pass, which);
      if (r.pending) toast(`Asked to join ${name}.`, true); else go({ kind: 'server', sid: r.sid });
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  // a homeserver with several servers: the ones it lists, each with its own Join (an invite or an address finds the others)
  const listed = inst.v2 ? (inst.communities || []).filter(c => c && c.sid != null) : [];
  if (listed.length > 1) {
    return (
      <Box icon={<Server size={34} />} title={`Servers on ${host}`}>
        <p>Pick one to join with your account. Servers it doesn't list can be joined with an invite or their address.</p>
        <div className="vc-rows vc-gate-list">
          {listed.map(c => {
            const mine = srv && srv.sid === K(origin, c.sid);
            return (
              <div key={c.sid} className="vc-list-row vc-ch-row">
                <span className="vc-ch-ico">{c.icon_url ? <img src={c.icon_url} alt="" /> : initials(c.name)}</span>
                <span className="vc-list-txt"><b>{c.name}</b><small>{c.address || host} - <Users size={11} /> {c.member_count}</small></span>
                {mine ? <button type="button" className="btn btn-surface btn-sm" onClick={() => go({ kind: 'server', sid: srv.sid })}>Open</button>
                  : c.join_policy !== 'invite' && c.join_policy !== 'password' && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => join(undefined, String(c.sid))}>{busy === String(c.sid) ? 'Joining...' : joinLabel(c.join_policy, 'Join')}</button>}
              </div>
            );
          })}
        </div>
        <form className="vc-row vc-gate-code" onSubmit={e => { e.preventDefault(); if (code.trim()) join(code); }}>
          <input className="form-input" placeholder="Invite code or link" value={code} onChange={e => setCode(e.target.value)} />
          <button type="submit" className="btn btn-surface" disabled={!code.trim() || !!busy}>Join with invite</button>
        </form>
        <div className="vc-gate-btns">{remove}</div>
      </Box>
    );
  }
  return (
    <Box icon={<span className="vc-srv-ico lg">{community.icon_url ? <img src={community.icon_url} alt="" /> : initials(name)}</span>} title={name}>
      {community.description && <p>{community.description}</p>}
      <small><Users size={13} className="vc-inline-ico" /> {community.member_count} member{community.member_count === 1 ? '' : 's'} - {host}</small>
      {joinHint(community.join_policy) && <p className="vc-hint">{joinHint(community.join_policy)}</p>}
      {community.join_policy === 'password' && !inst.pending && (
        <form className="vc-row vc-gate-code" onSubmit={e => { e.preventDefault(); if (pass) join(); }}>
          <input className="form-input" type="password" autoComplete="off" placeholder="Server password" aria-label="Server password" value={pass} onChange={e => setPass(e.target.value)} />
        </form>
      )}
      <div className="vc-gate-btns">
        {inst.pending ? <button type="button" className="btn btn-surface" disabled>Request sent</button>
          : community.join_policy !== 'invite' && <button type="button" className="btn btn-primary" disabled={busy || (community.join_policy === 'password' && !pass)} onClick={() => join()}>{joinLabel(community.join_policy, 'Join server')}</button>}
        {remove}
      </div>
      <form className="vc-row vc-gate-code" onSubmit={e => { e.preventDefault(); if (code.trim()) join(code); }}>
        <input className="form-input" placeholder="Invite code or link" value={code} onChange={e => setCode(e.target.value)} />
        <button type="submit" className="btn btn-surface" disabled={!code.trim() || busy}>Join with invite</button>
      </form>
    </Box>
  );
}
