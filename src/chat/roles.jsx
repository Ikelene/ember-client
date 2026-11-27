// Roles + permissions on the client: what you're allowed to do, name colours, role icons,
// channel icons, and the Roles part of Server settings.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Megaphone, Lock, Gamepad2, Star, Shield, ScrollText, Plus, Trash2, GripVertical, Upload, X, Check, BadgeCheck, DoorOpen, ExternalLink, Volume2, EyeOff } from 'lucide-react';
const TYPE_ICONS = { logs: ScrollText, roles: BadgeCheck, welcome: DoorOpen, link: ExternalLink, voice: Volume2, game: Gamepad2, starboard: Star };
import { apiFetch, uploadFetch } from '../api.js';
import { useChat, getState, toast, errorText, ask, refreshServer, memberRef } from './store.js';
import { isInst } from './ids.js';
import { imgHint, warnImage } from './imgHints.js';
import { userScrolled } from './userscroll.js';
import { pictureAccept } from './accept.js';
import { CHANNEL_ICONS, useNameStyle, useCan, P, PERM_LIST, has } from './perms.js';

const INST_ONLY_PERMS = new Set(['UNMARKED_ALIASES', 'CHANGE_NICKNAME', 'MANAGE_NICKNAMES', 'CUSTOMIZE_PROFILE']); // Nookara's own servers don't have these

// a channel's icon: its own (a lucide name or a picture), else # / lock / megaphone
export function ChannelIcon({ c, size = 17 }) {
  if (c?.icon && /^https?:\/\//.test(c.icon)) return <img className="vc-ch-img" src={c.icon} alt="" style={{ width: size, height: size }} />;
  const I = CHANNEL_ICONS[c?.icon] || TYPE_ICONS[c?.type] || (c?.locked ? (String(c?.name).includes('announce') ? Megaphone : Lock) : Hash);
  // private channels get a small eye-off mark on their icon
  return c?.private ? <span className="vc-ch-priv" title="Private channel"><I size={size} /><EyeOff size={Math.round(size * 0.55)} /></span> : <I size={size} />;
}

export function NameDecor({ sid, user }) {
  const key = useNameStyle(sid, user);
  const [, icon, iname] = key.split('|');
  return icon ? <img className="vc-role-ico" src={icon} alt="" title={iname} /> : null;
}

// roles as little chips (profile cards), with add / remove for people who can manage roles
export function RoleChips({ sid, username }) {
  const all = useChat(s => s.detail[sid]?.roles);
  const member = useChat(s => s.members[sid]?.find(x => x.username === username));
  const canManage = useCan(sid, P.MANAGE_ROLES);
  const [adding, setAdding] = useState(false);
  if (!sid || !all) return null;
  const mine = all.filter(r => !r.is_default && member?.roles?.includes(r.rid)).sort((a, b) => b.position - a.position);
  const others = all.filter(r => !r.is_default && !member?.roles?.includes(r.rid)).sort((a, b) => b.position - a.position);
  if (!mine.length && !canManage) return null;
  const toggle = async (r, on) => {
    try { await apiFetch(`/chat/servers/${sid}/members/${memberRef(sid, username)}/roles/${r.rid}`, { method: on ? 'PUT' : 'DELETE' }); }
    catch (e) { toast(errorText(e.message)); }
  };
  return (
    <div className="vc-roles">
      <div className="vc-sec-t">Roles</div>
      <div className="vc-role-chips">
        {mine.map(r => (
          <span key={r.rid} className="vc-role-chip" style={{ '--rc': r.color || 'var(--dim)' }}>
            {canManage ? <button type="button" title={`Remove ${r.name}`} onClick={() => toggle(r, false)}><X size={10} /></button> : <i />}
            {r.icon && <img src={r.icon} alt="" />}{r.name}
          </span>
        ))}
        {canManage && others.length > 0 && (
          <span className="vc-role-add-wrap">
            <button type="button" className="vc-role-chip add" onClick={() => setAdding(a => !a)} title="Give a role"><Plus size={12} /></button>
            {adding && <RoleAddMenu roles={others} onPick={r => { setAdding(false); toggle(r, true); }} onClose={() => setAdding(false)} />}
          </span>
        )}
      </div>
    </div>
  );
}

// the "give a role" list - lives on <body> so the profile card can't clip it; opens under the + (or above it
// when there's no room) and stays inside the window. picked: a list you tick several roles in (stays open; Server settings)
export function RoleAddMenu({ roles, onPick, onClose, picked }) {
  const spot = useRef(null);
  const menu = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const b = spot.current?.parentElement?.getBoundingClientRect();
      if (!b) return;
      const h = Math.min(menu.current?.scrollHeight || 260, 260), w = 230, gap = 6;
      const below = innerHeight - b.bottom - gap - 8, above = b.top - gap - 8;
      const up = below < h && above > below;
      setPos({ left: Math.max(8, Math.min(b.left, innerWidth - w - 8)), top: up ? undefined : b.bottom + gap, bottom: up ? innerHeight - b.top + gap : undefined, maxHeight: Math.max(120, Math.min(260, up ? above : below)), up });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [roles.length]);
  useEffect(() => {
    const down = e => { if (!menu.current?.contains(e.target) && !spot.current?.parentElement?.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    const scroll = e => { if (!menu.current?.contains(e.target) && userScrolled()) onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); document.removeEventListener('scroll', scroll, true); };
  }, [onClose]);
  return (
    <>
      <i ref={spot} hidden />
      {createPortal(
        <div ref={menu} className={`vc-menu vc-role-menu${pos?.up ? ' up' : ''}`} style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}>
          {roles.map(r => <button type="button" key={r.rid} role={picked ? 'menuitemcheckbox' : undefined} aria-checked={picked ? picked.includes(r.rid) : undefined} onClick={() => onPick(r)}><i className="vc-role-dot" style={{ background: r.color || 'var(--dim)' }} />{r.icon && <img className="vc-role-ico" src={r.icon} alt="" />}<span className="grow">{r.name}</span>{picked?.includes(r.rid) && <Check size={13} />}</button>)}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Server settings > Roles ──
const COLORS = ['#9d8ad1', '#e06c9f', '#f0c674', '#7fbf8f', '#6fb3e0', '#e08a5a', '#c26a6a', '#b48ead', '#8fbcbb', '#a3be8c', '#ebcb8b', '#e7e7ea'];
export function RolesEditor({ sid }) {
  const d = useChat(s => s.detail[sid]);
  const perms = d?.server.perms || 0;
  const isOwner = d?.server.role === 'owner';
  // "Use unmarked aliases" only while the Danger zone switch is on (an older server that doesn't say: shown, like before)
  const unmarkedOn = d?.server.unmarked_aliases !== false;
  const roles = useMemo(() => [...(d?.roles || [])].sort((a, b) => (a.is_default - b.is_default) || b.position - a.position), [d?.roles]);
  const [sel, setSel] = useState(null);
  const [drag, setDragS] = useState(null);
  const [order, setOrderS] = useState(null); // while dragging
  // refs too: drop / dragend handlers must see the latest values, not the render they were made in
  const dragRef = useRef(null), orderRef = useRef(null);
  const setDrag = v => { dragRef.current = v; setDragS(v); };
  const setOrder = v => { orderRef.current = v; setOrderS(v); };
  const shown = order || roles;
  const r = roles.find(x => x.rid === sel) || roles[0];
  useEffect(() => { if (!sel && roles[0]) setSel(roles[0].rid); }, [roles, sel]);
  // my highest role: I can only change roles below it
  const st = getState();
  const staffHere = d?.server.is_default && ['owner', 'admin', 'mod'].includes(st.me?.rank);
  const meM = st.members[sid]?.find(m => m.username === st.me?.username);
  const myTop = isOwner || staffHere ? Infinity : Math.max(0, ...roles.filter(x => !x.is_default && meM?.roles?.includes(x.rid)).map(x => x.position));
  const canEdit = x => isOwner || x.is_default || x.position < myTop;

  async function create() {
    try { const res = await apiFetch(`/chat/servers/${sid}/roles`, { method: 'POST', body: JSON.stringify({ name: 'new role', color: COLORS[roles.length % COLORS.length] }) }); setSel(res.role.rid); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function save(patch) {
    try { await apiFetch(`/chat/servers/${sid}/roles/${r.rid}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function remove() {
    if (!(await ask({ title: `Delete the ${r.name} role?`, text: 'Everyone who has it loses it.', confirm: 'Delete role', danger: true }))) return;
    try { await apiFetch(`/chat/servers/${sid}/roles/${r.rid}`, { method: 'DELETE' }); setSel(null); } catch (e) { toast(errorText(e.message)); }
  }
  async function icon(file) {
    if (!file) return;
    warnImage(file, 'roleIcon', isInst(sid));
    const fd = new FormData(); fd.append('file', file);
    try { await uploadFetch(`/chat/servers/${sid}/roles/${r.rid}/icon`, fd); } catch (e) { toast(errorText(e.message)); }
  }
  async function dropOn() {
    const cur = orderRef.current;
    if (!dragRef.current) return;
    setDrag(null);
    if (!cur) { setOrder(null); return; }
    const list = cur.filter(x => !x.is_default).map(x => x.rid);
    try { await apiFetch(`/chat/servers/${sid}/roles/order`, { method: 'PUT', body: JSON.stringify({ order: list }) }); }
    catch (e) { toast(errorText(e.message)); setOrder(null); }
  }
  // the server's roles update (with the new order) replaces the dragged copy
  useEffect(() => { if (!dragRef.current) setOrder(null); }, [roles]); // eslint-disable-line react-hooks/exhaustive-deps
  function over(target) {
    const dr = dragRef.current;
    if (!dr || dr === target) return;
    const list = [...(orderRef.current || roles)];
    const from = list.findIndex(x => x.rid === dr), to = list.findIndex(x => x.rid === target);
    if (from < 0 || to < 0 || list[to].is_default) return;
    const [m] = list.splice(from, 1); list.splice(to, 0, m);
    setOrder(list);
  }
  if (!d) return null;
  const editable = r && canEdit(r);
  return (
    <div className="vc-roles-ed">
      <div className="vc-roles-list">
        <button type="button" className="btn btn-primary vc-roles-new" onClick={create}><Plus size={14} /> Create role</button>
        <small className="vc-hint">Drag roles to set their order. Higher roles show first and can manage the ones below them.</small>
        {shown.map(x => (
          <div key={x.rid} className={`vc-roles-row${x.rid === r?.rid ? ' on' : ''}${drag === x.rid ? ' dragging' : ''}`}
            draggable={!x.is_default && canEdit(x)} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.rid); dragRef.current = x.rid; setTimeout(() => setDragS(x.rid), 0); }}
            onDragOver={e => { if (!dragRef.current) return; e.preventDefault(); over(x.rid); }} onDrop={e => { e.preventDefault(); dropOn(); }} onDragEnd={() => dropOn()}
            onClick={() => setSel(x.rid)}>
            {!x.is_default && canEdit(x) ? <GripVertical size={14} className="vc-grip" /> : <span className="vc-grip-sp" />}
            <i className="vc-role-dot" style={{ background: x.color || 'var(--dim)' }} />
            {x.icon && <img src={x.icon} alt="" className="vc-role-ico" />}
            <span>{x.name}</span>
            {!canEdit(x) && <Lock size={12} className="vc-roles-lock" title="Above your highest role" />}
          </div>
        ))}
      </div>
      {r && (
        <div className="vc-roles-pane" key={r.rid}>
          {r.is_default
            ? <p className="vc-dialog-sub">@everyone is every member of the server. What it allows, everyone can do.</p>
            : (
              <>
                <label className="vc-field"><span>Role name</span>
                  <input className="form-input" defaultValue={r.name} maxLength={40} disabled={!editable} onBlur={e => e.target.value.trim() && e.target.value !== r.name && save({ name: e.target.value })} /></label>
                <div className="vc-field"><span>Colour</span>
                  <div className="vc-colors">
                    <button type="button" className={`vc-color none${!r.color ? ' on' : ''}`} disabled={!editable} onClick={() => save({ color: null })} title="No colour" />
                    {COLORS.map(c => <button type="button" key={c} className={`vc-color${r.color === c ? ' on' : ''}`} style={{ background: c }} disabled={!editable} onClick={() => save({ color: c })} />)}
                    <label className="vc-color custom" title="Pick any colour" style={{ background: r.color || '#2a2a30' }}>
                      <input type="color" disabled={!editable} value={r.color || '#9d8ad1'} onChange={e => save({ color: e.target.value })} />
                    </label>
                  </div></div>
                <div className="vc-field"><span>Role icon</span>
                  <div className="vc-img-row">
                    <span className="vc-role-ico-prev">{r.icon ? <img src={r.icon} alt="" /> : <Shield size={16} />}</span>
                    <label className={`btn btn-surface${editable ? '' : ' disabled'}`}><Upload size={14} /> Upload<input type="file" hidden accept={pictureAccept('image/*')} disabled={!editable} onChange={e => icon(e.target.files[0])} /></label>
                    {r.icon && editable && <button type="button" className="btn btn-surface" onClick={() => apiFetch(`/chat/servers/${sid}/roles/${r.rid}/icon`, { method: 'DELETE' }).catch(e => toast(errorText(e.message)))}>Remove</button>}
                  </div><small className="vc-hint">Shows next to the names of people with this role. {imgHint('roleIcon', isInst(sid))}</small></div>
                <Toggle label="Show separately in the member list" hint="People with this role get their own group." on={r.hoist} disabled={!editable} onChange={v => save({ hoist: v })} />
                <Toggle label="Anyone can @mention this role" hint="Otherwise only people with Mention @everyone can." on={r.mentionable} disabled={!editable} onChange={v => save({ mentionable: v })} />
                {isInst(sid) && <RoleUploadField key={r.rid} sid={sid} role={r} editable={editable} save={save} />}

              </>
            )}
          <div className="vc-sec-t" style={{ marginTop: 16 }}>Permissions</div>
          {PERM_LIST.filter(([k]) => (isInst(sid) || !INST_ONLY_PERMS.has(k)) && (k !== 'UNMARKED_ALIASES' || unmarkedOn)).map(([k, label, hint, instHint]) => (
            <Toggle key={k} label={label} hint={isInst(sid) && instHint ? instHint : hint} on={has(r.permissions, P[k])}
              disabled={!editable || (!has(perms, P[k]) && !isOwner)}
              onChange={v => save({ permissions: v ? (r.permissions | P[k]) : (r.permissions & ~P[k]) })} />
          ))}
          {!r.is_default && editable && <div className="vc-dialog-btns"><button type="button" className="btn btn-danger" onClick={remove}><Trash2 size={14} /> Delete role</button></div>}
        </div>
      )}
    </div>
  );
}
export function Toggle({ label, hint, on, onChange, disabled }) {
  return (
    <div className={`vc-toggle-row slim${disabled ? ' off' : ''}`}>
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={!!on} disabled={disabled} className={`cs-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}
export { Check };

// an Ember server's roles can raise the largest file their people may upload (blank = the server's default; the server's
// plan / ceiling still caps it). People get the biggest of their roles' numbers.
function RoleUploadField({ sid, role, editable, save }) {
  const def = useChat(s => s.detail[sid]?.server?.upload_max_mb);
  const [v, setV] = useState(role.upload_max_mb == null ? '' : String(role.upload_max_mb));
  const commit = () => {
    const t = v.trim();
    if (!t) { if (role.upload_max_mb != null) save({ upload_max_mb: null }); return; }
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 500) { toast('Pick a size between 1 and 500 MB, or leave it empty.'); setV(role.upload_max_mb == null ? '' : String(role.upload_max_mb)); return; }
    if (n !== role.upload_max_mb) save({ upload_max_mb: n });
  };
  return (
    <label className="vc-field vc-gap-top"><span>Largest file upload (MB)</span>
      <input className="form-input vc-narrow" type="number" min={1} max={500} disabled={!editable} placeholder={def ? `Server default (${def})` : 'Server default'} value={v}
        onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
      <small className="vc-hint">Per file. Empty = the server's default. People with several roles get the biggest number; the server's plan can still cap it.</small></label>
  );
}
