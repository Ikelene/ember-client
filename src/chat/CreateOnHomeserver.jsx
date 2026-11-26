// Create a server on a homeserver that hosts many (ember-server protocol_version 2): pick the homeserver, name the server,
// and it is made there (POST /api/v1/servers). The homeservers offered are the ones in your list that host many, plus the
// one you signed in on. Whether you may create one isn't in a homeserver's discovery: its answer to the request says.
// Hosting a whole new server with Nookara (Hosting.jsx) stays one click away, and is not affected by any of this.
import { useEffect, useState } from 'react';
import { ChevronRight, Globe, Plus, Server, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../api.js';
import { Dialog } from './Dialogs.jsx';
import { initials } from './Parts.jsx';
import { useChat, go } from './store.js';
import { K, normOrigin } from './ids.js';
import { discover, addInstance, nookaraSession, instanceConn, loadInstanceData, hostOf, canHomeConnect, homeConnect } from './instances.js';
import { hasNookara } from './session.js';
import { currentSession, currentOrigin } from './homeserver.js';
import { isNookara } from '../compat.js';
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

export function CreateOnHomeserver({ onClose, onOther }) {
  const hosts = useCreateHosts();
  const [host, setHost] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false); // typed an address of their own (it stops following the name)
  const [policy, setPolicy] = useState('open');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (!touched) setSlug(slugFrom(name)); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const issue = slug ? slugIssue(slug) : null;

  // a homeserver that isn't connected yet (the one you signed in on): connect with your account first
  async function ready(h) {
    if (instanceConn(h.origin)?.session) return true;
    const d = await discover(h.origin);
    if (!isV2(d.info)) throw new Error('forbidden');
    if (canHomeConnect(d.origin, d.info)) { await homeConnect(d.origin, d.info); return true; } // (a homeserver session: its own token there)
    if (isNookara(d.info.accounts_mode) && hasNookara()) { await addInstance(d.origin, d.info, await nookaraSession(d.origin)); return true; }
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
      const d = await apiFetch('/api/v1/servers', { inst: host.origin, method: 'POST', body: JSON.stringify({ name: name.trim(), ...(slug ? { slug } : {}), join_policy: policy }) });
      const sid = d?.server?.sid ?? d?.sid; // (already origin|sid: apiFetch namespaces what an instance answers)
      await loadInstanceData(host.origin);
      onClose();
      if (sid) setTimeout(() => go({ kind: 'server', sid: String(sid).includes('|') ? sid : K(host.origin, sid) }), 200);
    } catch (er) { setErr(createErrorText(er)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog title="Create a server" sub={host ? `It will live on ${host.domain}. You can change all of this later.` : 'Pick the homeserver it will live on.'} onClose={onClose} wide className="vc-create-hs">
      {close => (!host ? (
        <>
          <div className="vc-rows">
            {hosts.map(h => (
              <button type="button" key={h.origin} className="vc-list-row bf-backup-pick" onClick={() => { setHost(h); setErr(''); }}>
                <span className="vc-srv-ico">{h.icon ? <img src={h.icon} alt="" /> : initials(h.name)}</span>
                <span className="vc-list-txt"><b>{h.name}</b><small>{h.domain}{h.home ? ' - your homeserver' : ''}</small></span>
                <span className="grow" /><ChevronRight size={16} />
              </button>
            ))}
            {onOther && (
              <button type="button" className="vc-list-row bf-backup-pick" onClick={() => { close(); setTimeout(onOther, 200); }}>
                <span className="vc-srv-ico act"><Server size={18} /></span>
                <span className="vc-list-txt"><b>A server of its own</b><small>Hosted by Nookara or by you, or add one by its address</small></span>
                <span className="grow" /><ChevronRight size={16} />
              </button>
            )}
          </div>
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Cancel</button></div>
        </>
      ) : (
        <form onSubmit={create}>
          <label className="vc-field"><span>Name</span><input className="form-input" autoFocus maxLength={60} value={name} onChange={e => { setName(e.target.value); setErr(''); }} /></label>
          <label className="vc-field"><span>Address (optional)</span>
            <div className="vc-row"><input className="form-input" maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="picked for you" aria-invalid={!!issue} value={slug}
              onChange={e => { setTouched(true); setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-')); setErr(''); }} /><span className="bf-ss-addr-at">@{host.domain}</span></div>
            {issue ? <small className="vc-hint bf-ss-addr-bad">{issue}</small> : <small className="vc-hint"><Globe size={12} className="vc-inline-ico" /> {slug ? `People will find it as ${slug}@${host.domain}.` : '3-32 lowercase letters, numbers and dashes. Leave it empty and the homeserver picks one.'}</small>}
          </label>
          <label className="vc-field"><span>Who can join</span>
            <select className="form-input" value={policy} onChange={e => setPolicy(e.target.value)}>{POLICIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
          <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={() => { setHost(null); setErr(''); }}>Back</button><span className="grow" />
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || !!issue || busy}><Plus size={15} /> {busy ? 'Creating...' : 'Create server'}</button></div>
        </form>
      ))}
    </Dialog>
  );
}
