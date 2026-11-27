// Signing in on a homeserver (Ember Protocol v2, homeserver.js): "Continue with nookara.cc" / "Use another homeserver".
// Plain parts for whatever shows the sign-in (the gate, Settings > Homeservers); the login itself always happens
// on the homeserver's own page, never here.
import { useEffect, useState } from 'react';
import { ShieldCheck, Globe, TriangleAlert, ArrowLeft, ArrowRight } from 'lucide-react';
import { DEFAULT_HOMESERVER, parseHomeserver, resolve, probeDefault, recentHomeservers } from './homeserver.js';
import { startSignIn, signInOn } from './session.js';
import { RESOLVE_TEXT } from './homeSessions.js';

export function HomeserverIcon({ hs, className = 'lg' }) {
  const [bad, setBad] = useState(false);
  return <span className={`vc-srv-ico ${className}`}>{hs.icon_url && !bad ? <img src={hs.icon_url} alt="" onError={() => setBad(true)} /> : String(hs.name || hs.domain || '?').slice(0, 2).toUpperCase()}</span>;
}

// the two ways in. back = where a full-page trip should come back to (session.js startSignIn)
export function HomeserverLogin({ back }) {
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { probeDefault(); }, []); // (so the answer is there by the time the button is clicked)
  const viaDefault = () => { const r = startSignIn(back); if (r?.then) { setBusy(true); r.finally(() => setBusy(false)); } };
  if (other) return <OtherHomeserver back={back} onBack={() => setOther(false)} />;
  return (
    <div className="vc-gate-btns">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={viaDefault}><ShieldCheck size={15} /> {busy ? 'Waiting for sign-in...' : `Continue with ${DEFAULT_HOMESERVER}`}</button>
      <button type="button" className="btn btn-surface" disabled={busy} onClick={() => setOther(true)}><Globe size={15} /> Use another homeserver</button>
    </div>
  );
}

function OtherHomeserver({ back, onBack }) {
  const [text, setText] = useState('');
  const [look, setLook] = useState({ status: 'idle' }); // idle | typing | looking | ok { hs, hint } | error { error, domain }
  const [busy, setBusy] = useState(false);
  const recent = recentHomeservers();
  const type = v => { setText(v); setLook({ status: v.trim() ? 'typing' : 'idle' }); };
  // looked up as you type (a moment after the last key)
  useEffect(() => {
    const t = text.trim();
    if (!t) return undefined;
    const p = parseHomeserver(t);
    let live = true;
    const timer = setTimeout(() => {
      if (!p) { setLook({ status: 'error', error: 'invalid' }); return; }
      setLook({ status: 'looking', domain: p.domain });
      resolve(p).then(hs => { if (live) setLook({ status: 'ok', hs, hint: p.hint }); }, e => { if (live) setLook({ status: 'error', error: e?.code || 'unreachable', domain: p.domain }); });
    }, p ? 450 : 1100);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  const ok = look.status === 'ok';
  async function submit(e) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    await signInOn(look.hs, { hint: look.hint, back });
    setBusy(false);
  }
  return (
    <form className="vc-hs-form" onSubmit={submit}>
      <label className="vc-field"><span>Homeserver</span>
        <input className="form-input" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" inputMode="url" placeholder="example.org or alice@example.org" aria-label="Homeserver" value={text} onChange={e => type(e.target.value)} /></label>
      {look.status === 'looking' && <small className="vc-hs-looking"><i className="vc-gate-spin" aria-hidden="true" /> Looking for {look.domain}...</small>}
      {ok && (
        <div className="vc-invite-srv vc-inst-card vc-hs-found">
          <HomeserverIcon hs={look.hs} />
          <div><b>{look.hs.name}</b><small><Globe size={13} /> {look.hs.domain}</small>{look.hs.nookara_identity ? <small><ShieldCheck size={13} /> Signs you in with Nookara</small> : look.hint && <small>Signing in as {look.hint}@{look.hs.domain}</small>}</div>
        </div>
      )}
      {look.status === 'error' && <p className="vc-err" role="alert"><TriangleAlert size={14} /> {RESOLVE_TEXT(look.error, look.domain)}</p>}
      {look.status === 'idle' && recent.length > 0 && (
        <div className="vc-hs-recent">
          <small>Recently used</small>
          <div className="vc-gate-links">{recent.map(r => <button key={r.domain} type="button" className="vc-gate-link" onClick={() => type(r.domain)}><Globe size={12} /> {r.domain}</button>)}</div>
        </div>
      )}
      <div className="vc-gate-btns">
        <button type="button" className="btn btn-surface" disabled={busy} onClick={onBack}><ArrowLeft size={15} /> Back</button>
        <button type="submit" className="btn btn-primary" disabled={!ok || busy}>{busy ? 'Waiting for sign-in...' : <>Continue <ArrowRight size={15} /></>}</button>
      </div>
      <small className="vc-hs-foot">You sign in on the homeserver's own page. Ember never sees your password.</small>
    </form>
  );
}
