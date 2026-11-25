// Settings > Profile, with a server that has its own accounts picked in the dropdown: your account's profile there (ember-server
// PROTOCOL 4.1). Picture, banner, display name, pronouns, name color and bio are saved on that server, not on Nookara. Signed in to
// Nookara as well, you can copy your Nookara profile over once, or keep the two in sync (accountProfile.js does the copying; while
// it is in sync the fields here are locked, because the next sync would overwrite them).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, RefreshCw, Lock } from 'lucide-react';
import ImageCropper from '../components/ImageCropper.jsx';
import { useChat, lookup, ask, toast, errorText, loadMembers } from './store.js';
import { PopoutCard } from './ProfilePopout.jsx';
import { pictureAccept } from './accept.js';
import { cropToBlob } from './ServerProfileEditor.jsx';
import { getAccountProfile, saveAccountProfile, setAccountPicture, copyFromNookara, syncAccountProfile } from './accountProfile.js';
import { follows } from './accountProfileCore.js';

const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
const ERRORS = {
  local_accounts_only: "That server signs people in with Nookara, so your Nookara profile is the one that shows there.", invalid_color: 'Colors look like #9d8ad1.',
  bio_too_long: 'Bios here are at most 300 characters.', pronouns_too_long: 'Pronouns are at most 40 characters.', display_name_too_long: 'Display names here are at most 32 characters.',
  invalid_display_name: "That display name can't be used here.", images_only: 'Pick a PNG, JPG, GIF or WebP picture.', file_too_large: 'Pictures here can be up to 4 MB.',
  signed_out: 'Sign in with Nookara first.', instance_unreachable: "That server can't be reached right now.", instance_not_connected: "You're not connected to that server right now.",
};
const say = e => ERRORS[e.message] || errorText(e.message);
const skippedText = list => (list?.length ? ` Your ${list.map(k => (k === 'pfp' ? 'avatar' : 'banner')).join(' and ')} couldn't be copied (pictures here can be up to 4 MB).` : '');

export default function AccountProfileEditor({ origin, onDirty }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const srv = useChat(s => s.servers.find(x => x.inst === origin));
  const srvName = srv?.name || inst?.name || 'this server';
  const me = useChat(s => s.me);
  const signedIn = useChat(s => s.signedIn);
  const [nk, setNk] = useState(null); // my Nookara profile (signed in): whose profile a sync follows, and what a copy would bring
  const [d, setD] = useState(null); // { profile, sync, user }
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
    const p = r.profile || {};
    const v = { name: p.display_name || '', pronouns: p.pronouns || '', bio: p.bio || '', color: p.color || '' };
    setF(v); setBase(v);
    if (srv?.sid) loadMembers(srv.sid);
  };
  useEffect(() => {
    let live = true;
    setD(null); setErr('');
    getAccountProfile(origin).then(r => { if (!live) return; take(r); if (r.sync) syncAccountProfile(origin); }) // (following Nookara: anything new comes over now)
      .catch(e => live && setErr(e.message === 'not_found' ? `${srvName} needs an update before accounts there can have a profile.` : say(e)));
    // a sync that ran while this is open (Nookara said my profile changed): show the new copy
    const synced = e => { if (e.detail?.origin === origin) getAccountProfile(origin).then(r => live && take(r)).catch(() => {}); };
    addEventListener('vc-account-profile-synced', synced);
    return () => { live = false; removeEventListener('vc-account-profile-synced', synced); };
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (signedIn && me?.username) lookup(me.username).then(g => live && setNk(g)).catch(() => {});
    else setNk(null);
    return () => { live = false; };
  }, [signedIn, me?.username]);

  async function run(what, fn) {
    setBusy(what);
    try { await fn(); } catch (e) { toast(say(e)); }
    setBusy('');
  }
  const save = () => {
    if (f.color.trim() && !isHex(f.color.trim())) { toast(ERRORS.invalid_color); return; }
    run('save', async () => {
      take(await saveAccountProfile(origin, { display_name: f.name.trim() || null, pronouns: f.pronouns.trim() || null, bio: f.bio.trim() || null, color: f.color.trim() || null }));
      toast(`Saved your profile on ${srvName}.`, true);
    });
  };
  const picture = (kind, file, crop) => {
    setCropping(null);
    run(kind, async () => {
      const r = await setAccountPicture(origin, kind, file ? await cropToBlob(file, crop, kind === 'banner' ? 1500 : 512) : null);
      setD(x => ({ ...x, ...r })); // (the text fields keep what is being typed)
      if (srv?.sid) loadMembers(srv.sid);
    });
  };
  const pick = kind => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = pictureAccept('image/png,image/jpeg,image/gif,image/webp');
    inp.onchange = () => { const file = inp.files?.[0]; if (file) setCropping({ kind, file }); };
    inp.click();
  };
  async function copyOnce() {
    if (!(await ask({ title: 'Copy your Nookara profile here?', text: `Your picture, banner, display name, pronouns, color and bio on ${srvName} are replaced by the ones on your Nookara profile. It's a copy: you can change it here afterwards, and later changes on Nookara don't come over.`, confirm: 'Copy profile' }))) return;
    run('copy', async () => { const r = await copyFromNookara(origin); take(r); toast(`Copied your Nookara profile to ${srvName}.${skippedText(r.skipped)}`, !r.skipped.length); });
  }
  async function setSync(on) {
    if (on && !(await ask({ title: 'Keep in sync with your Nookara profile?', text: `Your profile on ${srvName} is replaced by your Nookara profile now, and follows it from then on: when you change your Nookara profile, Ember updates this one. You can't edit it here while that's on.`, confirm: 'Keep in sync' }))) return;
    run('sync', async () => {
      if (on) { const r = await copyFromNookara(origin, { sync: true }); take(r); toast(`Your profile on ${srvName} now follows your Nookara profile.${skippedText(r.skipped)}`, !r.skipped.length); }
      else { take(await saveAccountProfile(origin, { sync: null })); toast(`Your profile on ${srvName} no longer follows your Nookara profile. You can edit it here.`, true); }
    });
  }

  if (err) return <div className="inline-msg error">{err}</div>;
  if (!d) return <div className="vc-loading"><i /><i /><i /></div>;
  const p = d.profile || {};
  const synced = !!d.sync; // locked whoever it follows
  const mine = follows(d.sync, nk?.id); // it follows the Nookara account signed in here
  const card = {
    username: d.user?.username || inst?.user?.username || '', display_name: f.name.trim(), pfp: p.pfp || null, banner: p.banner || null,
    color: (isHex(f.color.trim()) && f.color.trim()) || null, bio: f.bio.trim(), pronouns: f.pronouns.trim(), badges: [],
  };
  return (
    <div className="bf-pe">
      <div className="bf-pe-intro">
        <h3>Your profile on {srvName}</h3>
        <p>{srvName} has its own accounts, so this profile is saved on that server ({inst?.host || origin}) and only shows there.</p>
      </div>
      {(signedIn || synced) && (
        <div className="bf-pe-nk">
          {signedIn && (!synced || mine) && (
            <div className="vc-toggle-row">
              <span><b><RefreshCw size={13} className="vc-inline-ico" /> Keep in sync with my Nookara profile</b>
                <small>{mine ? `On: changes to your Nookara profile${me?.username ? ` (@${me.username})` : ''} come over whenever Ember is connected to ${srvName}.` : 'Off: this profile is its own. Turn it on to use your Nookara profile here and have it follow your changes.'}</small></span>
              <button type="button" role="switch" aria-label="Keep in sync with my Nookara profile" aria-checked={mine} disabled={!!busy} className={`cs-switch${mine ? ' on' : ''}`} onClick={() => setSync(!mine)}><i /></button>
            </div>
          )}
          {synced && !mine && (
            <div className="bf-pe-lock" role="status">
              <Lock size={18} />
              <span>{signedIn ? "This profile follows a Nookara profile, but not the one you're signed in with here." : 'This profile follows your Nookara profile. Sign in with Nookara to update it from there.'} Stop following to edit it here.</span>
              <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => setSync(false)}>Stop following</button>
            </div>
          )}
          {signedIn && !synced && (
            <div className="bf-pe-row">
              <button type="button" className="btn btn-surface btn-sm" disabled={!!busy || dirty} onClick={copyOnce}><Copy size={13} /> {busy === 'copy' ? 'Copying...' : 'Copy my Nookara profile here'}</button>
              <span className="bf-pe-hint">A one-time copy. You can change it here afterwards.</span>
            </div>
          )}
          {busy === 'sync' && <div className="bf-pe-hint">Bringing your Nookara profile over...</div>}
        </div>
      )}
      <div className="bf-pe-cols">
        <fieldset className={`bf-pe-form${synced ? ' locked' : ''}`} disabled={synced || !!busy}>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Avatar</div>
            <div className="bf-pe-row">
              <button type="button" className="btn btn-surface btn-sm" onClick={() => pick('pfp')}>{busy === 'pfp' ? 'Uploading...' : 'Change avatar'}</button>
              {p.pfp && <button type="button" className="btn btn-surface btn-sm" onClick={() => picture('pfp', null)}>Remove avatar</button>}
            </div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Banner</div>
            <div className="bf-pe-row">
              <button type="button" className="btn btn-surface btn-sm" onClick={() => pick('banner')}>{busy === 'banner' ? 'Uploading...' : 'Change banner'}</button>
              {p.banner && <button type="button" className="btn btn-surface btn-sm" onClick={() => picture('banner', null)}>Remove banner</button>}
            </div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Display name</div>
            <input className="form-input" type="text" maxLength={32} placeholder={card.username} value={f.name} onChange={e => set('name', e.target.value)} />
            <div className="bf-pe-hint">People still mention you as @{card.username}.</div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Pronouns</div>
            <input className="form-input" type="text" maxLength={40} placeholder="they/them" value={f.pronouns} onChange={e => set('pronouns', e.target.value)} />
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Name color</div>
            <div className="bf-pe-row">
              <input type="color" value={isHex(f.color.trim()) ? f.color.trim() : '#9d8ad1'} onChange={e => set('color', e.target.value)} aria-label="Pick a color" />
              <input className="form-input" type="text" maxLength={7} placeholder="#9d8ad1" value={f.color} onChange={e => set('color', e.target.value)} />
              {f.color && <button type="button" className="btn btn-surface btn-sm" onClick={() => set('color', '')}>No color</button>}
            </div>
          </div>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">About me <small>{f.bio.length}/300</small></div>
            <textarea className="form-input" rows={4} maxLength={300} placeholder="A little about you" value={f.bio} onChange={e => set('bio', e.target.value)} />
          </div>
        </fieldset>
        <aside className="bf-pe-preview">
          <div className="bf-pe-preview-label">Preview on {srvName}</div>
          <PopoutCard preview p={card} status="online" />
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
