// Which client a message / session was sent with = the Nookara App whose sign-in sent it (Ikelene 2026-11-11: "only show the
// login app details that you used to send that message"). `via.app` is the App id; its name, logo and verified mark come
// from Nookara's App registry (GET https://nookara.cc/apps/public/<id>, public), never from the message or an Ember server.
// Ember's own clients are the Ember App ("Ember", whichever device). No App: just the web address (never a token's name).
// An Ember server can write any `via` it likes, so there a verified mark also needs the message's address to be the App's own site.
// describeVia is pure (lookup passed in) so the node tests can load it.
import { NOOKARA_ORIGIN } from './hosts.js';

export const EMBER_APP_ID = 'app_e3be4c1d7a9f02b65c88';
const APP_ID = /^app_[0-9a-f]{8,40}$/;

const EMBER_SITES = new Set(['ember.nookara.cc', 'nookara.cc', 'velora.ikelene.net']); // where Ember (web, desktop, Android) runs
const hostOf = u => { try { return new URL(String(u)).host.toLowerCase(); } catch { return ''; } };
const baseHost = h => String(h || '').replace(/^www\./, '');
// same site: equal hosts, or one a subdomain of the other's site (ember.nookara.cc and nookara.cc)
const sameSite = (a, b) => { a = baseHost(a); b = baseHost(b); return !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a)); };

// -> { name, verified, icon, domain, known, registered, app }
//   lookup(id): the registry entry { name, icon, verified, website } | undefined (not loaded yet) | null (no such App)
export function describeVia(via, lookup = () => undefined, fromInstance = false) {
  if (!via) return null;
  const domain = via.url ? String(via.url).replace(/^https?:\/\//, '') : '';
  // no App id: Ember's own sites are the Ember App (messages from before App ids, and Ember server sessions made before the
  // sign-in token carried one, only have the address). Same rule as the verified check: an address on Ember's own site.
  const id = APP_ID.test(String(via.app || '')) ? String(via.app)
    : (via.official && !fromInstance) || EMBER_SITES.has(baseHost(hostOf(via.url))) ? EMBER_APP_ID : null;
  if (id) {
    const info = lookup(id);
    if (info) {
      const verified = !!info.verified && (!fromInstance || sameSite(hostOf(via.url), hostOf(info.website)));
      return { name: info.name, verified, icon: info.icon || null, domain, known: true, registered: !verified, app: id };
    }
    if (info === undefined) return { name: id === EMBER_APP_ID ? 'Ember' : (via.token || domain || 'A Nookara app'), verified: false, icon: null, domain, known: true, registered: true, app: id };
  }
  return { name: domain || (via.kind === 'bot' ? 'Bot connection' : 'Unknown client'), verified: false, icon: null, domain: '', known: false, registered: false, app: null };
}

// ── the registry cache ──
const cache = new Map(); // id -> entry | null
const pending = new Set();
const subs = new Set();
export const appInfo = id => cache.get(id);
export const onApps = fn => { subs.add(fn); return () => subs.delete(fn); };
const absolute = u => (!u ? null : /^https:\/\//.test(u) ? u : u.startsWith('/') && !u.startsWith('//') ? NOOKARA_ORIGIN + u : null);
export function loadApp(id) {
  if (!APP_ID.test(String(id || '')) || cache.has(id) || pending.has(id)) return;
  pending.add(id);
  fetch(`${NOOKARA_ORIGIN}/apps/public/${encodeURIComponent(id)}`, { credentials: 'omit' })
    .then(r => (r.ok ? r.json() : r.status === 404 ? { app: null } : Promise.reject(new Error('http ' + r.status))))
    .then(d => {
      const a = d.app;
      cache.set(id, a ? { name: String(a.name || 'App').slice(0, 48), icon: absolute(a.logo_url), verified: !!(a.verified || a.official), website: a.website || '' } : null);
      subs.forEach(fn => fn());
    })
    .catch(() => { /* try again next time it's needed */ })
    .finally(() => pending.delete(id));
}
