// Server settings > Plan (owner, a server on a homeserver): the tiers its homeserver sells for Nookara credits (PROTOCOL 19.0a).
// Buying asks Nookara for a pay request that the owner approves there; this page waits for the answer. An account that isn't a
// Nookara account links one for payments first (402 nookara_link_required, 19.0c): the page says so and starts the link, and
// buying carries on by itself when the browser comes back.
import { useEffect, useRef, useState } from 'react';
import { Gem, Coins, ExternalLink, Link2, Check, Clock, TriangleAlert } from 'lucide-react';
import { toast } from './store.js';
import { bare } from './ids.js';
import { hsCall } from './homeApi.js';
import { startPaymentLink, paymentsErrorText } from './payments.js';
import { RETRY_KEY, tierErrorText, untilText } from './tiers.js';

export function TierPage({ sid, origin }) {
  const id = encodeURIComponent(bare(sid));
  const [lim, setLim] = useState(null); // null = loading, false = failed
  const [st, setSt] = useState(null);
  const [needLink, setNeedLink] = useState(null); // { tier, link_url }
  const [busy, setBusy] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const loadTier = () => hsCall(origin, `/api/v2/servers/${id}/tier`).then(d => { if (live.current) setSt(d); return d; }, () => null);
  useEffect(() => {
    hsCall(origin, `/api/v1/servers/${id}/limits`).then(d => live.current && setLim(d), () => live.current && setLim(false));
    loadTier().then(d => {
      // back from linking a Nookara account for payments: buy what was asked for before the trip
      let retry = null;
      try { retry = sessionStorage.getItem(RETRY_KEY); sessionStorage.removeItem(RETRY_KEY); } catch { /* fine */ }
      const cut = (retry || '').lastIndexOf('|'), rs = retry?.slice(0, cut), rt = retry?.slice(cut + 1); // ("<sid>|<tier>": a sid can hold a | itself)
      if (rs === sid && rt && d?.status !== 'pending') buy({ id: rt }); // eslint-disable-line no-use-before-define
    });
  }, [sid, origin]); // eslint-disable-line react-hooks/exhaustive-deps
  // the owner's connection says the purchase moved on (chat_tier_update): ask now rather than at the next poll
  useEffect(() => {
    const on = e => { if (e.detail?.origin === origin && (e.detail.server === bare(sid) || e.detail.server === sid)) loadTier(); };
    addEventListener('ember-tier', on);
    return () => removeEventListener('ember-tier', on);
  }, [sid, origin]); // eslint-disable-line react-hooks/exhaustive-deps
  // a pay request is open: ask again every few seconds until Nookara has an answer
  useEffect(() => {
    if (st?.status !== 'pending') return undefined;
    const t = setInterval(() => loadTier().then(d => {
      if (d?.status === 'paid') toast(`Payment approved: ${nameOf(d.tier)} is on until ${untilText(d.until)}.`, true);
      else if (d && d.status !== 'pending') toast(tierErrorText(d.status === 'failed' ? d.pay_request?.error || 'failed' : d.status));
    }), 4000);
    return () => clearInterval(t);
  }, [st?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiers = (lim && Array.isArray(lim.tiers) ? lim.tiers : []);
  const nameOf = t => tiers.find(x => x.id === t)?.name || t;
  async function buy(t) {
    setBusy(t.id); setNeedLink(null);
    try {
      const r = await hsCall(origin, `/api/v2/servers/${id}/tier`, { method: 'POST', body: { tier: t.id } });
      setSt(s => ({ ...(s || {}), ...r, status: r.status || 'pending' }));
      if (r.pay_request?.approve_url) window.open(r.pay_request.approve_url, '_blank', 'noopener');
    } catch (e) {
      if (e.error === 'nookara_link_required') setNeedLink({ tier: t, link_url: e.link_url || null });
      else toast(tierErrorText(e.error));
    }
    setBusy('');
  }
  async function link() {
    setBusy('link');
    try { sessionStorage.setItem(RETRY_KEY, `${sid}|${needLink.tier.id}`); } catch { /* the buy button is still there */ }
    try { await startPaymentLink(origin, { sid, tab: 'plan' }, needLink.link_url); } catch (e) { toast(paymentsErrorText(e.error)); setBusy(''); }
  }

  const pending = st?.status === 'pending' ? st.pay_request : null;
  const current = st?.tier || lim?.tier || null;
  const until = st?.until || lim?.until || null;
  const sellable = lim && lim.tiers_available !== false && st?.tiers_available !== false;
  return (
    <div className="bf-ss-page">
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><Gem size={15} /> Plan</span></div>
        <div className="card-body">
          {lim === null && <div className="vc-loading"><i /><i /><i /></div>}
          {lim === false && <p className="vc-note"><TriangleAlert size={14} /> Couldn't load this server's plan.</p>}
          {lim && <p className="bf-tier-now">{current ? <><Check size={14} /> On <b>{nameOf(current)}</b>{until ? ` until ${untilText(until)}` : ''}. Buying it again adds another period after that.</> : 'On the homeserver\'s standard limits.'}</p>}
          {pending && (
            <div className="bf-tier-pending">
              <Clock size={16} />
              <span>Waiting for you to approve {pending.amount} credits on Nookara{pending.tier ? ` for ${nameOf(pending.tier)}` : ''}.</span>
              {pending.approve_url && <a className="btn btn-surface btn-sm" href={pending.approve_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open Nookara</a>}
            </div>
          )}
          {needLink && (
            <div className="bf-tier-link" role="alert">
              <Link2 size={18} />
              <div>
                <b>Link a Nookara account for payments</b>
                <span>Tiers are paid with Nookara credits. Your account isn't a Nookara account, so link one to pay from: you approve every payment on Nookara, and nothing else is shared. {needLink.tier.name || needLink.tier.id} is bought as soon as you're back.</span>
              </div>
              <div className="bf-tier-link-btns">
                <button type="button" className="btn btn-surface btn-sm" onClick={() => setNeedLink(null)}>Not now</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'link'} onClick={link}><Link2 size={13} /> {busy === 'link' ? 'Opening Nookara...' : 'Link Nookara account'}</button>
              </div>
            </div>
          )}
          {lim && !sellable && <p className="vc-hint">This homeserver doesn't sell tiers (it isn't registered with Nookara).</p>}
          {lim && sellable && !tiers.length && <p className="vc-hint">This homeserver has no tiers for sale.</p>}
          {lim && sellable && tiers.map(t => (
            <div className="sx-list-row" key={t.id}>
              <span className="sx-row-ico"><Gem size={18} /></span>
              <div className="sx-row-txt"><b>{t.name || t.id}</b><span><Coins size={12} /> {t.price_credits} credits for {t.period_weeks === 1 ? '1 week' : `${t.period_weeks} weeks`}</span></div>
              <div className="sx-row-ctl"><button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !!pending} onClick={() => buy(t)}>{busy === t.id ? 'Asking...' : current === t.id ? 'Extend' : 'Buy'}</button></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
