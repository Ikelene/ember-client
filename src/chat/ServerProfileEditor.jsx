// Settings > Profile, with an Ember server picked in the dropdown: your look on that server only (ember-server PROTOCOL §6.7). The same
// layout as the global editor (fields left, live card right); empty fields fall back to your global profile. Saved on that server, not
// on Nookara. Needs the server's "Customize profile in this server" permission; going back to your global profile never does.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, ShieldAlert } from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import ImageCropper from '../components/ImageCropper.jsx';
import { useChat, lookup, ask, toast, errorText, loadMembers } from './store.js';
import { PopoutCard } from './ProfilePopout.jsx';
import { pictureAccept } from './accept.js';

const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
const ERRORS = { not_allowed: "This server doesn't let you customize your profile there.", invalid_color: 'Colors look like #9d8ad1.', bio_too_long: 'Bios here are at most 300 characters.', pronouns_too_long: 'Pronouns are at most 40 characters.', invalid_nick: 'That name can’t be used here.', images_only: 'Pick a PNG, JPG, GIF or WebP picture.', file_too_large: 'Pictures here can be up to 4 MB.' };
const say = e => ERRORS[e.message] || errorText(e.message);

// the cropped part of a picture as a PNG (the server keeps what it's given)
function cropToBlob(file, crop, max) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const c = crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        const k = Math.min(1, max / Math.max(c.w, c.h));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(c.w * k)); cv.height = Math.max(1, Math.round(c.h * k));
        cv.getContext('2d').drawImage(img, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(src);
        cv.toBlob(b => (b ? resolve(b) : reject(new Error('bad_image'))), 'image/png');
      } catch (e) { URL.revokeObjectURL(src); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('images_only')); };
    img.src = src;
  });
}

export default function ServerProfileEditor({ sid, onDirty }) {
  const srvName = useChat(s => s.detail[sid]?.server?.name || s.servers.find(x => x.sid === sid)?.name || 'this server');
  const me = useChat(s => s.me);
  const presence = useChat(s => s.presence[s.me?.username]);
  const [global, setGlobal] = useState(null); // your Nookara profile: what shows wherever this server's doesn't say otherwise
  const [d, setD] = useState(null); // { profile, nick, can_customize }
  const [err, setErr] = useState('');
  const empty = { name: '', pronouns: '', bio: '', color: '' };
  const [f, setF] = useState(empty), [base, setBase] = useState(empty);
  const [busy, setBusy] = useState('');
  const [cropping, setCropping] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const dirty = Object.keys(f).some(k => f[k].trim() !== base[k]);
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const take = r => {
    setD(r);
    const v = { name: r.nick || '', pronouns: r.profile?.pronouns || '', bio: r.profile?.bio || '', color: r.profile?.color || '' };
    setF(v); setBase(v);
  };
  useEffect(() => {
    let live = true;
    setD(null); setErr('');
    apiFetch(`/chat/servers/${sid}/members/@me/profile`).then(r => live && take(r)).catch(e => live && setErr(e.message === 'not_found' ? `${srvName} needs an update before it can have server profiles.` : say(e)));
    if (me?.username) lookup(me.username).then(g => live && setGlobal(g)).catch(() => {});
    return () => { live = false; };
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (f.color.trim() && !isHex(f.color.trim())) { toast(ERRORS.invalid_color); return; }
    setBusy('save');
    try {
      const r = await apiFetch(`/chat/servers/${sid}/members/@me/profile`, { method: 'PATCH', body: JSON.stringify({ display_name: f.name.trim() || null, pronouns: f.pronouns.trim() || null, bio: f.bio.trim() || null, color: f.color.trim() || null }) });
      take({ ...d, ...r }); loadMembers(sid); toast(`Saved your profile on ${srvName}.`, true);
    } catch (e) { toast(say(e)); }
    setBusy('');
  }
  async function picture(kind, file, crop) {
    setCropping(null); setBusy(kind);
    try {
      let r;
      if (file) {
        const fd = new FormData();
        fd.append('file', await cropToBlob(file, crop, kind === 'banner' ? 1500 : 512), `${kind}.png`);
        r = await uploadFetch(`/chat/servers/${sid}/members/@me/profile/${kind}`, fd);
      } else r = await apiFetch(`/chat/servers/${sid}/members/@me/profile/${kind}`, { method: 'DELETE' });
      setD(x => ({ ...x, profile: r.profile })); loadMembers(sid);
    } catch (e) { toast(say(e)); }
    setBusy('');
  }
  async function backToGlobal() {
    if (!(await ask({ title: 'Use your global profile here?', text: `Your picture, banner, name, color, bio and pronouns on ${srvName} go back to your Nookara profile.`, confirm: 'Use global profile' }))) return;
    setBusy('reset');
    try { const r = await apiFetch(`/chat/servers/${sid}/members/@me/profile`, { method: 'DELETE' }); take({ ...d, ...r }); loadMembers(sid); }
    catch (e) { toast(say(e)); }
    setBusy('');
  }
  const pick = kind => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = pictureAccept('image/png,image/jpeg,image/gif,image/webp');
    inp.onchange = () => { const file = inp.files?.[0]; if (file) setCropping({ kind, file }); };
    inp.click();
  };

  if (err) return <div className="inline-msg error">{err}</div>;
  if (!d) return <div className="vc-loading"><i /><i /><i /></div>;
  const sp = d.profile || {};
  const card = {
    username: me?.username, display_name: f.name.trim() || global?.display_name || me?.display_name || '',
    pfp: sp.pfp || global?.pfp_url || me?.pfp || null, banner: sp.banner || global?.banner_url || null,
    color: (isHex(f.color.trim()) && f.color.trim()) || global?.color || me?.color || null,
    bio: f.bio.trim() || global?.bio || '', pronouns: f.pronouns.trim() || global?.pronouns || '', badges: global?.badges || [], rank: me?.rank,
  };
  const can = d.can_customize;
  const hasAny = !!(d.nick || d.profile);
  return (
    <div className="bf-pe">
      <div className="bf-pe-intro">
        <h3>Your profile on {srvName}</h3>
        <p>Only shows on {srvName}. Anything left empty uses your global profile.</p>
      </div>
      {!can && (
        <div className="bf-pe-lock" role="status">
          <ShieldAlert size={18} />
          <span>{srvName} doesn't let you customize your profile there. Its admins can turn on "Customize profile in this server" for one of your roles.</span>
        </div>
      )}
      <div className="bf-pe-cols">
        <fieldset className={`bf-pe-form${can ? '' : ' locked'}`} disabled={!can || !!busy}>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Avatar</div>
            <div className="bf-pe-row">
              <button type="button" className="btn btn-surface btn-sm" onClick={() => pick('pfp')}>{busy === 'pfp' ? 'Uploading...' : 'Change avatar'}</button>
              {sp.pfp && <button type="button" className="btn btn-surface btn-sm" onClick={() => picture('pfp', null)}>Use global avatar</button>}
            </div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Banner</div>
            <div className="bf-pe-row">
              <button type="button" className="btn btn-surface btn-sm" onClick={() => pick('banner')}>{busy === 'banner' ? 'Uploading...' : 'Change banner'}</button>
              {sp.banner && <button type="button" className="btn btn-surface btn-sm" onClick={() => picture('banner', null)}>Use global banner</button>}
            </div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Name on this server</div>
            <input className="form-input" type="text" maxLength={32} placeholder={global?.display_name || me?.display_name || me?.username || ''} value={f.name} onChange={e => set('name', e.target.value)} />
            <div className="bf-pe-hint">Your nickname here. People still mention you as @{me?.username}.</div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Pronouns</div>
            <input className="form-input" type="text" maxLength={40} placeholder={global?.pronouns || 'they/them'} value={f.pronouns} onChange={e => set('pronouns', e.target.value)} />
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Name color</div>
            <div className="bf-pe-row">
              <input type="color" value={isHex(f.color.trim()) ? f.color.trim() : (global?.color && isHex(global.color) ? global.color : '#9d8ad1')} onChange={e => set('color', e.target.value)} aria-label="Pick a color" />
              <input className="form-input" type="text" maxLength={7} placeholder={global?.color || '#9d8ad1'} value={f.color} onChange={e => set('color', e.target.value)} />
              {f.color && <button type="button" className="btn btn-surface btn-sm" onClick={() => set('color', '')}>Use global</button>}
            </div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">About me <small>{f.bio.length}/300</small></div>
            <textarea className="form-input" rows={4} maxLength={300} placeholder={global?.bio || 'A little about you, on this server'} value={f.bio} onChange={e => set('bio', e.target.value)} />
          </div>
        </fieldset>
        <aside className="bf-pe-preview">
          <div className="bf-pe-preview-label">Preview on {srvName}</div>
          <PopoutCard preview p={card} status={presence?.status || 'online'} custom={presence?.custom} />
          {hasAny && <button type="button" className="btn btn-surface btn-sm bf-pe-global" disabled={!!busy} onClick={backToGlobal}><RotateCcw size={14} /> Use my global profile here</button>}
        </aside>
      </div>
      <div className={`bf-pe-bar${dirty ? ' on' : ''}`} role="status" aria-hidden={!dirty}>
        <span className="bf-pe-bar-text">Careful - you have unsaved changes!</span>
        {dirty && <button type="button" className="bf-pe-bar-reset" onClick={() => setF(base)} disabled={!!busy}>Reset</button>}
        {dirty && <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving...' : 'Save changes'}</button>}
      </div>
      {cropping && createPortal(
        <div className="bf-pe-crop">
          <ImageCropper file={cropping.file} aspect={cropping.kind === 'banner' ? 3 : 1} round={cropping.kind === 'pfp'}
            title={cropping.kind === 'banner' ? `Crop your banner for ${srvName}` : `Crop your avatar for ${srvName}`}
            onCancel={() => setCropping(null)} onDone={crop => picture(cropping.kind, cropping.file, crop)} />
        </div>,
        document.body,
      )}
    </div>
  );
}

// the "which profile" dropdown at the top of Settings > Profile: your global one, or an Ember server that has server profiles
export function useProfileTargets() {
  const servers = useChat(s => s.servers);
  const instances = useChat(s => s.instances);
  return servers.filter(x => x.inst && instances.find(i => i.origin === x.inst)?.features?.server_profiles).map(x => ({ sid: x.sid, name: x.name }));
}
export const askLeave = () => ask({ title: 'Leave without saving?', text: 'Your changes to this profile will be lost.', confirm: 'Leave', danger: true });
