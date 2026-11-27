// My account > "Link Nookara account for payments": a homeserver account that isn't a Nookara account pays (a server tier, 19.0a)
// from a Nookara account it links for payments only. Hidden for a Nookara account, which pays from itself.
import { useEffect, useState } from 'react';
import { Coins, Link2, Unlink, Check, TriangleAlert } from 'lucide-react';
import { SCard } from './ui.jsx';
import { ask, toast } from '../store.js';
import { normOrigin } from '../ids.js';
import { loadPayments, unlinkPayments, startPaymentLink, paymentsErrorText } from '../payments.js';

const when = t => { const d = new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };

export function PaymentsCard({ origin, domain, handle }) {
  const [p, setP] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => { setError(''); loadPayments(origin).then(setP, e => { setP(false); setError(e.status === 404 ? 'old' : e.error || 'failed'); }); };
  useEffect(() => { setP(null); load(); }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  // the homeserver says it changed (linked / unlinked here or on Nookara): account_payments_update over the instance connection
  useEffect(() => {
    const on = e => { if (e.detail?.origin === normOrigin(origin)) { if (e.detail.payments) { setError(''); setP(e.detail.payments); } else load(); } };
    addEventListener('ember-payments', on);
    return () => removeEventListener('ember-payments', on);
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (p?.own_nookara_account || error === 'old') return null;
  async function link() {
    setBusy('link');
    try { await startPaymentLink(origin, { page: 'homeaccount' }); } catch (e) { toast(paymentsErrorText(e.error)); setBusy(''); }
  }
  async function unlink() {
    if (!(await ask({ title: 'Unlink your Nookara account?', text: `${handle} won't be able to pay for things on ${domain} until you link one again.`, confirm: 'Unlink', danger: true }))) return;
    setBusy('unlink');
    try { setP(await unlinkPayments(origin)); toast('Nookara account unlinked.', true); } catch (e) { toast(paymentsErrorText(e.error)); if (e.error === 'not_linked') load(); }
    setBusy('');
  }
  return (
    <SCard title="Link Nookara account for payments" sub={`${domain} sells server tiers for Nookara credits. Link a Nookara account to pay from it: you still approve every payment on Nookara, and nothing else is shared.`}>
      {p === null && <div className="vc-loading"><i /><i /><i /></div>}
      {p === false && <p className="vc-note"><TriangleAlert size={14} /> Couldn't load your payment settings from {domain}. <button type="button" className="btn btn-surface btn-sm" onClick={() => { setP(null); load(); }}>Try again</button></p>}
      {p && !p.available && !p.linked && <div className="sx-empty"><Coins size={28} /><b>No payments on {domain} yet</b><span>The homeserver isn't registered with Nookara, so it can't take payments.</span></div>}
      {p && (p.available || p.linked) && (
        <div className="sx-list-row">
          <span className="sx-row-ico"><Coins size={18} /></span>
          <div className="sx-row-txt">
            <b>{p.linked ? 'Nookara account linked' : 'No Nookara account linked'}</b>
            <span>{p.linked ? <span className="hsx-ok"><Check size={12} /> Pays for {handle}{p.nookara_id ? ` - Nookara user ${p.nookara_id}` : ''}{p.linked_at && when(p.linked_at) ? ` - since ${when(p.linked_at)}` : ''}</span> : 'Linking opens Nookara, where you sign in and agree.'}</span>
          </div>
          <div className="sx-row-ctl">
            {p.linked
              ? <button type="button" className="btn btn-surface btn-sm ac-danger" disabled={!!busy} onClick={unlink}><Unlink size={13} /> {busy === 'unlink' ? 'Unlinking...' : 'Unlink'}</button>
              : <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !p.available} onClick={link}><Link2 size={13} /> {busy === 'link' ? 'Opening Nookara...' : 'Link Nookara account'}</button>}
          </div>
        </div>
      )}
    </SCard>
  );
}
