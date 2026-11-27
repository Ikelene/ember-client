// Settings > Accounts: the Nookara account, the other saved Nookara accounts, and signing out of everything. The accounts on
// each homeserver (and reconnecting / signing out of one) are under Settings > Homeservers (HomeserversPage.jsx).
import { useState } from 'react';
import { CircleUserRound, ExternalLink, LogOut, ArrowRight, Repeat } from 'lucide-react';
import { SettingsPage, SCard } from './ui.jsx';
import { useChat, ask } from '../store.js';
import { getToken } from '../../api.js';
import { removeInstance, dropNookaraSessions } from '../instances.js';
import { nookaraHandle, signOutHomes } from '../session.js';
import { HomeserverLogin, HomeserverIcon } from '../HomeserverLogin.jsx';
import { useAllHomeSessions } from '../homeSessions.js';
import { signOut, savedAccounts, switchTo } from '../profileActions.js';
import { Avatar } from '../Profile.jsx';
import { siteHref } from '../hosts.js';
import { switchToAccount } from '../accountSwitch.js';
import { currentOrigin } from '../homeserver.js';
import './accounts-pages.css';
import { isNookara, desktopBridge } from '../../compat.js';

const NONE = []; // (a selector must return the same empty list every time)
// links open in the browser (the desktop app hands them to the system's browser), like SettingsDialog's help links
function openOutside(url) {
  const abs = new URL(url, location.origin).href;
  const d = desktopBridge();
  if (d?.openExternal) { Promise.resolve(d.openExternal(abs)).catch(() => {}); return; }
  window.open(abs, '_blank', 'noopener,noreferrer');
}

// ── Accounts ──
export function AccountsPage({ onHomeservers }) {
  const me = useChat(s => s.me);
  const signedIn = useChat(s => s.signedIn);
  const instances = useChat(s => s.instances || NONE);
  const [busy, setBusy] = useState('');
  const homes = useAllHomeSessions(); // homeserver (v2) sign-ins: every account, several on one homeserver too
  const others = signedIn ? savedAccounts().filter(a => a.username.toLowerCase() !== String(me?.username || '').toLowerCase()) : [];

  async function signOutNookara() {
    if (!(await ask({ title: 'Sign out of Nookara?', text: 'Ember signs out on this device. Servers that use Nookara sign-in sign out too.', confirm: 'Sign out', danger: true }))) return;
    await signOut();
  }
  async function signOutAll() {
    const own = instances.filter(i => !isNookara(i.mode) && !i.viaNookara);
    const text = `You'll be signed out of Nookara${own.length ? `, and ${own.length === 1 ? 'the server with its own account is' : `the ${own.length} servers with their own accounts are`} removed from your server list${getToken() ? ' on every device' : ''}. You can add ${own.length === 1 ? 'it' : 'them'} back any time` : ''}.`;
    if (!(await ask({ title: 'Sign out of everything?', text, confirm: 'Sign out of everything', danger: true }))) return;
    setBusy('all');
    for (const i of own) await removeInstance(i.origin).catch(() => {}); // (before Nookara: the synced list is saved with this sign-in)
    dropNookaraSessions();
    signOutHomes();
    if (signedIn) await signOut();
    else setBusy('');
  }

  return (
    <SettingsPage icon={CircleUserRound} title="Accounts" sub="Your Nookara account and the others on this device. Homeserver sign-ins are under Homeservers.">
      <SCard className="ac-hero">
        {signedIn && me ? (
          <div className="ac-hero-in">
            <Avatar user={me} size={64} />
            <div className="ac-hero-txt">
              <small className="ac-kicker">Nookara account</small>
              <b>{nookaraHandle(me.username)}</b>
              <span className="ac-state ok">Signed in</span>
            </div>
            <div className="ac-btns">
              <button type="button" className="btn btn-primary" onClick={() => openOutside(siteHref('/me'))}><ExternalLink size={14} /> Manage Nookara account</button>
              <button type="button" className="btn btn-surface" onClick={signOutNookara}><LogOut size={14} /> Sign out</button>
            </div>
          </div>
        ) : (
          <>
            <div className="ac-hero-in">
              <span className="ac-hero-blank"><CircleUserRound size={30} /></span>
              <div className="ac-hero-txt">
                <small className="ac-kicker">Nookara account</small>
                <b>Not signed in</b>
                <span className="ac-state">Sign in to use DMs, friends and servers that use Nookara sign-in.</span>
              </div>
            </div>
            <div className="ac-hs"><HomeserverLogin /></div>
          </>
        )}
      </SCard>

      {homes.length > 0 && (
        <SCard title="Homeserver accounts" sub="Accounts you signed in to on their own homeserver.">
          {homes.map(s => (
            <div className="sx-list-row" key={s.key}>
              {s.account.avatar_url ? <Avatar user={{ username: s.account.username, pfp: s.account.avatar_url }} size={36} /> : <HomeserverIcon hs={s} className="ac-ico" />}
              <div className="sx-row-txt"><b>{s.account.handle}</b><span>{s.account.display_name !== s.account.username ? `${s.account.display_name} - ` : ''}{s.name}{!signedIn && s.origin === currentOrigin() && s.active ? ' - in use' : ''}</span></div>
              {(signedIn || s.origin !== currentOrigin() || !s.active) && <div className="sx-row-ctl">
                <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => { setBusy(s.key); switchToAccount({ kind: 'home', origin: s.origin, hsKey: s.key }, signedIn && me ? { kind: 'nookara', handle: nookaraHandle(me.username), pfp: me.pfp } : null); }}><Repeat size={13} /> {busy === s.key ? 'Switching...' : 'Switch'}</button>
              </div>}
            </div>
          ))}
          {onHomeservers && <div className="ac-btns end"><button type="button" className="btn btn-surface btn-sm" onClick={onHomeservers}><ArrowRight size={13} /> Manage homeservers</button></div>}
        </SCard>
      )}

      {others.length > 0 && (
        <SCard title="Other Nookara accounts on this device" sub="Switch to one without signing in again.">
          {others.map(a => (
            <div className="sx-list-row" key={a.username}>
              <Avatar user={{ username: a.username, pfp: a.pfp }} size={36} />
              <div className="sx-row-txt"><b>{nookaraHandle(a.username)}</b><span>Saved on this device</span></div>
              <div className="sx-row-ctl">
                <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => switchTo(a, setBusy)}><Repeat size={13} /> {busy === a.username ? 'Switching...' : 'Switch'}</button>
              </div>
            </div>
          ))}
        </SCard>
      )}

      {(signedIn || instances.length > 0 || homes.length > 0) && (
        <SCard title="Sign out of everything" sub="Nookara, and every homeserver on this device.">
          <div className="ac-btns end">
            <button type="button" className="btn btn-danger" disabled={busy === 'all'} onClick={signOutAll}><LogOut size={14} /> {busy === 'all' ? 'Signing out...' : 'Sign out of everything'}</button>
          </div>
        </SCard>
      )}
    </SettingsPage>
  );
}
