// Settings > Beta: Ember Beta is a Nookara membership (product prod_bd1bc5cc4369c157d993, chat/beta.js). Members get early
// versions of Ember before they release - right now the Modern look and everything under Look & feel.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { FlaskConical, Sparkles, Palette, Type, CheckCircle2, ExternalLink, RefreshCw, Coins } from 'lucide-react';
import { SettingsPage, SCard } from './ui.jsx';
import { getBeta, subscribeBeta, loadBeta, joinBeta } from '../beta.js';
import { useChat, toast, errorText } from '../store.js';
import { siteHref } from '../hosts.js';
import { startSignIn } from '../session.js';
import './beta-page.css';

function openOutside(url) {
  const abs = /^https?:/.test(url) ? url : new URL(url, location.origin).href;
  const d = window.bonfireDesktop;
  if (d?.openExternal) { Promise.resolve(d.openExternal(abs)).catch(() => {}); return; }
  window.open(abs, '_blank', 'noopener,noreferrer');
}
const PERIOD = { weekly: 'week', monthly: 'month', yearly: 'year' };

export default function BetaPage() {
  const b = useSyncExternalStore(subscribeBeta, getBeta);
  const signedIn = useChat(s => s.signedIn);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // sent to checkout: check again when they come back
  useEffect(() => { if (signedIn) loadBeta({ force: true }); }, [signedIn]);
  useEffect(() => {
    if (!waiting) return undefined;
    const back = () => loadBeta({ force: true }).then(s => { if (s.beta) { setWaiting(false); toast("You're in the Ember Beta!", true); } });
    addEventListener('focus', back);
    return () => removeEventListener('focus', back);
  }, [waiting]);
  async function join() {
    setBusy(true);
    try { const url = await joinBeta(); openOutside(siteHref(url)); setWaiting(true); }
    catch (e) { toast(e.message === 'beta_unavailable' ? "The Ember Beta isn't open right now." : errorText(e.message)); }
    setBusy(false);
  }
  const p = b.product;
  const plan = p?.plans?.[0];
  const price = plan ? `${plan.price} credits a ${PERIOD[plan.period] || plan.period}` : p ? `${p.price} credits` : '';
  const off = p?.discount && new Date(p.discount.until) > new Date() ? p.discount : null;
  const m = b.membership;
  return (
    <SettingsPage icon={FlaskConical} title="Ember Beta" sub="Get access to early versions of Ember before they release!">
      <section className={`bp-hero${b.beta ? ' in' : ''}`}>
        <div className="bp-hero-glow" aria-hidden="true" />
        <span className="bp-badge"><Sparkles size={14} /> {b.beta ? "You're in" : 'Early access'}</span>
        <h3>{b.beta ? 'Thanks for testing Ember early!' : 'Try what we are building next'}</h3>
        <p>{b.beta ? 'New things show up here before everyone else gets them. Turn on Modern under Messages > Look to use it.' : 'Beta members get new looks and features first, help shape them, and keep them for as long as the membership runs.'}</p>
        {!signedIn && <button type="button" className="btn btn-primary" onClick={() => startSignIn()}>Sign in with Nookara</button>}
        {signedIn && !b.beta && (
          <div className="bp-join">
            {p ? (
              <>
                <div className="bp-price"><Coins size={16} /><b>{price}</b>{off && <small>{off.off} off your first payment until {new Date(off.until).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small>}</div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={join}>{busy ? 'Opening checkout...' : 'Join the beta'}</button>
              </>
            ) : <span className="bp-note">{b.loaded ? "The Ember Beta isn't open right now." : 'Loading...'}</span>}
          </div>
        )}
        {signedIn && b.beta && m && (
          <div className="bp-join">
            <div className="bp-price"><CheckCircle2 size={16} /><b>{m.status === 'trialing' ? 'Free trial' : 'Membership active'}</b>
              {m.current_period_end && <small>{m.cancel_at_period_end ? 'Ends' : 'Renews'} {new Date(m.current_period_end).toLocaleDateString([], { month: 'short', day: 'numeric' })}{m.test ? ' (your own test purchase)' : ''}</small>}</div>
            <button type="button" className="btn btn-surface" onClick={() => openOutside(siteHref('/me#credits'))}><ExternalLink size={14} /> Manage membership</button>
          </div>
        )}
        {waiting && !b.beta && <button type="button" className="vc-link-btn bp-check" onClick={() => loadBeta({ force: true })}><RefreshCw size={13} /> Paid already? Check again</button>}
      </section>
      <SCard title="In the beta right now">
        <div className="bp-feats">
          <div className="bp-feat"><span><Sparkles size={18} /></span><div><b>Modern look</b><small>Bigger, softer and roomier, with floating panels and Roboto.</small></div></div>
          <div className="bp-feat"><span><Palette size={18} /></span><div><b>Themes</b><small>Light and dark themes, your own colours, accent and a background picture.</small></div></div>
          <div className="bp-feat"><span><Type size={18} /></span><div><b>Text & layout</b><small>Fonts, text size, density, emoji size and more.</small></div></div>
        </div>
      </SCard>
      <p className="bp-fine">Beta features can change or break before they're finished. If you leave, Ember goes back to Classic and keeps your Modern settings for when you come back.</p>
    </SettingsPage>
  );
}
