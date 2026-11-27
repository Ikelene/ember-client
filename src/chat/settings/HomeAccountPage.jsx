// Settings > My account: the account you signed in to on a homeserver (Ember Protocol v2, homeserver.js). Its handle, the
// ways it can sign in (link another one, remove one) and a link to the homeserver's own account page.
import { useEffect, useState } from 'react';
import { CircleUserRound, Pencil, ExternalLink, KeyRound, Link2, Unlink, LogOut, Check, RefreshCw, TriangleAlert, Fingerprint } from 'lucide-react';
import { SettingsPage, SCard } from './ui.jsx';
import { ask, toast, useChat } from '../store.js';
import { Avatar, openProfileEditor } from '../Profile.jsx';
import { hasAccountProfile, accountTarget } from '../accountProfileCore.js';
import { normOrigin } from '../ids.js';
import { HomeserverIcon, useHomeSession, useHomeSessions } from '../HomeserverLogin.jsx';
import { setCurrent, homeInfo } from '../homeserver.js';
import { signOutHome } from '../session.js';
import { loadLogins, unlinkLogin, linkLogin } from '../homeApi.js';
import { loginErrorText, KIND_LABEL } from '../homeAdmin.js';
import { desktopBridge } from '../../compat.js';
import './accounts-pages.css';
import './homeservers.css';

export function openOutside(url) {
  const d = desktopBridge();
  if (d?.openExternal) { Promise.resolve(d.openExternal(url)).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
const when = t => { const d = new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };

export default function HomeAccountPage() {
  const s = useHomeSession();
  const all = useHomeSessions();
  const origin = s?.origin || null;
  const profiled = useChat(st => hasAccountProfile(st.instances.find(i => i.origin === normOrigin(origin)))); // (its profile is kept there: 4.1)
  const me = useChat(st => (st.home ? st.me : null));
  const [logins, setLogins] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // "Manage this account": the account page the homeserver names in its discovery (login.account_url), /account until it answers
  const [accountUrl, setAccountUrl] = useState(null);
  useEffect(() => { let gone = false; setAccountUrl(null); if (origin) homeInfo(origin).then(i => !gone && setAccountUrl(i.account_url)).catch(() => {}); return () => { gone = true; }; }, [origin]);
  const load = () => {
    if (!origin) return;
    setError('');
    loadLogins(origin).then(setLogins, e => { setLogins([]); setError(e.status === 404 ? 'old' : e.error === 'signed_out' ? 'ended' : 'load'); });
  };
  useEffect(() => { setLogins(null); load(); }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) {
    return (
      <SettingsPage icon={CircleUserRound} title="My account" sub="The account you're signed in to on your homeserver.">
        <SCard><div className="sx-empty"><CircleUserRound size={28} /><b>Not signed in to a homeserver</b><span>Sign in from Settings > Homeservers, and your account shows here.</span></div></SCard>
      </SettingsPage>
    );
  }
  const a = s.account;
  async function link(m) {
    setBusy(m.id);
    try { await linkLogin(origin, m.id); toast(`${m.name} is linked to your account.`, true); }
    catch (e) { if (e.error !== 'cancelled') toast(loginErrorText(e.error, m.name)); }
    setBusy('');
    load(); // (also after a cancel: the answer may have got lost on the way back)
  }
  async function unlink(m) {
    if (!(await ask({ title: `Remove ${m.name}?`, text: `You won't be able to sign in to ${a.handle} with ${m.name} any more. You can link it again later.`, confirm: 'Remove', danger: true }))) return;
    setBusy(m.id);
    try { setLogins(await unlinkLogin(origin, m.id)); toast(`${m.name} removed.`, true); }
    catch (e) { toast(loginErrorText(e.error, m.name)); if (e.error === 'not_linked') load(); }
    setBusy('');
  }
  async function signOut() {
    if (!(await ask({ title: `Sign out of ${a.handle}?`, text: `Ember forgets its sign-in for ${s.domain} on this device.`, confirm: 'Sign out', danger: true }))) return;
    signOutHome(origin);
    toast(`Signed out of ${a.handle}.`, true);
  }
  const manage = accountUrl || `${origin}/account`;

  return (
    <SettingsPage icon={CircleUserRound} title="My account" sub={`Your account lives on ${s.domain}${s.name && s.name !== s.domain ? ` (${s.name})` : ''}. Everyone sees you as ${a.handle}.`}>
      <SCard className="ac-hero">
        <div className="ac-hero-in">
          {me?.pfp || a.avatar_url ? <Avatar user={{ username: a.username, pfp: me?.pfp || a.avatar_url }} size={64} /> : <span className="ac-hero-blank"><CircleUserRound size={30} /></span>}
          <div className="ac-hero-txt">
            <small className="ac-kicker">Homeserver account</small>
            <b>{a.handle}</b>
            <span className="ac-state ok">{(me?.display_name || a.display_name) && (me?.display_name || a.display_name) !== a.username ? `${me?.display_name || a.display_name} - signed in` : 'Signed in'}</span>
          </div>
          <div className="ac-btns">
            {profiled && <button type="button" className="btn btn-primary" onClick={() => openProfileEditor(accountTarget(normOrigin(origin)))}><Pencil size={14} /> Edit profile</button>}
            <button type="button" className={`btn ${profiled ? 'btn-surface' : 'btn-primary'}`} onClick={() => openOutside(manage)}><ExternalLink size={14} /> Manage this account on {s.domain}</button>
            <button type="button" className="btn btn-surface" onClick={signOut}><LogOut size={14} /> Sign out</button>
          </div>
        </div>
      </SCard>

      {all.length > 1 && (
        <SCard title="Your other homeserver accounts" sub="Pick the one these settings are about.">
          {all.filter(x => x.origin !== origin).map(x => (
            <div className="sx-list-row" key={x.origin}>
              <HomeserverIcon hs={x} className="ac-ico" />
              <div className="sx-row-txt"><b>{x.account.handle}</b><span>{x.name}</span></div>
              <div className="sx-row-ctl"><button type="button" className="btn btn-surface btn-sm" onClick={() => setCurrent(x.origin)}>Show this one</button></div>
            </div>
          ))}
        </SCard>
      )}

      <SCard title="Sign-in methods" sub={`The ways you can get into ${a.handle}. Link another one so you're never locked out.`}
        action={<button type="button" className="btn btn-surface btn-sm" disabled={logins === null} onClick={() => { setLogins(null); load(); }}><RefreshCw size={13} /> Refresh</button>}>
        {logins === null && <div className="vc-loading"><i /><i /><i /></div>}
        {error === 'old' && <div className="sx-empty"><KeyRound size={28} /><b>{s.domain} doesn't list sign-in methods</b><span>Its software is older than this. Manage your sign-in on the homeserver itself.</span></div>}
        {error && error !== 'old' && <p className="vc-note"><TriangleAlert size={14} /> {error === 'ended' ? loginErrorText('signed_out') : `Couldn't load your sign-in methods from ${s.domain}. Check your connection and try again.`}</p>}
        {logins && !error && !logins.length && <div className="sx-empty"><KeyRound size={28} /><b>No sign-in methods</b><span>{s.domain} has none set up.</span></div>}
        {logins && logins.map(m => {
          const password = m.kind === 'password';
          return (
            <div className={`sx-list-row hsx-login${m.enabled === false ? ' off' : ''}`} key={m.id}>
              <span className="sx-row-ico">{password ? <KeyRound size={18} /> : <Fingerprint size={18} />}</span>
              <div className="sx-row-txt">
                <b>{m.name || m.id}</b>
                <span>
                  {m.linked ? <span className="hsx-ok"><Check size={12} /> {password ? 'You have a password' : 'Linked'}</span> : password ? 'No password set' : 'Not linked'}
                  {m.email ? ` - ${m.email}` : ''}{m.linked && m.created_at && when(m.created_at) ? ` - since ${when(m.created_at)}` : ''}
                  {m.enabled === false ? ` - switched off on ${s.domain}` : ''}{!password && KIND_LABEL[m.kind] && m.kind !== 'nookara' ? ` - ${KIND_LABEL[m.kind]}` : ''}
                </span>
              </div>
              <div className="sx-row-ctl">
                {password ? <button type="button" className="btn btn-surface btn-sm" onClick={() => openOutside(manage)}><ExternalLink size={13} /> {m.linked ? 'Change' : 'Set one'}</button>
                  : m.linked ? <button type="button" className="btn btn-surface btn-sm ac-danger" disabled={!!busy} onClick={() => unlink(m)}><Unlink size={13} /> {busy === m.id ? 'Removing...' : 'Remove'}</button>
                    : <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || m.enabled === false} onClick={() => link(m)}><Link2 size={13} /> {busy === m.id ? 'Waiting...' : 'Link'}</button>}
              </div>
            </div>
          );
        })}
        {logins && logins.length > 0 && <small className="vc-hint hsx-foot">Linking opens {s.domain}'s own page and the provider's. Ember never sees those passwords.</small>}
      </SCard>
    </SettingsPage>
  );
}
