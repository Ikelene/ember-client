// Settings > Signed-in accounts (every account on this device: Nookara, the other saved Nookara accounts, and each Ember
// server's own sign-in) and Settings > Server hosting (the Ember servers Nookara hosts for this account).
// Both take an optional onClose: called after Open / Manage take you somewhere else, so the settings dialog can step aside.
import { useEffect, useState } from 'react';
import { CircleUserRound, Server, ExternalLink, LogOut, ArrowRight, RefreshCw, Trash2, LogIn, Plus, Settings2, Archive, Globe, Users, Repeat, CalendarClock } from 'lucide-react';
import { SettingsPage, SCard } from './ui.jsx';
import { useChat, ask, go, toast } from '../store.js';
import { getToken, apiFetch } from '../../api.js';
import { removeInstance, reconnect, dropVeloraSessions } from '../instances.js';
import { startSignIn } from '../session.js';
import { signOut, savedAccounts, switchTo } from '../ProfilePopout.jsx';
import { Avatar } from '../Profile.jsx';
import { ServerIcon } from '../ServerIcon.jsx';
import { loadHosted, billingState } from '../Hosting.jsx';
import { siteHref } from '../hosts.js';
import { normOrigin } from '../ids.js';
import './accounts-pages.css';

const NONE = []; // (a selector must return the same empty list every time)
const dialog = detail => dispatchEvent(new CustomEvent('vc-dialog', { detail }));
// links open in the browser (the desktop app hands them to the system's browser), like SettingsDialog's help links
function openOutside(url) {
  const abs = new URL(url, location.origin).href;
  const d = window.bonfireDesktop;
  if (d?.openExternal) { Promise.resolve(d.openExternal(abs)).catch(() => {}); return; }
  window.open(abs, '_blank', 'noopener,noreferrer');
}
const STATUS = { open: ['ok', 'Connected'], connecting: ['', 'Connecting...'], closed: ['warn', 'Not connected'], error: ['warn', "Can't connect"], restricted: ['warn', 'Ember is off for your account'] };
// the community on an instance, once you're in it
const useCommunity = origin => useChat(s => s.servers.find(x => x.inst === origin) || null);

// ── Signed-in accounts ──
export function AccountsPage({ onClose }) {
  const me = useChat(s => s.me);
  const signedIn = useChat(s => s.signedIn);
  const instances = useChat(s => s.instances || NONE);
  const localInstances = instances.filter(i => i.mode !== 'velora' && !i.needsVelora); // (Nookara-linked ones are left out, see Server accounts)
  const [busy, setBusy] = useState('');
  const others = signedIn ? savedAccounts().filter(a => a.username.toLowerCase() !== String(me?.username || '').toLowerCase()) : [];

  async function signOutNookara() {
    if (!(await ask({ title: 'Sign out of Nookara?', text: 'Ember signs out on this device. Servers that use Nookara sign-in sign out too.', confirm: 'Sign out', danger: true }))) return;
    await signOut();
  }
  async function signOutAll() {
    const own = instances.filter(i => i.mode !== 'velora');
    const text = `You'll be signed out of Nookara${own.length ? `, and ${own.length === 1 ? 'the server with its own account is' : `the ${own.length} servers with their own accounts are`} removed from your server list${getToken() ? ' on every device' : ''}. You can add ${own.length === 1 ? 'it' : 'them'} back any time` : ''}.`;
    if (!(await ask({ title: 'Sign out of everything?', text, confirm: 'Sign out of everything', danger: true }))) return;
    setBusy('all');
    for (const i of own) await removeInstance(i.origin).catch(() => {}); // (before Nookara: the synced list is saved with this sign-in)
    dropVeloraSessions();
    if (signedIn) await signOut();
    else setBusy('');
  }

  return (
    <SettingsPage icon={CircleUserRound} title="Signed-in accounts" sub="Every account you're signed in to on this device.">
      <SCard className="ac-hero">
        {signedIn && me ? (
          <div className="ac-hero-in">
            <Avatar user={me} size={64} />
            <div className="ac-hero-txt">
              <small className="ac-kicker">Nookara account</small>
              <b>@{me.username}</b>
              <span className="ac-state ok">Signed in</span>
            </div>
            <div className="ac-btns">
              <button type="button" className="btn btn-primary" onClick={() => openOutside(siteHref('/me'))}><ExternalLink size={14} /> Manage Nookara account</button>
              <button type="button" className="btn btn-surface" onClick={signOutNookara}><LogOut size={14} /> Sign out</button>
            </div>
          </div>
        ) : (
          <div className="ac-hero-in">
            <span className="ac-hero-blank"><CircleUserRound size={30} /></span>
            <div className="ac-hero-txt">
              <small className="ac-kicker">Nookara account</small>
              <b>Not signed in</b>
              <span className="ac-state">Sign in to use DMs, friends and servers that use Nookara sign-in.</span>
            </div>
            <div className="ac-btns"><button type="button" className="btn btn-primary" onClick={() => startSignIn()}><LogIn size={14} /> Sign in with Nookara</button></div>
          </div>
        )}
      </SCard>

      {others.length > 0 && (
        <SCard title="Other Nookara accounts on this device" sub="Switch to one without signing in again.">
          {others.map(a => (
            <div className="sx-list-row" key={a.username}>
              <Avatar user={{ username: a.username, pfp: a.pfp }} size={36} />
              <div className="sx-row-txt"><b>@{a.username}</b><span>Saved on this device</span></div>
              <div className="sx-row-ctl">
                <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => switchTo(a, setBusy)}><Repeat size={13} /> {busy === a.username ? 'Switching...' : 'Switch'}</button>
              </div>
            </div>
          ))}
        </SCard>
      )}

      {/* only servers with their own separate sign-in (a local account there): the ones you use with your Nookara account are
          managed from the server list (Ikelene 2026-11-11) */}
      <SCard title="Server accounts" sub="Ember servers where you use a separate account instead of Nookara.">
        {localInstances.length ? localInstances.map(i => <InstanceRow key={i.origin} inst={i} onClose={onClose} />) : (
          <div className="sx-empty"><Server size={28} /><b>No separate server accounts</b><span>Servers you use with your Nookara account aren't listed here; manage them from your server list.</span></div>
        )}
      </SCard>

      {(signedIn || instances.length > 0) && (
        <SCard title="Sign out of everything" sub="Nookara, and every server on this device.">
          <div className="ac-btns end">
            <button type="button" className="btn btn-danger" disabled={busy === 'all'} onClick={signOutAll}><LogOut size={14} /> {busy === 'all' ? 'Signing out...' : 'Sign out of everything'}</button>
          </div>
        </SCard>
      )}
    </SettingsPage>
  );
}

function InstanceRow({ inst, onClose }) {
  const s = useCommunity(inst.origin);
  const name = s?.name || inst.community?.name || inst.name;
  const icon = s?.icon || inst.community?.icon_url || inst.icon;
  const u = inst.user;
  const viaNookara = inst.mode === 'velora';
  const st = STATUS[inst.status] || ['', inst.status || 'Not connected'];
  const open = () => { go(s && inst.status === 'open' ? { kind: 'server', sid: s.sid } : { kind: 'instance', inst: inst.origin }); onClose?.(); };
  const remove = async () => {
    if (!(await ask({ title: `Remove ${name}?`, text: `You're signed out of ${inst.host} and it leaves your server list${getToken() ? ' on every device' : ''}. Your account there stays - you can add it again any time.`, confirm: 'Sign out and remove', danger: true }))) return;
    await removeInstance(inst.origin);
    toast(`Signed out of ${name}.`, true);
  };
  const signIn = () => (inst.needsVelora ? startSignIn() : dialog({ kind: 'add-instance', url: inst.origin }));
  let who;
  if (inst.needsVelora) who = <span className="ac-who">Uses Nookara sign-in - sign in to Nookara first</span>;
  else if (u) who = <span className="ac-who"><Avatar user={{ username: u.username, pfp: u.pfp || u.avatar_url || u.avatar }} size={18} /> @{u.username}{viaNookara ? ' - signed in with Nookara' : ''}</span>;
  else if (viaNookara) who = <span className="ac-who">Signed in with Nookara</span>;
  else who = <span className="ac-who">Not signed in</span>;
  return (
    <div className="sx-list-row ac-inst">
      <span className="vc-srv-ico ac-ico"><ServerIcon src={icon} name={name} /></span>
      <div className="sx-row-txt">
        <b>{name}</b>
        <span className="ac-host"><Globe size={12} /> {inst.host}</span>
        {who}
        <span className={`ac-state ${st[0]}`}>{st[1]}</span>
      </div>
      <div className="sx-row-ctl ac-acts">
        <button type="button" className="btn btn-surface btn-sm" onClick={open}><ArrowRight size={13} /> Open</button>
        {(inst.needsVelora || (!u && !viaNookara)) && <button type="button" className="btn btn-surface btn-sm" onClick={signIn}><LogIn size={13} /> Sign in</button>}
        {inst.status !== 'open' && inst.status !== 'connecting' && !inst.needsVelora && <button type="button" className="btn btn-surface btn-sm" onClick={() => reconnect(inst.origin)}><RefreshCw size={13} /> Reconnect</button>}
        <button type="button" className="btn btn-surface btn-sm ac-danger" onClick={remove}><Trash2 size={13} /> Sign out and remove</button>
      </div>
    </div>
  );
}

// ── Server hosting ──
const day = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const HOST_STATUS = { running: ['ok', 'Running'], provisioning: ['', 'Starting...'], stopped: ['warn', 'Stopped'], suspended: ['warn', "Suspended by Nookara's staff"], error: ['warn', 'Something went wrong'] };
const capital = w => String(w || '').replace(/^./, c => c.toUpperCase());

export function HostingPage({ onClose }) {
  const signedIn = useChat(s => s.signedIn);
  const hosted = useChat(s => s.hosted || NONE);
  const [loaded, setLoaded] = useState(false);
  const [plans, setPlans] = useState({});
  useEffect(() => {
    if (!getToken()) { setLoaded(true); return; }
    loadHosted(true).then(() => setLoaded(true));
    apiFetch('/bonfire/hosting/plans').then(d => setPlans(Object.fromEntries((d?.plans || []).map(p => [p.id, p.name])))).catch(() => {});
  }, []);
  const create = () => { dialog({ kind: 'create-server' }); };
  const live = hosted.filter(h => h.billing !== 'archived');
  const archived = hosted.filter(h => h.billing === 'archived');

  return (
    <SettingsPage icon={Server} title="Server hosting" sub="Ember servers Nookara runs for you.">
      {!signedIn ? (
        <SCard><div className="sx-empty"><Server size={28} /><b>Sign in to see your servers</b><span>Hosted servers belong to your Nookara account.</span>
          <button type="button" className="btn btn-primary" onClick={() => startSignIn()}><LogIn size={14} /> Sign in with Nookara</button></div></SCard>
      ) : !loaded && !hosted.length ? (
        <SCard><div className="vc-loading"><i /><i /><i /></div></SCard>
      ) : !live.length ? (
        <SCard><div className="sx-empty"><Server size={28} /><b>You don't host any servers with Nookara yet</b><span>Pick a plan and Nookara starts an Ember server for you.</span>
          <button type="button" className="btn btn-primary" onClick={create}><Plus size={14} /> Create a server</button></div></SCard>
      ) : (
        <SCard title="Your servers" sub="Hosted by Nookara under this account." action={<button type="button" className="btn btn-surface btn-sm" onClick={create}><Plus size={13} /> Create a server</button>}>
          {live.map(h => <HostedRow key={h.slug || h.url} h={h} planName={plans[h.plan]} onClose={onClose} />)}
        </SCard>
      )}
      {signedIn && archived.length > 0 && (
        <SCard title="Archived" sub="Shut down. Nookara kept a backup of each in your account - restore one from Create a server.">
          {archived.map(h => <HostedRow key={h.slug || h.url} h={h} planName={plans[h.plan]} archived onClose={onClose} />)}
        </SCard>
      )}
    </SettingsPage>
  );
}

function HostedRow({ h, planName, archived, onClose }) {
  const origin = normOrigin(h.url);
  const inst = useChat(s => (origin ? s.instances.find(i => i.origin === origin) : null));
  const s = useCommunity(origin);
  const name = h.name || s?.name || inst?.community?.name || inst?.name || h.slug;
  const icon = s?.icon || inst?.community?.icon_url || inst?.icon || h.icon_url || null;
  const st = billingState(h);
  const status = HOST_STATUS[h.status] || ['', capital(h.status)];
  const host = (() => { try { return new URL(h.url).host; } catch { return h.url; } })();
  const billing = h.billing === 'pro' ? 'Covered by Nookara Pro' : h.paid_until ? (h.paid_until > Date.now() ? `Paid until ${day(h.paid_until)}` : `Ran out ${day(h.paid_until)}`) : null;
  // open it: straight into the server once you're in it, otherwise its page (it may need adding / signing in first)
  const open = () => {
    if (s && inst?.status === 'open') go({ kind: 'server', sid: s.sid });
    else if (inst) go({ kind: 'instance', inst: origin });
    else dialog({ kind: 'add-instance', url: origin });
    onClose?.();
  };
  // manage: its Server settings > Hosting (time, plan, backups, delete); that needs you in its community
  const manage = () => {
    if (s) { dialog({ kind: 'settings', sid: s.sid, tab: 'hosting' }); return; }
    toast('Open the server and join it to manage its hosting.');
    open();
  };
  return (
    <div className="sx-list-row ac-inst">
      <span className="vc-srv-ico ac-ico">{archived ? <Archive size={18} /> : <ServerIcon src={icon} name={name} />}</span>
      <div className="sx-row-txt">
        <b>{name}</b>
        <span className="ac-host"><Globe size={12} /> {host}</span>
        <span className="ac-who"><Users size={12} /> {planName || capital(h.plan) || 'Plan'}{billing && !archived ? ` - ${billing}` : ''}</span>
        {archived ? <span className="ac-state">{h.archive_at ? `Shut down ${day(h.archive_at)}` : 'Shut down'}</span>
          : <span className={`ac-state ${status[0]}`}>{status[1]}{h.last_error && h.status === 'error' ? ` - ${h.last_error}` : ''}</span>}
        {!archived && st && <span className={`ac-bill ${st[0]}`}><CalendarClock size={12} /> {st[1]}</span>}
      </div>
      <div className="sx-row-ctl ac-acts">
        {archived ? <button type="button" className="btn btn-surface btn-sm" onClick={() => dialog({ kind: 'create-server' })}><Archive size={13} /> Restore</button> : <>
          <button type="button" className="btn btn-surface btn-sm" onClick={open}><ArrowRight size={13} /> Open</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={manage}><Settings2 size={13} /> Manage</button>
        </>}
      </div>
    </div>
  );
}
