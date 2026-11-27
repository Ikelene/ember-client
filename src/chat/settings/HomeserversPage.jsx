// Settings > Homeservers: every homeserver this device is signed in to or connected to (your account there, whether it's
// connected, Reconnect / Sign out / Forget, and signing in to another one). The ones you are an admin or the owner of also
// open their settings in tabs: Accounts & sign-in (PROTOCOL §4a), Servers (who may create them, §5a), Admins, Federation
// (§4b), and Reports (§4d: reported DM messages, HomeserverReports.jsx).
import { useEffect, useRef, useState } from 'react';
import { Building2, ArrowLeft, Globe, LogOut, AtSign, Users, KeyRound, ShieldCheck, TriangleAlert, RefreshCw, Trash2, Network, Crown, Settings2, Server, UserPlus, Ban, Gauge, Plus, X, RotateCw, ListChecks, Hourglass, Flag } from 'lucide-react';
import { ReportsTab } from './HomeserverReports.jsx';
import { SettingsPage, SCard, SRow, Switch } from './ui.jsx';
import { LoginMethods } from './LoginMethods.jsx';
import { ask, toast, useChat } from '../store.js';
import { Avatar } from '../Profile.jsx';
import { HomeserverIcon, HomeserverLogin, useHomeSessions, useHomeSession } from '../HomeserverLogin.jsx';
import { refreshInstance, reconnect, removeInstance } from '../instances.js';
import { signOutHome, nookaraHandle } from '../session.js';
import { forgetHomeserver } from '../homeserver.js';
import { normOrigin } from '../ids.js';
import { homeserverRows, forgetText } from '../homeservers.js';
import { InstanceTab, restartInstance } from '../Instances.jsx';
import { useUnsaved, UnsavedBar } from '../unsaved.jsx';
import { hsCall, viaInstance, discoveryDoc, useAdminHomeservers } from '../homeApi.js';
import { REGISTRATION, REMOTE_MODES, CREATION_MODES, methodsToSend, sameMethods, methodIssues, nameList, adminErrorText } from '../homeAdmin.js';
import { DEFAULT_DENYLIST, MAX_DENYLISTS, MAX_DENY, RATE_FIELDS, FLOOR_MAX, DENY_KIND_LABEL, denyKind, cleanDeny, denyIssue, domainRules, domainRuleIssue, listUrl, listStatus, ago,
  readNumbers, federationForm, federationPatch, remoteAccountsPatch } from '../federation.js';
import './accounts-pages.css';
import './homeservers.css';

const TABS = [['accounts', 'Accounts & sign-in', KeyRound], ['servers', 'Servers', Server], ['admins', 'Admins', ShieldCheck], ['federation', 'Federation', Network], ['reports', 'Reports', Flag]];
const Loading = () => <div className="vc-loading"><i /><i /><i /></div>;
const Choices = ({ name, value, options, onPick, disabled }) => (
  <div className="bf-pe-vis">
    {options.map(([id, label, hint]) => (
      <label key={id} className={`bf-pe-vis-opt${value === id ? ' on' : ''}`}>
        <input type="radio" name={name} checked={value === id} disabled={disabled} onChange={() => onPick(id)} />
        <span><b>{label}</b><small>{hint}</small></span>
      </label>
    ))}
  </div>
);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export default function HomeserversPage({ onDirty }) {
  const list = useAdminHomeservers();
  const [origin, setOrigin] = useState(null);
  const [tab, setTab] = useState('accounts');
  const dirty = useRef({ on: false, nudge: null });
  const note = (on, nudge) => { dirty.current = { on, nudge }; onDirty?.(on, nudge); };
  async function leaveOk() {
    if (!dirty.current.on) return true;
    dirty.current.nudge?.();
    return ask({ title: 'Discard your changes?', text: "Your changes aren't saved yet.", confirm: 'Discard', danger: true });
  }
  const hs = list.find(h => h.origin === origin) || null;
  useEffect(() => { if (origin && !hs) setOrigin(null); }, [origin, hs]);

  if (!hs) return <MyHomeservers admins={list} onManage={h => { setTab('accounts'); setOrigin(h.origin); }} />;
  return (
    <div className="sx-page hsx-page">
      <header className="hsx-head">
        <button type="button" className="btn btn-surface btn-sm" onClick={async () => { if (await leaveOk()) { note(false); setOrigin(null); } }}><ArrowLeft size={14} /> Homeservers</button>
        <HomeserverIcon hs={hs} className="ac-ico" />
        <div className="sx-row-txt"><b>{hs.name}</b><span className="ac-host"><Globe size={12} /> {hs.domain}{hs.isOwner ? ' - owner' : ' - admin'}</span></div>
      </header>
      <div className="sx-seg hsx-tabs" role="tablist" aria-label={`${hs.name} settings`}>
        {TABS.map(([id, label, I]) => <button type="button" key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={async () => { if (id !== tab && (await leaveOk())) { note(false); setTab(id); } }}><I size={14} /> {label}</button>)}
      </div>
      {tab === 'accounts' && <AccountsTab key={hs.origin} hs={hs} onDirty={note} />}
      {tab === 'servers' && <ServersTab key={hs.origin} hs={hs} onDirty={note} />}
      {tab === 'admins' && (viaInstance(hs.origin) ? <div className="hsx-admins"><InstanceTab key={hs.origin} origin={hs.origin} tab="admins" /></div> : <AdminsTab key={hs.origin} hs={hs} />)}
      {tab === 'federation' && <FederationTab key={hs.origin} hs={hs} onDirty={note} />}
      {tab === 'reports' && <ReportsTab key={hs.origin} hs={hs} />}
    </div>
  );
}

// ── the list: every homeserver on this device ──
const NONE = [];
function MyHomeservers({ admins, onManage }) {
  const sessions = useHomeSessions();
  const home = useHomeSession();
  const instances = useChat(s => s.instances || NONE);
  const servers = useChat(s => s.servers || NONE);
  const me = useChat(s => s.me);
  const signedIn = useChat(s => s.signedIn);
  const [adding, setAdding] = useState(false);
  const homeHandle = home?.account?.handle || (signedIn && me ? nookaraHandle(me.username) : null);
  const rows = homeserverRows(sessions, instances, servers, { homeHandle, norm: normOrigin });
  async function signOut(r) {
    if (!(await ask({ title: `Sign out of ${r.domain}?`, text: `Ember forgets its sign-in for ${r.handle || r.domain} on this device.${r.servers.length ? ' Your servers there stay in your list, signed out, until you sign in again or forget it.' : ''}`, confirm: 'Sign out', danger: true }))) return;
    await signOutHome(r.origin);
    toast(`Signed out of ${r.domain}.`, true);
  }
  async function forget(r) {
    if (!(await ask({ title: `Forget ${r.domain}?`, text: forgetText(r), confirm: 'Forget', danger: true }))) return;
    if (r.inst) await removeInstance(r.inst.origin).catch(() => {});
    if (r.session) await signOutHome(r.origin);
    forgetHomeserver(r.domain);
    toast(`Forgot ${r.domain}.`, true);
  }
  return (
    <SettingsPage icon={Building2} title="Homeservers" sub="Every server you're in lives on a homeserver, and your account is kept on one. These are the ones this device uses.">
      <SCard action={!adding && <button type="button" className="btn btn-surface btn-sm" onClick={() => setAdding(true)}><Plus size={13} /> Add homeserver</button>}>
        {rows.length ? rows.map(r => {
          const admin = admins.find(a => a.origin === r.origin);
          const down = r.inst && (r.inst.sleep || !['open', 'connecting'].includes(r.inst.status));
          return (
            <div className="sx-list-row ac-inst" key={r.origin}>
              <HomeserverIcon hs={r} className="ac-ico" />
              <div className="sx-row-txt">
                <b>{r.name}{admin && <i className="hsx-tag">{admin.isOwner ? <><Crown size={11} /> Owner</> : 'Admin'}</i>}</b>
                <span className="ac-host"><Globe size={12} /> {r.domain}{r.legacy ? ' - one server on its own' : ''}</span>
                {r.handle && <span className="ac-who"><AtSign size={12} /> {r.handle}</span>}
                <span className={`ac-state ${r.status[0]}`}>{r.status[1]}{r.servers.length ? ` - ${r.servers.length} ${r.servers.length === 1 ? 'server' : 'servers'}` : ''}</span>
              </div>
              <div className="sx-row-ctl ac-acts">
                {admin && <button type="button" className="btn btn-primary btn-sm" onClick={() => onManage(admin)}><Settings2 size={13} /> Manage</button>}
                {down && <button type="button" className="btn btn-surface btn-sm" onClick={() => reconnect(r.inst.origin)}><RefreshCw size={13} /> Reconnect</button>}
                {r.session && <button type="button" className="btn btn-surface btn-sm" onClick={() => signOut(r)}><LogOut size={13} /> Sign out</button>}
                <button type="button" className="btn btn-surface btn-sm ac-danger" onClick={() => forget(r)}><Trash2 size={13} /> Forget</button>
              </div>
            </div>
          );
        }) : <div className="sx-empty"><Building2 size={28} /><b>No homeservers yet</b><span>Sign in to a homeserver to see your servers, DMs and friends.</span></div>}
      </SCard>
      {(adding || !rows.length) && (
        <SCard title="Sign in to another homeserver" sub="Your account on it is added next to the ones above." action={rows.length > 0 && <button type="button" className="btn btn-surface btn-sm" onClick={() => setAdding(false)}><X size={13} /> Cancel</button>}>
          <div className="ac-hs"><HomeserverLogin /></div>
        </SCard>
      )}
    </SettingsPage>
  );
}

// what a load answered when it failed: the software is too old for the page (404), or words
const loadError = e => (e.status === 404 ? 'old' : adminErrorText(e));
const Failed = ({ error, what, onRetry }) => (
  <SCard>{error === 'old'
    ? <div className="sx-empty"><TriangleAlert size={28} /><b>This homeserver doesn't have {what} yet</b><span>Its software is older than this page. Update it, then look again.</span></div>
    : <div className="sx-empty"><TriangleAlert size={28} /><b>Couldn't load {what}</b><span>{error}</span><button type="button" className="btn btn-surface btn-sm" onClick={onRetry}><RefreshCw size={13} /> Try again</button></div>}
  </SCard>
);

// ── Accounts & sign-in ──
const accountsForm = d => ({
  hosts_accounts: !!d.hosts_accounts, registration: d.registration || 'closed', link_verified_emails: !!d.link_verified_emails,
  methods: (d.login_methods || []).map(m => ({ ...m, client_secret: '', _stored: m.client_secret || null })),
});
function AccountsTab({ hs, onDirty }) {
  const { origin } = hs;
  const [cfg, setCfg] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => { setError(''); hsCall(origin, '/api/v2/homeserver/accounts').then(d => { setCfg(d); setF(accountsForm(d)); }, e => setError(loadError(e))); };
  useEffect(load, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = {};
  if (cfg && f) {
    if (f.hosts_accounts !== !!cfg.hosts_accounts) patch.hosts_accounts = f.hosts_accounts;
    if (f.registration !== cfg.registration) patch.registration = f.registration;
    if (f.link_verified_emails !== !!cfg.link_verified_emails) patch.link_verified_emails = f.link_verified_emails;
    if (!sameMethods(cfg.login_methods || [], f.methods)) patch.login_methods = methodsToSend(f.methods);
  }
  const changed = Object.keys(patch).length > 0;
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  if (error) return <Failed error={error} what="account settings" onRetry={load} />;
  if (!cfg || !f) return <Loading />;
  const set = p => { setSaveError(''); setF(x => ({ ...x, ...p })); };
  const managed = !!hs.managed;
  const invalid = f.methods.some(m => Object.keys(methodIssues(m, f.methods)).length > 0);
  const nobody = f.hosts_accounts && !f.methods.some(m => m.enabled !== false);
  async function save() {
    setBusy(true); setSaveError('');
    try {
      const d = await hsCall(origin, '/api/v2/homeserver/accounts', { method: 'PATCH', body: patch });
      setCfg(d); setF(accountsForm(d)); flashSaved();
      if (viaInstance(origin)) refreshInstance(origin).catch(() => {});
    } catch (e) { const words = adminErrorText(e, f.methods); setSaveError(words); toast(words); }
    setBusy(false);
  }
  return (
    <>
      <SCard title="Accounts" sub={`Whether ${hs.domain} has accounts of its own (name@${cfg.domain || hs.domain}), and who may make one.`}>
        <SRow title="This homeserver hosts accounts" sub={managed ? "Nookara hosts this homeserver, so this can't be switched on." : 'People sign in here with an account kept on this homeserver. Changing it needs a restart.'}>
          <Switch on={f.hosts_accounts} label="Hosts accounts" onChange={v => { if (!managed || !v) set({ hosts_accounts: v }); }} />
        </SRow>
        {cfg.restart_required && f.hosts_accounts === !!cfg.hosts_accounts && (
          <p className="vc-note"><TriangleAlert size={14} /> Saved - restart the homeserver to switch.
            {viaInstance(origin) && <button type="button" className="btn btn-surface btn-sm" onClick={() => restartInstance(origin, hs.name)}><RefreshCw size={13} /> Restart now</button>}</p>
        )}
        <div className="vc-field hsx-block"><span>Making an account</span>
          <Choices name="hsx-reg" value={f.registration} options={REGISTRATION} onPick={v => set({ registration: v })} /></div>
      </SCard>

      <SCard title="Sign-in methods" sub="The ways people can sign in on this homeserver's login page. Each one that isn't a password has a callback address to register with its provider.">
        <LoginMethods methods={f.methods} origin={origin} onChange={methods => set({ methods })} />
        {nobody && <p className="vc-note hsx-warn"><TriangleAlert size={14} /> {adminErrorText('no_login_method')}</p>}
        <SRow title="Link logins by verified email" sub="Someone who signs in with a new provider gets the account that already has the same email, when the provider says the email is verified. Off is safer.">
          <Switch on={f.link_verified_emails} label="Link logins by verified email" onChange={v => set({ link_verified_emails: v })} />
        </SRow>
        <small className="vc-hint hsx-foot">Which other homeservers' accounts can sign in here is under Federation.</small>
      </SCard>

      {saveError &&<p className="vc-note hsx-warn" role="alert"><TriangleAlert size={14} /> {saveError}</p>}
      <UnsavedBar changed={changed} bar={bar} busy={busy} disabled={invalid || nobody} onReset={() => { setSaveError(''); setF(accountsForm(cfg)); }} onSave={save} />
    </>
  );
}

// ── Servers ──
const creationForm = c => ({ mode: c?.mode || 'admins', allowlist: (c?.allowlist || []).join('\n'), per_account: c?.per_account == null ? '' : String(c.per_account) });
function ServersTab({ hs, onDirty }) {
  const { origin } = hs;
  const [cfg, setCfg] = useState(null);
  const [f, setF] = useState(null);
  const [servers, setServers] = useState(null); // { list, total }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function load() {
    setError('');
    hsCall(origin, '/api/v1/instance/settings').then(d => { setCfg(d); setF(creationForm(d.creation)); }, e => setError(loadError(e)));
    // every server it lists and the ones you are in; the discovery doc says how many there are in all
    Promise.all([hsCall(origin, '/api/v1/discover').catch(() => null), discoveryDoc(origin)]).then(([d, doc]) => {
      const seen = new Map();
      for (const s of [...(Array.isArray(d?.servers) ? d.servers : []), ...(Array.isArray(doc?.communities) ? doc.communities : [])]) { const k = s.address || s.slug || s.sid; if (k && !seen.has(k)) seen.set(k, s); }
      setServers({ list: [...seen.values()], total: Number.isInteger(doc?.communities_count) ? doc.communities_count : null });
    });
  }
  useEffect(load, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = cfg ? creationForm(cfg.creation) : null;
  const names = f ? nameList(f.allowlist) : [];
  const limit = f && f.per_account.trim() ? Number(f.per_account) : null;
  const limitBad = limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= 1000);
  const patch = {};
  if (cur && f) {
    if (f.mode !== cur.mode) patch.mode = f.mode;
    if (!sameList(names, cfg.creation?.allowlist || [])) patch.allowlist = names;
    if (!limitBad && limit !== (cfg.creation?.per_account ?? null)) patch.per_account = limit;
  }
  const changed = Object.keys(patch).length > 0 || (!!f && limitBad);
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  if (error) return <Failed error={error} what="server settings" onRetry={load} />;
  if (!cfg || !f) return <Loading />;
  const set = p => setF(x => ({ ...x, ...p }));
  async function save() {
    setBusy(true);
    try {
      const d = await hsCall(origin, '/api/v1/instance/settings', { method: 'PATCH', body: { creation: patch } });
      setCfg(d); setF(creationForm(d.creation)); flashSaved();
      if (viaInstance(origin)) refreshInstance(origin).catch(() => {});
    } catch (e) { toast(adminErrorText(e)); }
    setBusy(false);
  }
  const hidden = servers && servers.total != null ? Math.max(0, servers.total - servers.list.length) : 0;
  return (
    <>
      <SCard title="Who can create servers" sub={`Admins of ${hs.domain} always can. Bots never can.`}>
        <Choices name="hsx-create" value={f.mode} options={CREATION_MODES} onPick={v => set({ mode: v })} />
        {f.mode === 'allowlist' && (
          <label className="vc-field hsx-block"><span>Accounts that can create servers</span>
            <textarea className="form-textarea" rows={4} spellCheck={false} autoCapitalize="none" placeholder={'nat\nalex'} value={f.allowlist} onChange={e => set({ allowlist: e.target.value })} />
            <small className="vc-hint">One username (or account id) per line.</small></label>
        )}
        {f.mode !== 'admins' && (
          <label className="vc-field hsx-block"><span>Servers per account</span>
            <input className="form-input hsx-num" inputMode="numeric" maxLength={4} placeholder="No limit" value={f.per_account} onChange={e => set({ per_account: e.target.value.replace(/[^\d]/g, '') })} />
            <small className={limitBad ? 'hsx-issue' : 'vc-hint'}>{limitBad ? 'A number from 1 to 1000, or empty for no limit.' : 'How many servers one account may own. Empty = no limit. Admins are never limited.'}</small></label>
        )}
      </SCard>
      <SCard title={`Servers on ${hs.domain}`} sub={servers?.total != null ? `${servers.total} in all.` : undefined}>
        {!servers && <Loading />}
        {servers && !servers.list.length && <div className="sx-empty"><Server size={28} /><b>{servers.total ? 'None you can see' : 'No servers yet'}</b><span>{servers.total ? "The servers here aren't listed and you aren't in them." : 'Servers made on this homeserver show here.'}</span></div>}
        {servers && servers.list.map(s => (
          <div className="sx-list-row" key={s.address || s.slug || s.sid}>
            <HomeserverIcon hs={{ name: s.name, icon_url: s.icon_url || s.icon || null }} className="ac-ico" />
            <div className="sx-row-txt"><b>{s.name}</b><span>{s.address || s.slug || ''}{s.discoverable === false || s.listed === false ? ' - not listed' : ''}</span></div>
            <div className="sx-row-ctl hsx-count"><Users size={13} /> {Number(s.member_count) || 0}</div>
          </div>
        ))}
        {hidden > 0 && servers.list.length > 0 && <small className="vc-hint hsx-foot">{hidden} more {hidden === 1 ? "isn't" : "aren't"} listed and you aren't in {hidden === 1 ? 'it' : 'them'}, so {hidden === 1 ? "it doesn't" : "they don't"} show here.</small>}
      </SCard>
      <UnsavedBar changed={changed} bar={bar} busy={busy} disabled={limitBad} onReset={() => setF(creationForm(cfg.creation))} onSave={save} />
    </>
  );
}

// ── Admins (a homeserver you signed in on directly; one connected as a server uses Instances.jsx's list) ──
function AdminsTab({ hs }) {
  const { origin } = hs;
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const load = () => { setError(''); hsCall(origin, '/api/v1/instance/admins').then(setAdmins, e => setError(loadError(e))); };
  useEffect(load, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  async function op(uid, add) {
    if (!add && !(await ask({ title: 'Remove this admin?', text: "They can't change this homeserver's settings any more.", confirm: 'Remove', danger: true }))) return;
    try { await hsCall(origin, `/api/v1/instance/admins/${encodeURIComponent(uid)}`, { method: add ? 'PUT' : 'DELETE' }); setId(''); load(); } catch (e) { toast(adminErrorText(e)); }
  }
  if (error) return <Failed error={error} what="the admins" onRetry={load} />;
  if (!admins) return <Loading />;
  const owner = admins.owner || null;
  return (
    <SCard title="Admins" sub={`Admins can change ${hs.domain}'s settings.${hs.isOwner ? '' : ' Only the owner can add or remove them.'}`}>
      {[owner, ...(admins.admins || []).filter(a => a.id !== owner?.id)].filter(Boolean).map(a => (
        <div className="sx-list-row" key={a.id}>
          <Avatar user={a} size={32} />
          <div className="sx-row-txt"><b>{a.username}{a.id === owner?.id && <i className="hsx-tag"><Crown size={11} /> Owner</i>}</b><span className="vc-mono">{a.id}</span></div>
          <div className="sx-row-ctl">{hs.isOwner && a.id !== owner?.id && <button type="button" className="vc-ico-btn danger" aria-label={`Remove ${a.username}`} data-tip="Remove admin" onClick={() => op(a.id, false)}><Trash2 size={15} /></button>}</div>
        </div>
      ))}
      {hs.isOwner && (
        <form className="vc-field hsx-block" onSubmit={e => { e.preventDefault(); if (id.trim()) op(id.trim(), true); }}><span>Add an admin by account id</span>
          <div className="hsx-copy"><input className="form-input" placeholder="l:12" value={id} onChange={e => setId(e.target.value)} /><button type="submit" className="btn btn-primary btn-sm" disabled={!id.trim()}><UserPlus size={13} /> Add</button></div>
          <small className="vc-hint">The id shows on a profile on this homeserver.</small></form>
      )}
    </SCard>
  );
}

// ── Federation (§4b): who signs in from elsewhere, deny lists, limits per homeserver, the signing key ──
const remoteForm = r => ({ mode: r?.mode || 'none', list: (r?.list || []).join('\n') });
const dateOf = t => (t ? new Date(t).toLocaleString() : '');
const KEEP_RETIRED = 7 * 24 * 3600 * 1000; // how long a retired key stays published (ember-server keys.js)
function FederationTab({ hs, onDirty }) {
  const { origin } = hs;
  const [view, setView] = useState(null);   // GET /api/v2/homeserver/federation
  const [acc, setAcc] = useState(null);     // GET /api/v2/homeserver/accounts (remote_accounts lives there)
  const [f, setF] = useState(null);
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState('');     // '' | 'save' | 'refresh' | 'rotate' | a domain whose hold is being lifted
  const [newList, setNewList] = useState('');
  const [newDeny, setNewDeny] = useState('');
  const [denyError, setDenyError] = useState('');
  const [filter, setFilter] = useState('');
  function load() {
    setError('');
    Promise.all([hsCall(origin, '/api/v2/homeserver/federation'), hsCall(origin, '/api/v2/homeserver/accounts')])
      .then(([v, a]) => { setView(v); setF(federationForm(v)); setAcc(a); setR(remoteForm(a.remote_accounts)); }, e => setError(loadError(e)));
  }
  useEffect(load, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const fedPatch = view && f ? federationPatch(view, f) : {};
  const accPatch = acc && r ? remoteAccountsPatch(acc.remote_accounts, r.mode, r.list) : {};
  const changed = fedPatch === null || accPatch === null || Object.keys(fedPatch).length > 0 || Object.keys(accPatch).length > 0;
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  if (error) return <Failed error={error} what="federation settings" onRetry={load} />;
  if (!view || !f || !acc || !r) return <Loading />;
  const set = p => { setSaveError(''); setF(x => ({ ...x, ...p })); };
  const setRemote = p => { setSaveError(''); setR(x => ({ ...x, ...p })); };
  const setRate = (k, v) => set({ rate_limits: { ...f.rate_limits, [k]: v.replace(/[^\d]/g, '') } });
  const nums = readNumbers(f);
  const hosts = domainRules(r.list);
  const needsList = r.mode === 'allowlist' || r.mode === 'blocklist';
  const listIssue = needsList ? domainRuleIssue(hosts.bad) : '';
  const statusOf = url => (view.denylists || []).find(s => s.url === url);
  const savedLists = view.federation?.denylists || [];
  const keys = view.keys || { current: null, keys: [] };
  const fedDirty = !!fedPatch && Object.keys(fedPatch).length > 0;

  async function save() {
    setBusy('save'); setSaveError('');
    try {
      if (accPatch && Object.keys(accPatch).length) { const a = await hsCall(origin, '/api/v2/homeserver/accounts', { method: 'PATCH', body: accPatch }); setAcc(a); setR(remoteForm(a.remote_accounts)); }
      // (the lists are fetched only while someone from elsewhere is let in, so a new mode can change their status too)
      const v = fedDirty ? await hsCall(origin, '/api/v2/homeserver/federation', { method: 'PATCH', body: fedPatch }) : await hsCall(origin, '/api/v2/homeserver/federation');
      setView(v); setF(federationForm(v));
      flashSaved();
      if (viaInstance(origin)) refreshInstance(origin).catch(() => {});
    } catch (e) { const words = adminErrorText(e); setSaveError(words); toast(words); }
    setBusy('');
  }
  // done at once, not with the unsaved bar: fetch the lists now, lift a hold, make a new key
  async function act(kind, body, path = '/api/v2/homeserver/federation', method = 'PATCH') {
    setBusy(kind);
    try {
      const v = await hsCall(origin, path, { method, ...(body ? { body } : {}) });
      setView(v);
      if (!fedDirty) setF(federationForm(v)); // edits not saved yet stay in the form
      return v;
    } catch (e) { toast(adminErrorText(e)); return null; } finally { setBusy(''); }
  }
  async function rotate() {
    const ok = await ask({ title: 'Make a new signing key?', confirm: 'Make a new key', danger: true,
      text: `Sign-ins from ${hs.domain} to other homeservers are signed with the new key from now on. People already signed in on other homeservers stay signed in: the old key stays published for 7 days, so what it signed still checks out.` });
    if (ok && (await act('rotate', null, '/api/v2/homeserver/federation/rotate-key', 'POST'))) toast('New signing key made.', true);
  }
  const newListUrl = newList.trim() ? listUrl(newList) : null;
  const newListIssue = !newList.trim() ? '' : !newListUrl ? 'An https address, like https://lists.example/denylist.' : f.denylists.includes(newListUrl) ? 'Already followed.' : f.denylists.length >= MAX_DENYLISTS ? `At most ${MAX_DENYLISTS} lists.` : '';
  function addList(e) {
    e.preventDefault();
    if (!newListUrl || newListIssue) return;
    set({ denylists: [...f.denylists, newListUrl] }); setNewList('');
  }
  function addDeny(e) {
    e.preventDefault();
    const items = newDeny.split(/[\s,]+/).filter(Boolean);
    const bad = items.filter(x => !denyKind(x));
    if (bad.length) { setDenyError(`${bad.length > 1 ? `"${bad[0]}" (and ${bad.length - 1} more): ` : ''}${denyIssue(bad[0])}`); return; }
    const next = [...f.deny];
    for (const x of items.map(cleanDeny)) if (!next.includes(x)) next.push(x);
    if (next.length > MAX_DENY) { setDenyError(`At most ${MAX_DENY.toLocaleString()} entries.`); return; }
    set({ deny: next }); setNewDeny(''); setDenyError('');
  }
  const q = filter.trim().toLowerCase();
  const shownDeny = q ? f.deny.filter(x => x.toLowerCase().includes(q)) : f.deny;
  const held = view.held || [];
  const seen = view.homeservers || [];
  const count = n => `${n} ${n === 1 ? 'entry' : 'entries'}`;

  return (
    <>
      <SCard title="Accounts from other homeservers" sub={`Which other homeservers' accounts can sign in on ${hs.domain} and use its servers.${typeof view.remote_accounts === 'number' && view.remote_accounts ? ` ${view.remote_accounts} ${view.remote_accounts === 1 ? 'account has' : 'accounts have'} so far.` : ''}`}>
        <Choices name="hsx-remote" value={r.mode} options={REMOTE_MODES} onPick={v => setRemote({ mode: v })} />
        {needsList && (
          <label className="vc-field hsx-block"><span>{r.mode === 'allowlist' ? 'Homeservers let in' : 'Homeservers kept out'}</span>
            <textarea className="form-textarea" rows={4} spellCheck={false} autoCapitalize="none" placeholder={'nookara.cc\n*.example.org'} value={r.list} onChange={e => setRemote({ list: e.target.value })} />
            <small className={listIssue ? 'hsx-issue' : 'vc-hint'}>{listIssue || 'One domain per line. example.org is that homeserver only; *.example.org is every name under it.'}</small></label>
        )}
        {r.mode !== 'none' && <small className="vc-hint hsx-foot">Each server can narrow this further in its own Joining settings.</small>}
      </SCard>

      <SCard title="Shared deny lists" sub="Signed lists of homeservers, networks and accounts to keep out, kept by someone you trust. Checked every five minutes.">
        {r.mode === 'none' && <p className="vc-note"><TriangleAlert size={14} /> Lists are only fetched while accounts from other homeservers are let in.</p>}
        {f.denylists.length ? f.denylists.map(url => {
          const saved = savedLists.includes(url), got = statusOf(url), st = listStatus(got);
          const words = !saved ? 'Added - fetched when you save.' : !got && acc.remote_accounts?.mode === 'none' ? "Not fetched while nobody from elsewhere is let in." : st.text;
          return (
            <div className="sx-list-row hsx-list" key={url}>
              <ListChecks size={18} className="hsx-list-ico" />
              <div className="sx-row-txt"><b className="vc-mono">{url}{url === DEFAULT_DENYLIST && <i className="hsx-tag">Nookara</i>}</b>
                <span className={saved && st.tone === 'warn' ? 'hsx-warn' : undefined}>{words}</span></div>
              <div className="sx-row-ctl"><button type="button" className="vc-ico-btn danger" aria-label={`Stop following ${url}`} data-tip="Stop following" onClick={() => set({ denylists: f.denylists.filter(x => x !== url) })}><Trash2 size={15} /></button></div>
            </div>
          );
        }) : <div className="sx-empty"><ListChecks size={28} /><b>No lists followed</b><span>Only the entries under Blocked here apply.</span></div>}
        <form className="vc-field hsx-block" onSubmit={addList}><span>Follow a list</span>
          <div className="hsx-copy">
            <input className="form-input" inputMode="url" spellCheck={false} autoCapitalize="none" placeholder="https://lists.example/denylist" value={newList} onChange={e => setNewList(e.target.value)} />
            <button type="submit" className="btn btn-surface btn-sm" disabled={!newListUrl || !!newListIssue}><Plus size={13} /> Add</button>
            <button type="button" className="btn btn-surface btn-sm" disabled={!!busy || acc.remote_accounts?.mode === 'none' || !savedLists.length} onClick={() => act('refresh', { refresh: true }).then(v => v && toast('Lists checked.', true))}><RotateCw size={13} /> {busy === 'refresh' ? 'Checking...' : 'Check now'}</button>
          </div>
          <small className={newListIssue ? 'hsx-issue' : 'vc-hint'}>{newListIssue || "Nookara's list (nookara.cc) is followed by default; you can stop following it. When a list can't be fetched or its signature doesn't check out, its last good copy keeps applying. Check now looks at the saved lists."}</small>
        </form>
        {!f.denylists.includes(DEFAULT_DENYLIST) && <button type="button" className="btn btn-surface btn-sm hsx-block" onClick={() => set({ denylists: [...f.denylists, DEFAULT_DENYLIST] })}><Plus size={13} /> Follow Nookara's list again</button>}
      </SCard>

      <SCard title="Blocked here" sub={`Your own entries, on top of the lists. What they cover can't sign in here, and anyone already signed in from there is signed out.${f.deny.length ? ` ${count(f.deny.length)}.` : ''}`}>
        <form className="vc-field" onSubmit={addDeny}><span>Block</span>
          <div className="hsx-copy">
            <input className="form-input" spellCheck={false} autoCapitalize="none" placeholder="bad.example, *.bad.example, 203.0.113.0/24 or alice@bad.example" value={newDeny} onChange={e => { setNewDeny(e.target.value); setDenyError(''); }} />
            <button type="submit" className="btn btn-surface btn-sm" disabled={!newDeny.trim()}><Ban size={13} /> Block</button>
          </div>
          <small className={denyError ? 'hsx-issue' : 'vc-hint'}>{denyError || 'A homeserver (example.org), every name under one (*.example.org), an IP range (203.0.113.0/24, 2001:db8::/32) or one account (alice@example.org). Paste several at once, one per line.'}</small>
        </form>
        {f.deny.length > 12 && <input className="form-input hsx-block" type="search" placeholder="Find an entry" aria-label="Find an entry" value={filter} onChange={e => setFilter(e.target.value)} />}
        {f.deny.length > 0 && (
          <div className="hsx-deny">
            {shownDeny.map(x => (
              <span key={x} className="vc-chip hsx-deny-chip"><small>{DENY_KIND_LABEL[denyKind(x)] || 'Entry'}</small><span className="vc-mono">{x}</span>
                <button type="button" aria-label={`Unblock ${x}`} onClick={() => set({ deny: f.deny.filter(y => y !== x) })}><X size={12} /></button></span>
            ))}
            {!shownDeny.length && <small className="vc-hint">Nothing matches.</small>}
          </div>
        )}
      </SCard>

      <SCard title="Limits for other homeservers" sub="Counted per homeserver, on top of each account's own limits. A homeserver over a limit is told to wait.">
        <div className="hsx-two hsx-block">
          {RATE_FIELDS.map(([k, label, hint, min, max]) => (
            <label key={k} className="vc-field hsx-field"><span>{label}</span>
              <input className="form-input hsx-num" inputMode="numeric" maxLength={String(max).length} value={f.rate_limits[k]} onChange={e => setRate(k, e.target.value)} />
              <small className={nums.bad[k] ? 'hsx-issue' : 'vc-hint'}>{nums.bad[k] || `${hint} ${min}-${max.toLocaleString()}.`}</small></label>
          ))}
        </div>
        <label className="vc-field hsx-block"><span><Hourglass size={13} className="vc-inline-ico" /> New homeservers wait at least (days)</span>
          <input className="form-input hsx-num" inputMode="numeric" maxLength={3} value={f.min_age_floor_days} onChange={e => set({ min_age_floor_days: e.target.value.replace(/[^\d]/g, '') })} />
          <small className={nums.bad.min_age_floor_days ? 'hsx-issue' : 'vc-hint'}>{nums.bad.min_age_floor_days || `People from a homeserver first seen recently can't join a server here until it's this many days old. Each server sets its own wait; this is the least any server's can be. 0-${FLOOR_MAX}.`}</small></label>
        {held.length > 0 && (
          <div className="vc-field hsx-block"><span><Gauge size={13} className="vc-inline-ico" /> On hold now</span>
            {held.map(h => (
              <div className="sx-list-row" key={h.domain}>
                <div className="sx-row-txt"><b>{h.domain}</b><span>Ran into its limits too often. Everything from it is refused until {new Date(h.until).toLocaleTimeString()}.</span></div>
                <div className="sx-row-ctl"><button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => act(h.domain, { release: [h.domain] })}>Lift hold</button></div>
              </div>
            ))}
          </div>
        )}
        {seen.length > 0 && (
          <details className="hsx-more hsx-block"><summary>Homeservers seen so far ({seen.length})</summary>
            {seen.map(h => (
              <div className="sx-list-row" key={h.domain}>
                <div className="sx-row-txt"><b>{h.domain}</b><span>First seen {h.first_seen ? ago(h.first_seen) : 'just now'}{h.last_seen ? `, last ${ago(h.last_seen)}` : ''}</span></div>
              </div>
            ))}
          </details>
        )}
      </SCard>

      <SCard title="Signing key" sub={`Sign-ins from ${hs.domain} to other homeservers are signed with this key. Make a new one if you think the old one got out.`}>
        {(keys.keys || []).map(k => (
          <div className="sx-list-row" key={k.kid}>
            <KeyRound size={18} className="hsx-list-ico" />
            <div className="sx-row-txt"><b className="vc-mono">{k.kid}{k.kid === keys.current && <i className="hsx-tag">In use</i>}</b>
              <span>{k.retired_at ? `Retired ${dateOf(k.retired_at)} - still published until ${dateOf(k.retired_at + KEEP_RETIRED)}` : `Made ${dateOf(k.created_at)}`}</span></div>
          </div>
        ))}
        {hs.isOwner
          ? <button type="button" className="btn btn-surface btn-sm hsx-block" disabled={!!busy} onClick={rotate}><RotateCw size={13} /> {busy === 'rotate' ? 'Making a key...' : 'Make a new key'}</button>
          : <small className="vc-hint hsx-foot">Only the owner can make a new key.</small>}
      </SCard>
      {saveError && <p className="vc-note hsx-warn" role="alert"><TriangleAlert size={14} /> {saveError}</p>}
      <UnsavedBar changed={changed} bar={bar} busy={busy === 'save'} disabled={fedPatch === null || accPatch === null || !!listIssue} onReset={() => { setSaveError(''); setF(federationForm(view)); setR(remoteForm(acc.remote_accounts)); }} onSave={save} />
    </>
  );
}
