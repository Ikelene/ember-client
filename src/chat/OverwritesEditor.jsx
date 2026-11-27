// Channel settings > Permissions (and a category's) on an Ember server, Discord-style (ember-server PROTOCOL §6.5): the
// overwrites on the left (@everyone, roles, members, people from other homeservers too), every channel permission on the
// right with deny / inherit / allow, "Synced with category" and Sync, and a "Check a member" panel that asks the server what
// someone may really do here. Saved together with the bulk PUT.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Plus, Trash2, X, Slash, Check, RefreshCw, Search, UserCheck, Link2, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, ask, toast, refreshServer, loadMembers, fullHandle } from './store.js';
import { instOf } from './ids.js';
import { Card } from './SettingsShell.jsx';
import { UnsavedBar } from './unsaved.jsx';
import { useUnsaved } from './useUnsaved.js';
import { CH, CH_GROUPS, groupsFor, namesOf, owBits, owPath, catOwPath, effectivePath, overwriteErrorText } from './channelPerms.js';

const keyOf = o => `${o.type}:${o.id}`;
const label = n => CH_GROUPS.flatMap(([, l]) => l).find(([k]) => k === n)?.[1] || n;
const sameRows = (a, b) => JSON.stringify(a.map(o => [keyOf(o), o.allow, o.deny]).sort()) === JSON.stringify(b.map(o => [keyOf(o), o.allow, o.deny]).sort());

// channel: the channel view (a channel's permissions) | category: its name (a category's)
export function OverwritesEditor({ sid, channel = null, category = null, onDirty = null }) {
  const inst = instOf(sid);
  const roles = useChat(s => s.detail[sid]?.roles);
  const members = useChat(s => s.members[sid]);
  const path = channel ? owPath(sid, channel.cid) : catOwPath(sid, category);
  const [info, setInfo] = useState(null); // { perms_synced, category } as loaded
  const [base, setBase] = useState(null); // rows as saved
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const load = () => {
    setLoadErr('');
    apiFetch(path, { inst }).then(d => {
      const synced = !!d.perms_synced && !!d.category;
      const list = (synced ? d.overwrites : d.own ?? d.overwrites ?? []).map(o => ({ type: o.type, id: String(o.everyone ? 'everyone' : o.id), name: o.name, display_name: o.display_name, everyone: !!o.everyone || o.id === 'everyone', ...owBits(o) }));
      setInfo({ synced, category: d.category || null });
      setBase(list); setRows(list);
      setSel(s => s || keyOf(list.find(o => o.everyone) || { type: 'role', id: 'everyone' }));
    }, e => setLoadErr(e.message));
  };
  useEffect(load, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  // changed elsewhere (another admin, a sync, a category rename: chat_channels_update / chat_perms_changed): load again, unless
  // there are unsaved edits here
  const liveKey = useChat(st => { const c = channel ? st.detail[sid]?.channels?.find(x => x.cid === channel.cid) : null; return c ? JSON.stringify([c.permission_overwrites, c.perms_synced, c.category]) : JSON.stringify(st.detail[sid]?.categories || []); });
  const dirtyRef = useRef(false);
  useEffect(() => { if (base && !dirtyRef.current) load(); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!members) loadMembers(sid); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!rows && !!base && !sameRows(rows, base);
  dirtyRef.current = dirty;
  const [bar, flashSaved] = useUnsaved(dirty, onDirty || undefined);
  const groups = useMemo(() => groupsFor(channel ? channel.type || 'text' : 'category'), [channel?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadErr) return <Card title="Permissions" icon={Shield}><p className="vc-note"><TriangleAlert size={14} /> {overwriteErrorText({ error: loadErr })} <button type="button" className="btn btn-surface btn-sm" onClick={load}>Try again</button></p></Card>;
  if (!rows || !roles) return <div className="vc-loading"><i /><i /><i /></div>;

  const everyoneRole = roles.find(r => r.is_default);
  const roleOf = id => roles.find(r => String(r.rid) === String(id));
  const memberOf = id => (members || []).find(m => String(m.id) === String(id));
  const who = o => {
    if (o.type === 'role') return o.everyone ? '@everyone' : roleOf(o.id)?.name || o.name || 'Deleted role';
    const m = memberOf(o.id);
    // Display name (user@domain), people of this homeserver too
    const handle = m?.handle || (m?.username ? fullHandle(m.username, inst) : o.id);
    return `${m?.display_name || o.display_name || m?.username || o.name || o.id} (${handle})`;
  };
  // @everyone is always listed (an empty one is just "nothing changed")
  const shown = [...(rows.some(o => o.everyone) ? [] : [{ type: 'role', id: 'everyone', everyone: true, allow: 0, deny: 0 }]), ...rows]
    .sort((a, b) => (b.everyone - a.everyone) || (a.type === b.type ? (a.type === 'role' ? (roleOf(b.id)?.position || 0) - (roleOf(a.id)?.position || 0) : who(a).localeCompare(who(b))) : a.type === 'role' ? -1 : 1));
  const cur = shown.find(o => keyOf(o) === sel) || shown[0];
  const stateOf = (o, n) => (o.deny & CH[n] ? 'deny' : o.allow & CH[n] ? 'allow' : 'inherit');
  function setBit(o, n, to) {
    setError('');
    setRows(list => {
      const had = list.find(x => keyOf(x) === keyOf(o));
      const next = { ...(had || o), allow: (had || o).allow & ~CH[n], deny: (had || o).deny & ~CH[n] };
      if (to === 'allow') next.allow |= CH[n]; if (to === 'deny') next.deny |= CH[n];
      return had ? list.map(x => (keyOf(x) === keyOf(o) ? next : x)) : [...list, next];
    });
  }
  const remove = o => { setError(''); setRows(list => list.filter(x => keyOf(x) !== keyOf(o))); if (keyOf(o) === sel) setSel('role:everyone'); };
  function add(o) { setRows(list => (list.some(x => keyOf(x) === keyOf(o)) ? list : [...list, { ...o, allow: 0, deny: 0 }])); setSel(keyOf(o)); setAdding(false); setQ(''); }
  async function save() {
    setBusy('save'); setError('');
    try {
      const body = { overwrites: rows.filter(o => o.allow || o.deny).map(o => ({ type: o.type, id: o.type === 'role' && o.everyone ? 'everyone' : o.id, allow: namesOf(o.allow), deny: namesOf(o.deny) })) };
      await apiFetch(path, { inst, method: 'PUT', body: JSON.stringify(body) });
      await refreshServer(sid);
      load();
      if (onDirty) flashSaved(); else toast('Permissions saved.', true);
    } catch (e) { const t = overwriteErrorText({ ...e, error: e.message }); setError(t); toast(t); }
    setBusy('');
  }
  async function sync() {
    if (!(await ask({ title: `Sync with ${info.category}?`, text: `#${channel.name} drops its own permissions and follows the ${info.category} category's again.`, confirm: 'Sync' }))) return;
    setBusy('sync');
    try { await apiFetch(`${path}/sync`, { inst, method: 'POST' }); await refreshServer(sid); load(); toast(`Synced with ${info.category}.`, true); }
    catch (e) { toast(overwriteErrorText({ ...e, error: e.message })); }
    setBusy('');
  }
  const needle = q.trim().toLowerCase();
  const addRoles = roles.filter(r => !r.is_default && !rows.some(o => o.type === 'role' && String(o.id) === String(r.rid)) && (!needle || r.name.toLowerCase().includes(needle)));
  const addMembers = (members || []).filter(m => m.id != null && !rows.some(o => o.type === 'member' && String(o.id) === String(m.id)) && (!needle || `${m.display_name || ''} ${m.username} ${m.handle || ''}`.toLowerCase().includes(needle))).slice(0, 30);

  const editor = (
    <>
      {channel && info.category && (info.synced
        ? <p className="vc-note ow-sync"><Link2 size={14} /> Synced with the <b>{info.category}</b> category. Changing anything here gives #{channel.name} its own copy and stops syncing.</p>
        : <p className="vc-note ow-sync"><Link2 size={14} /> Not synced with the <b>{info.category}</b> category: #{channel.name} has its own permissions. <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={sync}><RefreshCw size={13} /> {busy === 'sync' ? 'Syncing...' : 'Sync now'}</button></p>)}
      {error && <p className="vc-note ow-err"><TriangleAlert size={14} /> {error}</p>}
      <div className="ow">
        <div className="ow-list">
          {shown.map(o => (
            <button type="button" key={keyOf(o)} className={`ow-item${keyOf(o) === keyOf(cur) ? ' on' : ''}`} onClick={() => setSel(keyOf(o))}
              style={o.type === 'role' && roleOf(o.id)?.color ? { '--rc': roleOf(o.id).color } : undefined}>
              <span className={`ow-dot ${o.type}`} />{who(o)}
              {(o.allow || o.deny) ? <small>{namesOf(o.allow).length ? `+${namesOf(o.allow).length}` : ''}{namesOf(o.deny).length ? ` -${namesOf(o.deny).length}` : ''}</small> : null}
            </button>
          ))}
          <div className="ow-add">
            {!adding ? <button type="button" className="btn btn-surface btn-sm" onClick={() => setAdding(true)}><Plus size={13} /> Add role or member</button> : (
              <div className="ow-pick">
                <label className="ow-search"><Search size={13} /><input autoFocus placeholder="Role or member" value={q} onChange={e => setQ(e.target.value)} /><button type="button" className="vc-ico-btn" aria-label="Close" onClick={() => { setAdding(false); setQ(''); }}><X size={13} /></button></label>
                <div className="ow-pick-list">
                  {addRoles.length > 0 && <small className="ow-pick-h">Roles</small>}
                  {addRoles.map(r => <button type="button" key={`r${r.rid}`} style={r.color ? { color: r.color } : undefined} onClick={() => add({ type: 'role', id: String(r.rid), name: r.name })}>{r.name}</button>)}
                  {addMembers.length > 0 && <small className="ow-pick-h">Members</small>}
                  {addMembers.map(m => <button type="button" key={`m${m.id}`} onClick={() => add({ type: 'member', id: String(m.id), display_name: m.display_name || m.username })}>{who({ type: 'member', id: m.id })}</button>)}
                  {!addRoles.length && !addMembers.length && <small className="vc-hint">Nobody matches.</small>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ow-perms">
          <div className="ow-perms-head"><b>{who(cur)}</b>{!cur.everyone && rows.some(x => keyOf(x) === keyOf(cur)) && <button type="button" className="btn btn-surface btn-sm ac-danger" onClick={() => remove(cur)}><Trash2 size={13} /> Remove</button>}</div>
          {cur.everyone && <small className="vc-hint">Applies to everyone, before roles and members. A role's allow wins over this; a member's own setting wins over everything.</small>}
          {groups.map(([g, list]) => (
            <div key={g} className="ow-group">
              <div className="ow-group-h">{g}</div>
              {list.map(([n, l, hint]) => {
                const st = stateOf(cur, n);
                return (
                  <div key={n} className="ow-row">
                    <span className="ow-row-txt"><b>{l}</b><small>{hint}</small></span>
                    <span className="ow-tri" role="radiogroup" aria-label={l}>
                      <button type="button" role="radio" aria-checked={st === 'deny'} className={st === 'deny' ? 'on deny' : ''} title="Deny" onClick={() => setBit(cur, n, 'deny')}><X size={14} /></button>
                      <button type="button" role="radio" aria-checked={st === 'inherit'} className={st === 'inherit' ? 'on' : ''} title="Inherit (no change here)" onClick={() => setBit(cur, n, 'inherit')}><Slash size={12} /></button>
                      <button type="button" role="radio" aria-checked={st === 'allow'} className={st === 'allow' ? 'on allow' : ''} title="Allow" onClick={() => setBit(cur, n, 'allow')}><Check size={14} /></button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {!onDirty && <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" disabled={!dirty || !!busy} onClick={() => setRows(base)}>Reset</button><button type="button" className="btn btn-primary" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? 'Saving...' : 'Save permissions'}</button></div>}
    </>
  );
  return (
    <div className="bf-ss-page">
      <Card title="Permissions" icon={Shield}>{editor}</Card>
      {channel && <CheckMember sid={sid} channel={channel} members={members} who={who} />}
      {onDirty && <UnsavedBar changed={dirty} bar={bar} busy={busy === 'save'} onReset={() => { setError(''); setRows(base); }} onSave={save} />}
    </div>
  );
}

// "Check a member": what someone may really do in this channel, as the server works it out (GET …/permissions/:principal)
function CheckMember({ sid, channel, members, who }) {
  const [id, setId] = useState('');
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!id) { setR(null); return undefined; }
    let live = true;
    setR(null); setErr('');
    apiFetch(effectivePath(sid, channel.cid, id), { inst: instOf(sid) }).then(d => live && setR(d), e => live && setErr(e.message === 'channel_not_found' ? "They can't see this channel." : overwriteErrorText({ error: e.message })));
    return () => { live = false; };
  }, [id, channel.cid]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = new Set(r?.names || []);
  return (
    <Card title="Check a member" icon={UserCheck}>
      <label className="vc-field"><span>What can they do in #{channel.name}?</span>
        <select className="form-input" value={id} onChange={e => setId(e.target.value)}>
          <option value="">Pick a member</option>
          {(members || []).filter(m => m.id != null).map(m => <option key={m.id} value={m.id}>{who({ type: 'member', id: m.id })}</option>)}
        </select></label>
      {err && <p className="vc-note"><TriangleAlert size={14} /> {err}</p>}
      {r && (r.owner || r.administrator
        ? <p className="vc-hint">{r.owner ? 'The owner' : 'An Administrator'}: everything, whatever the permissions say.</p>
        : <div className="ow-check">{groupsFor(channel.type || 'text').flatMap(([, l]) => l).map(([n]) => <span key={n} className={names.has(n) ? 'yes' : 'no'}>{names.has(n) ? <Check size={12} /> : <X size={12} />} {label(n)}</span>)}</div>)}
    </Card>
  );
}
