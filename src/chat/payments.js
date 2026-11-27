// Paying on a homeserver (PROTOCOL 19.0c): a Nookara account pays from itself; any other account links a Nookara account for
// payments only (nothing else is shared). Linking is a trip to Nookara's consent page and back to this page with
// ?payments_linked=1 (or 0 when cancelled); what to reopen afterwards is kept in sessionStorage for the trip.
import { hsCall } from './homeApi.js';

const BACK_KEY = 'ember_payments_back';

// -> { own_nookara_account, linked, nookara_id, linked_at, available }
export const loadPayments = origin => hsCall(origin, '/api/v2/account/payments');
export const unlinkPayments = origin => hsCall(origin, '/api/v2/account/payments/link', { method: 'DELETE' });

// back: what to show when the browser comes back ({ page: 'homeaccount' } | { sid, tab }). Leaves the page.
export async function startPaymentLink(origin, back = null, linkUrl = null) {
  const path = linkUrl ? pathOf(linkUrl, origin) : '/api/v2/account/payments/link';
  const { url } = await hsCall(origin, path, { method: 'POST', body: { return_to: location.origin + location.pathname } });
  let to;
  try { to = new URL(url); } catch { throw Object.assign(new Error('bad_link'), { error: 'bad_link' }); }
  if (!/^https?:$/.test(to.protocol)) throw Object.assign(new Error('bad_link'), { error: 'bad_link' });
  try { sessionStorage.setItem(BACK_KEY, JSON.stringify({ origin, back })); } catch { /* private mode: comes back to Home */ }
  location.assign(to.href);
}
// a 402's link_url is the POST above on the same homeserver: keep only its path
function pathOf(u, origin) {
  try { const x = new URL(u, origin); return x.origin === new URL(origin).origin && x.pathname.startsWith('/api/') ? x.pathname : '/api/v2/account/payments/link'; } catch { return '/api/v2/account/payments/link'; }
}

// location.search -> null (not a return from linking) | { linked, origin, back }
export function parsePaymentsReturn(search) {
  const q = new URLSearchParams(String(search || '').replace(/^[^?]*\?/, '').replace(/#.*$/, ''));
  const v = q.get('payments_linked');
  if (v !== '1' && v !== '0') return null;
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem(BACK_KEY) || 'null'); sessionStorage.removeItem(BACK_KEY); } catch { /* fine */ }
  return { linked: v === '1', origin: kept?.origin || null, back: kept?.back || null };
}
export function stripPaymentsReturn(href) {
  const u = new URL(href);
  u.searchParams.delete('payments_linked');
  return u.href;
}

export function paymentsErrorText(code) {
  switch (code) {
    case 'own_nookara_account': return 'This is a Nookara account: it pays from itself.';
    case 'payments_unavailable': return "This homeserver can't take payments yet (it isn't registered with Nookara).";
    case 'invalid_return_to': return "This homeserver doesn't let this app come back after linking. Link from the homeserver's own web app.";
    case 'not_linked': return 'No Nookara account is linked.';
    case 'payment_link_missing': return 'The Nookara account you linked no longer allows payments here. Link it again.';
    case 'unreachable': return "Couldn't reach the homeserver. Try again.";
    case 'rate_limited': return 'Too many tries. Wait a moment and try again.';
    default: return "Couldn't do that. Try again.";
  }
}
