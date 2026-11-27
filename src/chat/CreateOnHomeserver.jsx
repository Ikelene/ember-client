// Create a server on a homeserver that hosts many (ember-server protocol_version 2): pick the homeserver, name the server,
// and it is made there (POST /api/v1/servers). The homeservers offered are the ones in your list that host many, plus the
// one you signed in on. Whether you may create one isn't in a homeserver's discovery: its answer to the request says.
// The "+" dialog: Join (first) takes anything joining takes, and suggests a few servers from Discovery; Create is the above.
import { useEffect, useState } from 'react';
import { ChevronRight, Globe, Plus, Server, TriangleAlert, LogIn, AtSign, Users } from 'lucide-react';
import { apiFetch } from '../api.js';
import { EMBER_API } from '../compat.js';
import { loadDirectory } from './directory.js';
import { pickListed, isListedAdded } from './DiscoverPage.jsx';
import { joinTarget } from './joinInput.js';
import { HomeChip } from './homeLabels.jsx';
import { Dialog } from './Dialogs.jsx';
import { initials } from './Parts.jsx';
import { useChat, go, toast } from './store.js';
import { K, normOrigin } from './ids.js';
import { discover, addInstance, nookaraSession, instanceConn, loadInstanceData, hostOf, canHomeConnect, homeConnect, nookaraSignsIn, joinByAddress } from './instances.js';
import { hasNookara } from './session.js';
import { currentSession, currentOrigin } from './homeserver.js';
import { discoveryDoc } from './homeApi.js';
import { isV2, slugIssue, slugFrom, createErrorText } from './addresses.js';

// the homeservers a server can be made on: [{ origin, domain, name, icon, count, listed }]
export function createHosts(instances) {
  const out = (instances || []).filter(i => i.v2).map(i => ({
    origin: i.origin, domain: i.homeserver?.domain || i.host, name: i.homeserver?.name || i.name, icon: i.homeserver?.icon_url || i.icon || null, listed: true,
  }));
  let home = null;
  try { const o = normOrigin(currentOrigin()), s = currentSession(); if (o && s) home = { origin: o, domain: s.account?.domain || hostOf(o), name: s.account?.domain || hostOf(o), icon: null, listed: false, home: true }; } catch { /* no homeserver sign-in */ }
  if (home) { const at = out.find(h => h.origin === home.origin); if (at) at.home = true; else out.unshift(home); }
  return out;
}
export const useCreateHosts = () => createHosts(useChat(s => s.instances));

const POLICIES = [['open', 'Anyone can join'], ['request', 'People ask to join'], ['invite', 'Only with an invite']];

export function CreateOnHomeserver({ onClose, start = 'join' }) {
  const hosts = useCreateHosts();
  const [tab, setTab] = useState(start); // join | create
  const [host, setHost] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false); // typed an address of their own (it stops following the name; until then focusing it selects it all, so typing replaces it)
  const [policy, setPolicy] = useState('open');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // creation "on request" (PROTOCOL §5a): the same form asks an admin instead, and lists what you asked for
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [desc, setDesc] = useState('');
  const [mine, setMine] = useState(null);
  const admin = useChat(s => !!host && !!s.instances.find(i => i.origin === host.origin)?.isAdmin);
  useEffect(() => {
    setAsking(false); setMine(null);
    if (!host) return undefined;
    let live = true;
    discoveryDoc(host.origin).then(d => { if (live && d?.creation?.mode === 'request' && !admin) setAsking(true); }).catch(() => {});
    return () => { live = false; };
  }, [host?.origin, admin]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMine = () => apiFetch('/api/v2/server-requests', { inst: host.origin }).then(d => setMine(Array.isArray(d?.requests) ? d.requests : []), () => setMine([]));
  useEffect(() => { if (asking && host && instanceConn(host.origin)?.session) loadMine(); }, [asking, host?.origin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const f = e => { if (host && e.detail?.origin === host.origin) loadMine(); }; addEventListener('ember-server-request', f); return () => removeEventListener('ember-server-request', f); }, [host?.origin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!touched) setSlug(slugFrom(name)); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const issue = slug ? slugIssue(slug) : null;

  // a homeserver that isn't connected yet (the one you signed in on): connect with your account first
  async function ready(h) {
    if (instanceConn(h.origin)?.session) return true;
    const d = await discover(h.origin);
    if (!isV2(d.info)) throw new Error('forbidden');
    if (canHomeConnect(d.origin, d.info)) { await homeConnect(d.origin, d.info); return true; } // (a homeserver session: its own token there)
    if (nookaraSignsIn(d.info) && hasNookara()) { await addInstance(d.origin, d.info, await nookaraSession(d.origin)); return true; }
    onClose();
    dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url: d.origin } })); // (it has to ask for a login)
    return false;
  }
  async function create(e) {
    e.preventDefault();
    if (!name.trim() || issue || busy) return;
    setBusy(true); setErr('');
    try {
      if (!(await ready(host))) return;
      if (asking) {
        await apiFetch('/api/v2/server-requests', { inst: host.origin, method: 'POST', body: JSON.stringify({ name: name.trim(), ...(slug ? { slug } : {}), ...(desc.trim() ? { description: desc.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }) });
        toast(`Asked for ${name.trim()}. You'll hear when an admin answers.`, true);
        setName(''); setNote(''); setDesc(''); setTouched(false);
        loadMine();
        return;
      }
      const d = await apiFetch('/api/v1/servers', { inst: host.origin, method: 'POST', body: JSON.stringify({ name: name.trim(), ...(slug ? { slug } : {}), join_policy: policy }) });
      const sid = d?.server?.sid ?? d?.sid; // (already origin|sid: apiFetch namespaces what an instance answers)
      await loadInstanceData(host.origin);
      onClose();
      if (sid) setTimeout(() => go({ kind: 'server', sid: String(sid).includes('|') ? sid : K(host.origin, sid) }), 200);
    } catch (er) {
      if ((er.error || er.message) === 'creation_requires_approval') { setAsking(true); setErr('This homeserver makes servers on request: send it as a request below.'); }
      else setErr(createErrorText(er));
    }
    finally { setBusy(false); }
  }

  const picking = tab === 'join' || !host;
  return (
    <Dialog title={tab === 'join' ? 'Join a server' : 'Create a server'} sub={tab === 'join' ? "Paste an invite, or type a server's address." : host ? `It will live on ${host.domain}. You can change all of this later.` : 'Pick the homeserver it will live on.'} onClose={onClose} wide className="vc-create-hs">
      {close => (
        <>
          {picking && (
            <div className="vc-ch-tabs" role="tablist">
              {[['join', 'Join', LogIn], ['create', 'Create', Plus]].map(([id, label, Icon]) => (
                <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setErr(''); }}><Icon size={15} /> {label}</button>
              ))}
            </div>
          )}
          {tab === 'join' ? <JoinPane close={close} /> : !host ? (
            <>
              <div className="vc-rows">
                {hosts.map(h => (
                  <button type="button" key={h.origin} className="vc-list-row bf-backup-pick vc-ch-row" onClick={() => { setHost(h); setErr(''); }}>
                    <span className="vc-ch-ico">{h.icon ? <img src={h.icon} alt="" /> : initials(h.name)}</span>
                    <span className="vc-list-txt"><b>{h.name}</b><small><HomeChip domain={h.domain} />{h.home ? ' your homeserver' : ''}</small></span>
                    <ChevronRight size={16} className="vc-ch-chev" />
                  </button>
                ))}
                {!hosts.length && <div className="sx-empty"><Server size={28} /><b>No homeserver to create it on</b><span>Sign in to a homeserver first (Settings &gt; Homeservers).</span></div>}
              </div>
              <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Cancel</button></div>
            </>
          ) : (
            <form onSubmit={create}>
              <label className="vc-field"><span>Name</span><input className="form-input" autoFocus maxLength={60} value={name} onChange={e => { setName(e.target.value); setErr(''); }} /></label>
              <label className="vc-field"><span>Address (optional)</span>
                <div className="vc-row"><input className="form-input" maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="picked for you" aria-invalid={!!issue} value={slug}
                  onFocus={e => { if (!touched) e.target.select(); }} onMouseUp={e => { if (!touched) e.preventDefault(); }}
                  onChange={e => { setTouched(true); setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-')); setErr(''); }} /><span className="bf-ss-addr-at">@{host.domain}</span></div>
                {issue ? <small className="vc-hint bf-ss-addr-bad">{issue}</small> : <small className="vc-hint"><Globe size={12} className="vc-inline-ico" /> {slug ? `People will find it as ${slug}@${host.domain}.` : '3-32 lowercase letters, numbers and dashes. Leave it empty and the homeserver picks one.'}</small>}
              </label>
              {asking ? <>
                <label className="vc-field"><span>What it's for (optional)</span><input className="form-input" maxLength={300} value={desc} onChange={e => setDesc(e.target.value)} /></label>
                <label className="vc-field"><span>Note to the admins (optional)</span><textarea className="form-textarea" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
                <p className="vc-hint">{host.domain} makes servers on request: an admin looks at it, and you hear the answer here.</p>
              </> : <label className="vc-field"><span>Who can join</span>
                <select className="form-input" value={policy} onChange={e => setPolicy(e.target.value)}>{POLICIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
              {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
              <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={() => { setHost(null); setErr(''); }}>Back</button><span className="grow" />
                <button type="submit" className="btn btn-primary" disabled={!name.trim() || !!issue || busy}><Plus size={15} /> {busy ? (asking ? 'Asking...' : 'Creating...') : asking ? 'Request server' : 'Create server'}</button></div>
              {asking && mine && mine.length > 0 && (
                <div className="vc-rows vc-gap-top">
                  <div className="vc-ch-sugg-head">Your requests</div>
                  {mine.map(r => (
                    <div key={r.id} className="vc-list-row vc-ch-row">
                      <span className="vc-list-txt"><b>{r.name}</b><small>{r.status === 'pending' ? 'Waiting for an admin' : r.status === 'approved' ? 'Approved - it is in your list' : r.status === 'rejected' ? `Declined${r.reason ? `: ${r.reason}` : ''}` : 'Cancelled'}</small></span>
                      {r.status === 'pending' && <button type="button" className="btn btn-surface btn-sm" onClick={() => apiFetch(`/api/v2/server-requests/${r.id}`, { inst: host.origin, method: 'DELETE' }).then(d => setMine(Array.isArray(d?.requests) ? d.requests : []), er => toast(createErrorText(er)))}>Cancel</button>}
                    </div>
                  ))}
                </div>
              )}
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}

// Join: one field for everything joining takes (slug@domain, slug@domain/code, https://domain/i/slug/code, an old invite link or
// code, a homeserver's address), and a few listed servers from Discovery I'm not in yet
const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(Object.assign(new Error('request_failed'), { status: r.status }))));
function JoinPane({ close }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [listed, setListed] = useState(null); // null = loading
  const [busy, setBusy] = useState('');
  const servers = useChat(s => s.servers);
  const mine = useChat(s => s.instances);
  useEffect(() => {
    let live = true;
    loadDirectory(getJson, EMBER_API, {}).then(d => { if (live) setListed(d.groups.flatMap(g => g.communities)); }).catch(() => { if (live) setListed([]); });
    return () => { live = false; };
  }, []);
  const suggested = (listed || []).filter(r => (r.url || r.address) && !isListedAdded(r, servers, mine)).slice(0, 5);
  function submit(e) {
    e.preventDefault();
    const t = joinTarget(text);
    if (!t) { setErr("Paste an invite link, or type a server's address like name@example.com."); return; }
    close();
    setTimeout(() => {
      if (t.kind === 'address') joinByAddress(t.address);
      else if (t.kind === 'invite') dispatchEvent(new CustomEvent('vc-invite', { detail: { code: t.code, inst: t.inst } }));
      else dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url: t.url } }));
    }, 200);
  }
  async function pick(r) {
    setBusy(r.key);
    const ok = await pickListed(r, servers, mine).catch(() => false);
    setBusy('');
    if (ok) close();
  }
  return (
    <form onSubmit={submit}>
      <label className="vc-field"><span>Invite or address</span>
        <input className="form-input" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@example.com, or an invite link" value={text} onChange={e => { setText(e.target.value); setErr(''); }} />
        <small className="vc-hint"><AtSign size={12} className="vc-inline-ico" /> A server's address (name@example.com), or an invite link or code.</small>
      </label>
      {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
      <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={close}>Cancel</button><span className="grow" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}><LogIn size={15} /> Join</button></div>
      {(listed === null || suggested.length > 0) && <div className="vc-ch-sugg-head">Suggested from Discovery</div>}
      {listed === null && <div className="vc-loading"><i /><i /><i /></div>}
      <div className="vc-rows">
        {suggested.map(r => (
          <button type="button" key={r.key} className="vc-list-row bf-backup-pick vc-ch-row" disabled={!!busy} onClick={() => pick(r)}>
            <span className="vc-ch-ico">{/^https:\/\//i.test(r.icon_url || '') ? <img src={r.icon_url} alt="" /> : initials(r.name)}</span>
            <span className="vc-list-txt"><b>{r.name} <HomeChip domain={r.address ? r.address.split('@')[1] : hostOf(r.url)} /></b><small>{r.address || hostOf(r.url)} - <Users size={11} /> {r.member_count}</small></span>
            {busy === r.key ? <i className="vc-gate-spin" /> : <ChevronRight size={16} className="vc-ch-chev" />}
          </button>
        ))}
      </div>
    </form>
  );
}
