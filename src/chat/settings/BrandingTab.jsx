// Settings > Homeservers > Manage > Branding (admins, PROTOCOL §5e): how the homeserver's own pages look (sign-in, account,
// invites, landing). Never this app: the preview on the right is the homeserver's sign-in (or message) page with the changes
// not saved yet, rendered by the homeserver itself.
import { useEffect, useRef, useState } from 'react';
import { Palette, Image as ImageIcon, Type, Code2, RotateCcw, Upload, Eye, TriangleAlert, Trash2, RefreshCw } from 'lucide-react';
import { SCard } from './ui.jsx';
import { ask, toast } from '../store.js';
import { hsCall, hsUpload } from '../homeApi.js';
import { adminErrorText } from '../homeAdmin.js';
import { UnsavedBar } from '../unsaved.jsx';
import { useUnsaved } from '../useUnsaved.js';
import {
  COLOR_KEYS, IMAGE_KINDS, FONTS, SCHEMES, DENSITIES, BANNER_POS, HEADERS, NUMBERS, DEFAULT_LIMITS,
  getPath, setPath, brandingPatch, changedCount, byteLength, isHex, brandingErrorText,
} from './branding.js';

const BRANDING = '/api/v2/homeserver/branding';

export function BrandingTab({ hs, onDirty }) {
  const { origin } = hs;
  const [saved, setSaved] = useState(null);   // GET -> branding (what is saved)
  const [info, setInfo] = useState(null);     // { homeserver, fonts, limits }
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null); // { field, text }
  const [busy, setBusy] = useState('');       // '' | 'save' | 'reset' | an upload kind
  const [page, setPage] = useState('login');
  const [preview, setPreview] = useState(null); // { url } | { error }
  const load = () => {
    setError('');
    hsCall(origin, BRANDING).then(d => { setSaved(d.branding || {}); setDraft(d.branding || {}); setInfo(d); }, e => setError(e.status === 404 ? 'old' : adminErrorText(e)));
  };
  useEffect(load, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = saved && draft ? brandingPatch(saved, draft) : {};
  const changed = saved && draft ? changedCount(saved, draft) > 0 : false;
  const [bar, flashSaved] = useUnsaved(changed, onDirty);

  // the live preview: asked again a moment after the last change (or the page switch)
  const seq = useRef(0);
  const patchKey = JSON.stringify(patch);
  useEffect(() => {
    if (!saved) return undefined;
    const n = ++seq.current;
    const t = setTimeout(() => {
      hsCall(origin, `${BRANDING}/preview`, { method: 'POST', body: { branding: patch, page } })
        .then(d => { if (n === seq.current) { setPreview({ url: d.url }); setFieldError(null); } },
          e => { if (n === seq.current) { setPreview({ error: e.field ? brandingErrorText(e.field, e.reason) : adminErrorText(e) }); if (e.field) setFieldError({ field: e.field, text: brandingErrorText(e.field, e.reason) }); } });
    }, 700);
    return () => clearTimeout(t);
  }, [patchKey, page, !!saved]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return <SCard>{error === 'old'
      ? <div className="sx-empty"><TriangleAlert size={28} /><b>This homeserver doesn't have branding yet</b><span>Its software is older than this page. Update it, then look again.</span></div>
      : <div className="sx-empty"><TriangleAlert size={28} /><b>Couldn't load the branding</b><span>{error}</span><button type="button" className="btn btn-surface btn-sm" onClick={load}><RefreshCw size={13} /> Try again</button></div>}</SCard>;
  }
  if (!saved || !draft) return <div className="vc-loading"><i /><i /><i /></div>;
  const limits = { ...DEFAULT_LIMITS, ...(info?.limits || {}) };
  const resolved = info?.homeserver || {};
  const v = p => getPath(draft, p);
  const set = (p, val) => { setFieldError(f => (f?.field === p ? null : f)); setDraft(d => setPath(d, p, val)); };
  const isSet = p => { const x = v(p); return x !== undefined && x !== null && x !== ''; };
  const errFor = p => (fieldError && (fieldError.field === p || fieldError.field.startsWith(`${p}.`)) ? fieldError.text : '');
  const reset = p => (isSet(p) ? <button type="button" className="vc-ico-btn hsb-reset" aria-label="Back to the default" data-tip="Back to the default" onClick={() => set(p, null)}><RotateCcw size={13} /></button> : null);
  const cssBytes = byteLength(v('custom_css'));

  async function save() {
    setBusy('save'); setFieldError(null);
    try {
      const d = await hsCall(origin, BRANDING, { method: 'PATCH', body: patch });
      setSaved(d.branding || {}); setDraft(d.branding || {}); setInfo(d);
      flashSaved();
    } catch (e) {
      if (e.error === 'invalid_branding' && e.field) { const text = brandingErrorText(e.field, e.reason); setFieldError({ field: e.field, text }); toast(text); }
      else toast(adminErrorText(e));
    }
    setBusy('');
  }
  async function resetAll() {
    if (!(await ask({ title: 'Reset all branding?', text: `${hs.domain}'s pages go back to the default look: name, pictures, colours, fonts and custom CSS. Uploaded files stay on the homeserver.`, confirm: 'Reset everything', danger: true }))) return;
    setBusy('reset');
    try { const d = await hsCall(origin, BRANDING, { method: 'DELETE' }); setSaved(d.branding || {}); setDraft(d.branding || {}); setInfo(d); toast('Branding reset.', true); }
    catch (e) { toast(adminErrorText(e)); }
    setBusy('');
  }
  async function upload(kind, path, file) {
    if (!file) return;
    setBusy(kind);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await hsUpload(origin, `${BRANDING}/upload?kind=${kind}`, fd);
      set(path, r.url);
      if (kind === 'font') set('theme.font', 'custom');
    } catch (e) { toast(e.error === 'unsupported_type' ? (kind === 'font' ? 'Use a woff2, woff, ttf or otf font (up to 2 MB).' : 'Use a PNG, JPEG, GIF or WebP picture (up to 5 MB).') : e.error === 'file_too_large' || e.status === 413 ? 'That file is too big.' : adminErrorText(e)); }
    setBusy('');
  }
  const select = (p, options, def) => (
    <select className="form-input hsb-select" value={v(p) ?? ''} onChange={e => set(p, e.target.value || null)}>
      <option value="">Default{def ? ` (${def})` : ''}</option>
      {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  );
  const color = (p, label, fallback, key = p) => {
    const val = v(p);
    return (
      <label key={key} className={`hsb-color${errFor(p) ? ' bad' : ''}`}>
        <input type="color" value={isHex(val) ? val : isHex(fallback) ? fallback : '#888888'} onChange={e => set(p, e.target.value)} aria-label={label} />
        <span><b>{label}</b><small>{isHex(val) ? val : 'Default'}</small></span>
        {reset(p)}
      </label>
    );
  };

  return (
    <div className="hsb">
      <div className="hsb-form">
        <SCard title="Name and pictures" sub={`Shown on ${hs.domain}'s sign-in, account and invite pages. This app keeps its own look.`}>
          <label className="vc-field hsx-block"><span>Name</span>
            <div className="hsb-row"><input className="form-input" maxLength={limits.name} placeholder={resolved.name || hs.name || hs.domain} value={v('name') || ''} onChange={e => set('name', e.target.value)} />{reset('name')}</div>
            {errFor('name') ? <small className="hsx-issue">{errFor('name')}</small> : <small className="vc-hint">Up to {limits.name} characters. Empty: the homeserver's own name.</small>}</label>
          <div className="hsb-images">
            {IMAGE_KINDS.map(([kind, path, label]) => (
              <div className={`hsb-image${errFor(path) ? ' bad' : ''}`} key={kind}>
                <div className={`hsb-thumb ${kind}`}>{v(path) ? <img src={v(path)} alt="" /> : <ImageIcon size={20} />}</div>
                <b>{label}</b>
                <div className="hsb-row">
                  <label className="btn btn-surface btn-sm"><Upload size={13} /> {busy === kind ? 'Uploading...' : v(path) ? 'Change' : 'Upload'}<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" disabled={!!busy} onChange={e => { upload(kind, path, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  {v(path) && <button type="button" className="vc-ico-btn danger" aria-label={`Remove the ${label.toLowerCase()}`} data-tip="Remove" onClick={() => set(path, null)}><Trash2 size={14} /></button>}
                </div>
                {errFor(path) && <small className="hsx-issue">{errFor(path)}</small>}
              </div>
            ))}
          </div>
          <div className="hsb-two">
            <label className="vc-field"><span>Header</span>{select('theme.header', HEADERS, 'icon and name')}</label>
            <label className="vc-field"><span>Banner position</span>{select('theme.banner_position', BANNER_POS, 'middle')}</label>
          </div>
        </SCard>

        <SCard title="Colours" sub="Text has to stay readable: the homeserver refuses colours that don't stand out enough (it says which).">
          <div className="hsb-two">
            <label className="vc-field"><span>Light or dark</span>{select('theme.scheme', SCHEMES, 'follow the device')}</label>
            {color('accent', 'Accent (both)', resolved.accent)}
          </div>
          {errFor('accent') && <small className="hsx-issue">{errFor('accent')}</small>}
          {['dark', 'light'].map(s => (
            <div className="hsb-scheme" key={s}>
              <b className="hsb-scheme-name">{s === 'dark' ? 'Dark' : 'Light'}</b>
              <div className="hsb-colors">{COLOR_KEYS.map(([k, label]) => color(`theme.${s}.${k}`, label, resolved.theme?.colors?.[s]?.[k], k))}</div>
              {errFor(`theme.${s}`) && <small className="hsx-issue"><TriangleAlert size={12} /> {errFor(`theme.${s}`)}</small>}
            </div>
          ))}
        </SCard>

        <SCard title="Text and layout">
          <div className="hsb-two">
            <label className="vc-field"><span><Type size={13} className="vc-inline-ico" /> Font</span>{select('theme.font', FONTS, 'system')}</label>
            <label className="vc-field"><span>Spacing</span>{select('theme.density', DENSITIES, 'normal')}</label>
          </div>
          {(v('theme.font') === 'custom' || v('theme.font_url')) && (
            <div className="hsb-row hsx-block">
              <label className="btn btn-surface btn-sm"><Upload size={13} /> {busy === 'font' ? 'Uploading...' : v('theme.font_url') ? 'Change font file' : 'Upload a font'}<input type="file" hidden accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" disabled={!!busy} onChange={e => { upload('font', 'theme.font_url', e.target.files?.[0]); e.target.value = ''; }} /></label>
              <small className={errFor('theme.font_url') ? 'hsx-issue' : 'vc-hint'}>{errFor('theme.font_url') || (v('theme.font_url') ? 'Font uploaded.' : 'woff2, woff, ttf or otf, up to 2 MB.')}</small>
              {reset('theme.font_url')}
            </div>
          )}
          <div className="hsb-nums">
            {NUMBERS.map(([p, label, key, unit]) => {
              const [min, max] = limits[key] || DEFAULT_LIMITS[key];
              const val = v(p);
              return (
                <label key={p} className={`vc-field hsb-num${errFor(p) ? ' bad' : ''}`}><span>{label} <small>{isSet(p) ? `${val} ${unit}` : 'default'}</small></span>
                  <div className="hsb-row"><input type="range" min={min} max={max} value={isSet(p) ? val : getPath(resolved, p) ?? min} onChange={e => set(p, Number(e.target.value))} />{reset(p)}</div>
                  {errFor(p) && <small className="hsx-issue">{errFor(p)}</small>}</label>
              );
            })}
          </div>
        </SCard>

        <SCard title="Custom CSS" sub={`Your own CSS on ${hs.domain}'s pages, after the theme. It can change or hide anything there, so check the preview. No @import, scripts or outside fonts; url() only to https, this homeserver, or data: pictures.`}
          action={isSet('custom_css') ? <button type="button" className="btn btn-surface btn-sm" onClick={() => set('custom_css', null)}><RotateCcw size={13} /> Clear</button> : null}>
          <textarea className={`form-textarea vc-mono hsb-css${errFor('custom_css') ? ' bad' : ''}`} rows={10} spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder={'.card { box-shadow: none; }'} value={v('custom_css') || ''} onChange={e => set('custom_css', e.target.value)} />
          <div className="hsb-css-foot">
            {errFor('custom_css') ? <small className="hsx-issue"><TriangleAlert size={12} /> {errFor('custom_css')}</small> : <small className="vc-hint"><Code2 size={12} className="vc-inline-ico" /> Only homeserver admins can set this.</small>}
            <small className={cssBytes > limits.custom_css_bytes ? 'hsx-issue' : 'vc-hint'}>{(cssBytes / 1024).toFixed(1)} / {Math.round(limits.custom_css_bytes / 1024)} KB</small>
          </div>
        </SCard>

        <SCard title="Start over">
          <div className="hsb-row"><span className="vc-hint">Every setting above back to the default, saved at once.</span><button type="button" className="btn btn-surface btn-sm ac-danger" disabled={!!busy} onClick={resetAll}><RotateCcw size={13} /> {busy === 'reset' ? 'Resetting...' : 'Reset all branding'}</button></div>
        </SCard>
      </div>

      <div className="hsb-preview">
        <div className="hsb-preview-head">
          <b><Eye size={14} /> Preview{changed ? ' (not saved)' : ''}</b>
          <div className="hsb-tabs" role="tablist">
            {[['login', 'Sign-in'], ['message', 'Message page']].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={page === k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}>{label}</button>)}
          </div>
        </div>
        {preview?.url ? <iframe className="hsb-frame" title={`${hs.domain} page preview`} src={preview.url} sandbox="allow-same-origin" referrerPolicy="no-referrer" />
          : preview?.error ? <div className="sx-empty"><TriangleAlert size={24} /><span>{preview.error}</span></div>
            : <div className="vc-loading"><i /><i /><i /></div>}
        <small className="vc-hint">Rendered by {hs.domain} with your changes; the link works for 10 minutes.</small>
      </div>
      <UnsavedBar changed={changed} bar={bar} busy={busy === 'save'} disabled={cssBytes > limits.custom_css_bytes} onReset={() => { setFieldError(null); setDraft(saved); }} onSave={save} />
    </div>
  );
}
