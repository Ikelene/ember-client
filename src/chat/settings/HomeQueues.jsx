// What a homeserver's admins answer (Settings > Homeservers > Manage): registration invites and the accounts waiting for
// approval (PROTOCOL §4a Registration), and the servers people asked for when creating is "on request" (§5a).
import { useEffect, useState } from 'react';
import { Copy, Trash2, Check, X, Plus, RefreshCw, UserPlus, Server } from 'lucide-react';
import { SCard } from './ui.jsx';
import { ask, toast } from '../store.js';
import { hsCall } from '../homeApi.js';
import { adminErrorText } from '../homeAdmin.js';

const when = t => { const d = new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
// reloads when the gateway says someone asked (instances.js: ember-hs-pending)
function usePendingPing(origin, load) {
  useEffect(() => {
    const f = e => { if (e.detail?.origin === origin) load(); };
    addEventListener('ember-hs-pending', f);
    return () => removeEventListener('ember-hs-pending', f);
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Accounts & sign-in: invites (mode invite) and accounts waiting (mode approval) ──
export function RegistrationQueue({ hs, mode }) {
  const { origin } = hs;
  const [d, setD] = useState(null); // { registration, invites, pending }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [uses, setUses] = useState('1');
  const [hours, setHours] = useState('168');
  const [note, setNote] = useState('');
  const load = () => { setErr(''); hsCall(origin, '/api/v2/homeserver/registration').then(setD, e => setErr(e.status === 404 ? 'old' : adminErrorText(e))); };
  useEffect(load, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  usePendingPing(origin, load);
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { toast(adminErrorText(e)); } setBusy(''); };
  if (err === 'old') return null; // (older software: nothing to show)
  if (err) return <SCard title="Invites and requests"><p className="vc-note">{err} <button type="button" className="btn btn-surface btn-sm" onClick={load}><RefreshCw size={13} /> Try again</button></p></SCard>;
  if (!d) return null;
  const invites = d.invites || [], pending = d.pending || [];
  const showInvites = mode === 'invite' || invites.length > 0;
  const create = e => {
    e.preventDefault();
    const body = { ...(uses.trim() ? { max_uses: Number(uses) } : {}), ...(hours.trim() ? { expires_in_hours: Number(hours) } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
    run('new', async () => { const r = await hsCall(origin, '/api/v2/homeserver/registration/invites', { method: 'POST', body }); setNote(''); load(); if (r?.invite?.code) { navigator.clipboard?.writeText(r.invite.code).catch(() => {}); toast(`Invite ${r.invite.code} made and copied.`, true); } });
  };
  return (
    <>
      {showInvites && (
        <SCard title="Registration invites" sub={mode === 'invite' ? 'New accounts need one of these codes. People type it on the sign-up form, or open the sign-in link with it.' : "Registration isn't invite-only right now, so these codes aren't asked for."}>
          <form className="hsx-inv-new" onSubmit={create}>
            <label className="vc-field"><span>Uses</span><input className="form-input" inputMode="numeric" value={uses} onChange={e => setUses(e.target.value.replace(/\D/g, ''))} placeholder="no limit" /></label>
            <label className="vc-field"><span>Lasts (hours)</span><input className="form-input" inputMode="numeric" value={hours} onChange={e => setHours(e.target.value.replace(/\D/g, ''))} placeholder="forever" /></label>
            <label className="vc-field grow"><span>Note</span><input className="form-input" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="who it's for (only admins see this)" /></label>
            <button type="submit" className="btn btn-primary" disabled={!!busy}><Plus size={14} /> Make invite</button>
          </form>
          {invites.length === 0 ? <p className="vc-hint">No invites yet.</p> : (
            <div className="hsx-list">
              {invites.map(i => (
                <div key={i.code} className="hsx-list-row">
                  <code className="vc-info-mono">{i.code}</code>
                  <span className="sx-row-txt"><small>{i.max_uses ? `${i.uses || 0} of ${i.max_uses} used` : `${i.uses || 0} used`}{i.expires_at ? ` - until ${when(i.expires_at)}` : ''}{i.note ? ` - ${i.note}` : ''}</small></span>
                  <button type="button" className="vc-ico-btn" title="Copy" onClick={() => navigator.clipboard?.writeText(i.code).then(() => toast('Copied.', true), () => {})}><Copy size={14} /></button>
                  <button type="button" className="vc-ico-btn" title="Revoke" disabled={!!busy} onClick={async () => { if (await ask({ title: `Revoke invite ${i.code}?`, text: 'Nobody can use it after this.', confirm: 'Revoke', danger: true })) run(i.code, async () => { await hsCall(origin, `/api/v2/homeserver/registration/invites/${encodeURIComponent(i.code)}`, { method: 'DELETE' }); load(); }); }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </SCard>
      )}
      {(mode === 'approval' || pending.length > 0) && (
        <SCard title={`Waiting for approval${pending.length ? ` - ${pending.length}` : ''}`} sub="People who asked for an account. They can't sign in until an admin approves them; rejecting deletes the account.">
          {pending.length === 0 ? <p className="vc-hint">Nobody is waiting.</p> : (
            <div className="hsx-list">
              {pending.map(p => (
                <div key={p.id} className="hsx-list-row">
                  <UserPlus size={16} />
                  <span className="sx-row-txt"><b>{p.display_name && p.display_name !== p.username ? `${p.display_name} (${p.username})` : p.username}</b><small>{when(p.created_at)}{(p.logins || []).length ? ` - ${(p.logins || []).map(l => l.email || l.method).join(', ')}` : ''}</small></span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run(p.id, async () => { await hsCall(origin, `/api/v2/homeserver/registration/pending/${encodeURIComponent(p.id)}/approve`, { method: 'POST' }); toast(`${p.username} can sign in now.`, true); load(); })}><Check size={13} /> Approve</button>
                  <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={async () => { if (await ask({ title: `Reject ${p.username}?`, text: 'The account is deleted.', confirm: 'Reject', danger: true })) run(p.id, async () => { await hsCall(origin, `/api/v2/homeserver/registration/pending/${encodeURIComponent(p.id)}/reject`, { method: 'POST' }); load(); }); }}><X size={13} /> Reject</button>
                </div>
              ))}
            </div>
          )}
        </SCard>
      )}
    </>
  );
}

// ── Servers: what people asked for (creation mode "request") ──
export function ServerRequestsQueue({ hs }) {
  const { origin } = hs;
  const [status, setStatus] = useState('pending');
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => { setErr(''); hsCall(origin, `/api/v2/homeserver/server-requests?status=${status}`).then(d => setList(d.requests || []), e => setErr(e.status === 404 ? 'old' : adminErrorText(e))); };
  useEffect(load, [origin, status]); // eslint-disable-line react-hooks/exhaustive-deps
  usePendingPing(origin, load);
  if (err === 'old') return null;
  const act = (r, what) => async () => {
    let body;
    if (what === 'reject') { const reason = window.prompt(`Why not? ${r.account?.username || 'They'} will see this (optional).`, ''); if (reason === null) return; body = reason.trim() ? { reason: reason.trim().slice(0, 300) } : {}; }
    setBusy(String(r.id));
    try { await hsCall(origin, `/api/v2/homeserver/server-requests/${r.id}/${what}`, { method: 'POST', body: body || {} }); toast(what === 'approve' ? `${r.name} was made.` : 'Declined.', true); load(); }
    catch (e) { toast(adminErrorText(e)); }
    setBusy('');
  };
  return (
    <SCard title="Server requests" sub="With creating set to On request, people ask for a server here. Approving makes it, owned by whoever asked.">
      <div className="sx-seg hsx-req-seg">{['pending', 'approved', 'rejected', 'cancelled'].map(s => <button type="button" key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
      {err && <p className="vc-note">{err}</p>}
      {list === null ? <div className="vc-loading"><i /><i /><i /></div> : list.length === 0 ? <p className="vc-hint">Nothing {status}.</p> : (
        <div className="hsx-list">
          {list.map(r => (
            <div key={r.id} className="hsx-list-row">
              <Server size={16} />
              <span className="sx-row-txt"><b>{r.name}{r.slug ? ` (${r.slug}@${hs.domain})` : ''}</b><small>{r.account?.username || ''} - {when(r.created_at)}{r.note ? ` - "${r.note}"` : ''}{r.reason ? ` - ${r.reason}` : ''}</small>{r.description && <small>{r.description}</small>}</span>
              {r.status === 'pending' && <>
                <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={act(r, 'approve')}><Check size={13} /> Approve</button>
                <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={act(r, 'reject')}><X size={13} /> Decline</button>
              </>}
            </div>
          ))}
        </div>
      )}
    </SCard>
  );
}
