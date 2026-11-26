// Settings > Homeservers: the homeservers you are an admin or the owner of, and for each one its settings in tabs:
// Accounts & sign-in (PROTOCOL §4a), Servers (who may create them, §5a), Admins, and Federation (not built yet).
import { useEffect, useRef, useState } from 'react';
import { Building2, ArrowLeft, Globe, Users, KeyRound, ShieldCheck, TriangleAlert, RefreshCw, Trash2, Network, Crown, Settings2, Server, UserPlus } from 'lucide-react';
import { SettingsPage, SCard, SRow, Switch } from './ui.jsx';
import { LoginMethods } from './LoginMethods.jsx';
import { ask, toast } from '../store.js';
import { Avatar } from '../Profile.jsx';
import { HomeserverIcon } from '../HomeserverLogin.jsx';
import { InstanceTab, restartInstance } from '../Instances.jsx';
import { refreshInstance } from '../instances.js';
import { useUnsaved, UnsavedBar } from '../unsaved.jsx';
import { hsCall, viaInstance, discoveryDoc, useAdminHomeservers } from '../homeApi.js';
import { REGISTRATION, REMOTE_MODES, CREATION_MODES, methodsToSend, sameMethods, methodIssues, hostList, nameList, adminErrorText } from '../homeAdmin.js';
import './accounts-pages.css';
import './homeservers.css';

const TABS = [['accounts', 'Accounts & sign-in', KeyRound], ['servers', 'Servers', Server], ['admins', 'Admins', ShieldCheck], ['federation', 'Federation', Network]];
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

  if (!hs) {
    return (
      <SettingsPage icon={Building2} title="Homeservers" sub="Homeservers you run: who can sign in, who can create servers, and who helps you run them.">
        <SCard>
          {list.length ? list.map(h => (
            <div className="sx-list-row" key={h.origin}>
              <HomeserverIcon hs={h} className="ac-ico" />
              <div className="sx-row-txt"><b>{h.name}</b><span className="ac-host"><Globe size={12} /> {h.domain} - {h.isOwner ? 'you own it' : "you're an admin"}</span></div>
              <div className="sx-row-ctl"><button type="button" className="btn btn-primary btn-sm" onClick={() => { setTab('accounts'); setOrigin(h.origin); }}><Settings2 size={13} /> Manage</button></div>
            </div>
          )) : <div className="sx-empty"><Building2 size={28} /><b>No homeservers to manage</b><span>Homeservers where you're an admin or the owner show here once you're signed in to them.</span></div>}
        </SCard>
      </SettingsPage>
    );
  }
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
      {tab === 'federation' && <SCard><div className="sx-empty"><Network size={28} /><b>Federation is coming</b><span>Choosing which other homeservers this one talks to, and what it shares with them, will be set here.</span></div></SCard>}
    </div>
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
  remote_mode: d.remote_accounts?.mode || 'none', remote_list: (d.remote_accounts?.list || []).join('\n'),
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
    const hosts = hostList(f.remote_list);
    if (f.remote_mode !== (cfg.remote_accounts?.mode || 'none') || !sameList(hosts, cfg.remote_accounts?.list || [])) patch.remote_accounts = { mode: f.remote_mode, list: hosts };
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
  const needsList = f.remote_mode === 'allowlist' || f.remote_mode === 'blocklist';
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
      </SCard>

      <SCard title="Accounts from other homeservers" sub="Which other homeservers' accounts are let in. This is saved and shown now; it starts being enforced with federation.">
        <Choices name="hsx-remote" value={f.remote_mode} options={REMOTE_MODES} onPick={v => set({ remote_mode: v })} />
        {needsList && (
          <label className="vc-field hsx-block"><span>{f.remote_mode === 'allowlist' ? 'Homeservers let in' : 'Homeservers kept out'}</span>
            <textarea className="form-textarea" rows={4} spellCheck={false} autoCapitalize="none" placeholder={'nookara.cc\n*.example.org'} value={f.remote_list} onChange={e => set({ remote_list: e.target.value })} />
            <small className="vc-hint">One domain per line. *.example.org covers every name under it.</small></label>
        )}
      </SCard>
      {saveError && <p className="vc-note hsx-warn" role="alert"><TriangleAlert size={14} /> {saveError}</p>}
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
