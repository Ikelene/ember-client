// The sign-in methods of a homeserver, as its admins edit them (Settings > Homeservers > Accounts & sign-in): the list,
// "Add a sign-in method" with its presets, and one method's fields. The list itself lives in the page's form; the rules
// (presets, what is sent, what is wrong) are in homeAdmin.js.
import { useState } from 'react';
import { KeyRound, Fingerprint, Plus, Trash2, ChevronDown, ChevronUp, Copy, TriangleAlert, ShieldCheck } from 'lucide-react';
import { Switch, OptionCards } from './ui.jsx';
import { toast } from '../store.js';
import { PRESETS, KIND_LABEL, presetMethod, presetOf, methodIssues, callbackUrl } from '../homeAdmin.js';

const PRESET_LABEL = Object.fromEntries(PRESETS.map(p => [p.key, p.label]));
const copy = text => navigator.clipboard?.writeText(text).then(() => toast('Copied.', true), () => toast("Couldn't copy it."));

function Field({ label, hint, issue, children }) {
  return <label className={`vc-field hsx-field${issue ? ' bad' : ''}`}><span>{label}</span>{children}{issue ? <small className="hsx-issue"><TriangleAlert size={12} /> {issue}</small> : hint ? <small className="vc-hint">{hint}</small> : null}</label>;
}

// m: the method in the form ({ ...server's, client_secret: what is typed, _stored: the masked one it has, _new: not saved yet })
function MethodFields({ m, issues, origin, set, disabled }) {
  const text = (k, extra = {}) => <input className="form-input" value={m[k] || ''} disabled={disabled} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={e => set({ [k]: e.target.value })} {...extra} />;
  const cb = m._new || !m.callback_url ? callbackUrl(origin, String(m.id || '').trim().toLowerCase()) : m.callback_url;
  const preset = presetOf(m);
  return (
    <div className="hsx-fields">
      <div className="hsx-two">
        <Field label="Name" hint='What the button says: "Continue with ..."'>{text('name', { maxLength: 40 })}</Field>
        <Field label="Id" issue={issues.id} hint={m._new ? "Part of the callback address. It can't be changed later." : "Can't be changed: accounts are linked to it."}>{text('id', { maxLength: 32, disabled: disabled || !m._new })}</Field>
      </div>
      {m.kind !== 'password' && (
        <>
          <div className="vc-field hsx-field"><span>Callback address</span>
            <div className="hsx-copy"><code className="vc-mono">{cb || 'Give it an id first'}</code><button type="button" className="btn btn-surface btn-sm" disabled={!cb} onClick={() => copy(cb)}><Copy size={13} /> Copy</button></div>
            <small className="vc-hint">Register this with {PRESET_LABEL[preset] && !['oidc', 'oauth2', 'nookara'].includes(preset) ? PRESET_LABEL[preset] : 'the provider'} as the redirect address, then paste the client id and secret it gives you.</small></div>
          {m.kind === 'nookara' && <p className="vc-note"><ShieldCheck size={14} /> Signs people in with their Nookara account (https://nookara.cc), or the Nookara address this homeserver is set up with.</p>}
          {m.kind === 'oidc' && <Field label="Issuer address" issue={issues.issuer} hint="The homeserver reads the rest from <issuer>/.well-known/openid-configuration when you save.">{text('issuer', { placeholder: 'https://id.example', inputMode: 'url' })}</Field>}
          {m.kind === 'oauth2' && (
            <>
              <Field label="Authorize address" issue={issues.authorize_url}>{text('authorize_url', { placeholder: 'https://provider.example/oauth/authorize', inputMode: 'url' })}</Field>
              <Field label="Token address" issue={issues.token_url}>{text('token_url', { placeholder: 'https://provider.example/oauth/token', inputMode: 'url' })}</Field>
              <Field label="User info address" issue={issues.userinfo_url} hint="Asked with the access token; it says who signed in.">{text('userinfo_url', { placeholder: 'https://provider.example/api/user', inputMode: 'url' })}</Field>
            </>
          )}
          <div className="hsx-two">
            <Field label="Client id" issue={issues.client_id}>{text('client_id', { maxLength: 500 })}</Field>
            <Field label="Client secret" hint={m._stored ? `Saved (${m._stored}). Leave empty to keep it, or type a new one to replace it.` : 'Kept on the homeserver. It is never shown again.'}>
              {text('client_secret', { type: 'password', maxLength: 500, autoComplete: 'new-password', placeholder: m._stored || '' })}</Field>
          </div>
          {m.kind !== 'nookara' && <Field label="Scopes" hint={m.kind === 'oidc' ? 'Separated by spaces. Empty = openid profile email.' : 'Separated by spaces.'}>{text('scopes', { maxLength: 300 })}</Field>}
          <details className="hsx-more">
            <summary>More options</summary>
            <div className="hsx-two">
              {m.kind === 'oauth2' && <Field label="Id field" hint="In the user info answer. Empty = id.">{text('id_field', { maxLength: 100, placeholder: 'id' })}</Field>}
              <Field label="Username field" hint={m.kind === 'oauth2' ? 'Empty = the first of preferred_username, username, login, nickname, name.' : 'Empty = preferred_username.'}>{text('username_field', { maxLength: 100 })}</Field>
              <Field label="Email field" hint="Dots walk into objects: data.email.">{text('email_field', { maxLength: 100 })}</Field>
              <Field label="Verified-email field">{text('email_verified_field', { maxLength: 100 })}</Field>
              <Field label="Client secret is sent" hint="How the token address wants it.">
                <select className="form-select" value={m.token_auth || ''} disabled={disabled} onChange={e => set({ token_auth: e.target.value || undefined })}>
                  <option value="">{m.kind === 'oauth2' ? 'In the form (default)' : 'As the provider says (default)'}</option><option value="basic">In the Authorization header (basic)</option><option value="post">In the form (post)</option>
                </select></Field>
              <label className="hsx-check"><input type="checkbox" checked={m.pkce !== false} disabled={disabled} onChange={e => set({ pkce: e.target.checked ? undefined : false })} /> <span><b>Use PKCE</b><small>Switch off only for a provider that refuses it.</small></span></label>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

// methods: the form's list; onChange(next list); origin: the homeserver's own address (callback addresses for new methods)
export function LoginMethods({ methods, onChange, origin, disabled }) {
  const [open, setOpen] = useState(null); // the id of the method being edited
  const [adding, setAdding] = useState(false);
  const setAt = (i, patch) => onChange(methods.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const hasPassword = methods.some(m => m.kind === 'password');
  function add(key) {
    const m = presetMethod(key, methods);
    if (!m) return;
    const fresh = { ...m, _new: true, _key: `new-${Date.now()}` };
    onChange([...methods, fresh]);
    setOpen(fresh._key); setAdding(false);
  }
  const keyOf = m => m._key || m.id;
  return (
    <div className="hsx-methods">
      {!methods.length && <div className="sx-empty"><KeyRound size={28} /><b>No sign-in methods</b><span>Add one, or nobody can sign in here.</span></div>}
      {methods.map((m, i) => {
        const issues = methodIssues(m, methods), bad = Object.keys(issues).length > 0, isOpen = open === keyOf(m);
        return (
          <div className={`hsx-method${m.enabled === false ? ' off' : ''}${isOpen ? ' open' : ''}`} key={keyOf(m)}>
            <div className="sx-list-row">
              <span className="sx-row-ico">{m.kind === 'password' ? <KeyRound size={18} /> : <Fingerprint size={18} />}</span>
              <div className="sx-row-txt">
                <b>{m.name || m.id}{m._new && <i className="hsx-tag">New</i>}{bad && <i className="hsx-tag warn"><TriangleAlert size={11} /> Needs a look</i>}</b>
                <span>{PRESET_LABEL[presetOf(m)] && !['oidc', 'oauth2', 'password'].includes(presetOf(m)) ? `${PRESET_LABEL[presetOf(m)]} - ` : ''}{KIND_LABEL[m.kind]}{m.enabled === false ? ' - switched off' : ''}</span>
              </div>
              <div className="sx-row-ctl hsx-ctl">
                <Switch on={m.enabled !== false} onChange={v => !disabled && setAt(i, { enabled: v })} label={`${m.name || m.id} sign-in`} />
                <button type="button" className="vc-ico-btn" data-tip={isOpen ? 'Close' : 'Edit'} aria-label={`${isOpen ? 'Close' : 'Edit'} ${m.name || m.id}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : keyOf(m))}>{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                <button type="button" className="vc-ico-btn danger" data-tip="Remove" aria-label={`Remove ${m.name || m.id}`} disabled={disabled} onClick={() => { onChange(methods.filter((_, j) => j !== i)); if (isOpen) setOpen(null); }}><Trash2 size={15} /></button>
              </div>
            </div>
            {isOpen && <MethodFields m={m} issues={issues} origin={origin} disabled={disabled} set={patch => setAt(i, patch)} />}
          </div>
        );
      })}
      {!disabled && (adding ? (
        <div className="hsx-add">
          <b>Add a sign-in method</b>
          <OptionCards value={null} cols={2} onPick={add} options={PRESETS.map(p => ({ v: p.key, label: p.label, sub: p.key === 'password' && hasPassword ? 'There is one already.' : p.hint, disabled: p.key === 'password' && hasPassword }))} />
          <div className="ac-btns end"><button type="button" className="btn btn-surface btn-sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      ) : <button type="button" className="btn btn-surface hsx-addbtn" disabled={methods.length >= 20} onClick={() => setAdding(true)}><Plus size={14} /> Add a sign-in method</button>)}
    </div>
  );
}
