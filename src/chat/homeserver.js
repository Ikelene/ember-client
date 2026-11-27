// Ember Protocol v2: signing in on a homeserver. A homeserver (a domain such as nookara.cc or example.org) hosts accounts,
// shown as username@domain. Ember never sees a password: it finds the homeserver from the domain's /.well-known/ember, opens
// the homeserver's own login page (OAuth 2.0 authorization code + PKCE, Ember is a public client) and trades the code it
// gets back for tokens. Sessions are kept per homeserver origin in localStorage.
// Pure: no imports, and everything it touches from the browser goes through `env` (the node tests swap those out).

export const CLIENT_ID = 'ember';
export const DEFAULT_HOMESERVER = 'nookara.cc';
// storage (all new names; nothing here is shared with the Nookara sign-in in session.js)
export const SESSIONS_KEY = 'ember_hs_sessions'; // localStorage: { [homeserver origin]: session }
export const CURRENT_KEY = 'ember_hs_current'; // localStorage: the homeserver origin in use
export const RECENT_KEY = 'ember_hs_recent'; // localStorage: [{ domain, name, icon_url }], newest first
export const PENDING_KEY = 'ember_hs_pending'; // sessionStorage: a full-page sign-in on its way back (verifier, state, where to return)
const RECENT_MAX = 6;

const env = {
  fetch: (...a) => fetch(...a),
  storage: () => localStorage,
  session: () => sessionStorage,
  dev: !!import.meta.env?.DEV, // dev builds may talk to http://localhost
  base: import.meta.env?.BASE_URL || '/', // where the built files are served from (auth/callback.html sits under it)
  timeout: 10000,
};
export function configure(o) { Object.assign(env, o); probing = probed = null; docs.clear(); }

// code: invalid | not_found | legacy | not_homeserver | unreachable | bad_url | domain_mismatch (finding a homeserver),
// state | declined | cancelled | failed | signed_out (signing in), or the homeserver's own OAuth error (invalid_grant...)
export class HomeserverError extends Error {
  constructor(code, description, status) { super(description || code); this.name = 'HomeserverError'; this.code = code; if (status != null) this.status = status; }
}
const fail = (code, description, status) => new HomeserverError(code, description, status);

// ── what was typed ──
const isLocal = h => h === 'localhost' || h === '127.0.0.1';
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST = new RegExp(`^(?=.{1,253}(?::|$))${LABEL}(?:\\.${LABEL})*(?::\\d{1,5})?$`);
const cleanDomain = d => { const s = typeof d === 'string' ? d.trim().toLowerCase() : ''; return HOST.test(s) ? s : ''; };
// 'example.org' | 'https://example.org' | 'alice@example.org' -> { domain, hint, origin } (hint = the username, for login_hint), or null
export function parseHomeserver(input) {
  let s = String(input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  let hint = '', scheme = '';
  const m = /^(https?):\/\//i.exec(s);
  if (m) { scheme = m[1].toLowerCase() + ':'; s = s.slice(m[0].length).replace(/[/?#].*$/, ''); }
  else {
    s = s.replace(/^@/, '');
    const at = s.lastIndexOf('@');
    if (at >= 0) { hint = s.slice(0, at); s = s.slice(at + 1); if (!/^[^\s@/:?#]{1,64}$/.test(hint)) return null; }
    s = s.replace(/\/+$/, '');
  }
  const domain = cleanDomain(s);
  if (!domain) return null;
  const local = isLocal(domain.replace(/:\d+$/, ''));
  if (local ? !env.dev : !domain.includes('.')) return null;
  if (!scheme) scheme = local ? 'http:' : 'https:';
  if (scheme === 'http:' && !local) return null;
  return { domain, hint, origin: `${scheme}//${domain}` };
}
export const handleOf = (username, domain) => `${username}@${domain}`;

// a URL from a discovery doc / token answer: https only (http://localhost and 127.0.0.1 in dev builds), no user:pass -> URL | null
export function safeUrl(u, base) {
  if (typeof u !== 'string' || !u) return null;
  let url;
  try { url = new URL(u, base); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && env.dev && isLocal(url.hostname)) return url;
  return null;
}

// ── finding the homeserver ──
async function getJson(url) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), env.timeout);
  try {
    const res = await env.fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctl?.signal });
    const data = res.ok ? await res.json().catch(() => null) : null;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { throw fail('unreachable'); } finally { clearTimeout(timer); }
}
// an origin's discovery doc -> { doc } (protocol 2) | { legacy: true } (an older Ember server) | null (nothing there)
// ember-server keeps `protocol: 1` for old clients and says `protocol_version: 2`; a domain's delegation doc says `protocol: 2`
const versionOf = doc => Math.max(Number(doc.protocol) || 0, Number(doc.protocol_version) || 0);
async function wellKnown(origin) {
  const doc = await getJson(`${origin}/.well-known/ember`);
  if (doc) return versionOf(doc) >= 2 ? { doc } : { legacy: true };
  const old = await getJson(`${origin}/.well-known/bonfire`).catch(() => null);
  return old ? { legacy: true } : null;
}
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// a domain's own discovery doc names where its accounts' DM messages are reported (social.reports_url), also when its homeserver
// is somewhere else (nookara.cc names Nookara's route; its homeserver's doc may not). -> the URL on that domain | null
export async function domainReportsUrl(domain) {
  const p = parseHomeserver(domain);
  if (!p?.origin) return null;
  const doc = await getJson(`${p.origin}/.well-known/ember`).catch(() => null);
  const u = safeUrl(doc?.social?.reports_url, `${p.origin}/`);
  return u && (u.origin === p.origin || u.host === p.domain) && !u.search && !u.hash ? u.href : null;
}
// -> { domain, origin, name, icon_url, authorize_url, token_url, methods: [{ id, kind, name }], protocol, nookara_identity?: true }
export async function resolve(input) {
  const p = input && typeof input === 'object' ? input : parseHomeserver(input);
  if (!p?.origin || !p.domain) throw fail('invalid');
  const first = await wellKnown(p.origin);
  if (!first) throw fail('not_found');
  if (first.legacy) throw fail('legacy');
  let origin = p.origin, doc = first.doc;
  if (typeof doc.homeserver === 'string' && doc.homeserver) { // the domain points at its homeserver
    const u = safeUrl(doc.homeserver);
    if (!u) throw fail('bad_url');
    if (u.origin !== origin) {
      origin = u.origin;
      const second = await wellKnown(origin);
      if (!second) throw fail('not_homeserver');
      if (second.legacy) throw fail('legacy');
      doc = second.doc;
    }
  }
  const login = doc.login;
  if (!login || typeof login !== 'object') throw fail('not_homeserver');
  const a = safeUrl(login.authorize_url, origin), t = safeUrl(login.token_url, origin);
  const own = [origin, p.origin];
  if (!a || !t || !own.includes(a.origin) || !own.includes(t.origin)) throw fail('bad_url');
  const info = doc.homeserver && typeof doc.homeserver === 'object' ? doc.homeserver : {};
  const domain = cleanDomain(info.domain) || p.domain;
  // the homeserver says which domain its accounts carry; that domain has to point back at it (or anyone could hand out @nookara.cc names)
  if (domain !== p.domain) {
    const claimed = await wellKnown(`${new URL(p.origin).protocol}//${domain}`);
    const to = claimed?.doc && (typeof claimed.doc.homeserver === 'string' && claimed.doc.homeserver ? safeUrl(claimed.doc.homeserver)?.origin : `${new URL(p.origin).protocol}//${domain}`);
    if (to !== origin) throw fail('domain_mismatch');
  }
  const methods = (Array.isArray(login.methods) ? login.methods : []).filter(x => x && typeof x === 'object' && str(x.id)).slice(0, 20).map(x => ({ id: str(x.id), kind: str(x.kind), name: str(x.name) || str(x.id) }));
  return { domain, origin, name: str(info.name) || domain, icon_url: safeUrl(info.icon_url, origin)?.href || null, authorize_url: a.href, token_url: t.href, methods, protocol: versionOf(doc), ...(doc.accounts?.nookara_identity === true ? { nookara_identity: true } : {}) };
}
// How to sign in on a homeserver (hs from resolve). One whose accounts are Nookara accounts (discovery accounts.nookara_identity)
// is signed in to with Nookara: DMs, keys and everything else those accounts have live there. -> 'nookara' | 'homeserver'
export const signInWith = hs => (hs?.nookara_identity === true ? 'nookara' : 'homeserver');

// Where a domain's servers live, for an address like slug@domain. Lighter than resolve(): it asks for no login block, so it
// also answers for a server that signs people in the old way (protocol 1, with or without many servers).
// -> { domain, origin, protocol_version (1 = one server per instance, 2 = many), doc }
export async function locate(input) {
  const p = input && typeof input === 'object' ? input : parseHomeserver(input);
  if (!p?.origin || !p.domain) throw fail('invalid');
  const read = async origin => (await getJson(`${origin}/.well-known/ember`)) || (await getJson(`${origin}/.well-known/bonfire`).catch(() => null));
  let origin = p.origin, doc = await read(origin);
  if (!doc) throw fail('not_found');
  if (typeof doc.homeserver === 'string' && doc.homeserver) { // the domain points at its homeserver
    const u = safeUrl(doc.homeserver);
    if (!u) throw fail('bad_url');
    if (u.origin !== origin) {
      origin = u.origin;
      doc = await read(origin);
      if (!doc || typeof doc.homeserver === 'string') throw fail('not_homeserver'); // (one hop: a homeserver doesn't point on)
    }
  }
  return { domain: p.domain, origin, protocol_version: Math.max(1, Math.floor(Number(doc.protocol_version)) || 1), doc };
}

// nookara.cc is the default. Asked once per page load (the answer has to be ready by the time a button is clicked, a pop-up
// can't wait for the network): { v2: true, hs } once it speaks protocol 2, { v2: false, error } until then (the old Nookara sign-in).
// (v2 and signInWith(hs) === 'nookara': its accounts are Nookara's, so it is still the Nookara sign-in)
let probing = null, probed = null;
export function probeDefault() {
  return (probing ||= resolve(DEFAULT_HOMESERVER).then(hs => ({ v2: true, hs }), e => ({ v2: false, error: e?.code || 'failed' })).then(r => {
    probed = r;
    if (r.error === 'unreachable') probing = null; // (asked again next time)
    return r;
  }));
}
export const defaultProbe = () => probed;

// ── PKCE ──
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function pkceChallenge(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
export function authorizeUrl(hs, { redirect_uri, state, challenge, hint }) {
  const u = safeUrl(hs.authorize_url);
  if (!u) throw fail('bad_url');
  const q = { response_type: 'code', client_id: CLIENT_ID, redirect_uri, state, code_challenge: challenge, code_challenge_method: 'S256' };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  if (hint) u.searchParams.set('login_hint', hint);
  return u.href;
}

// ── storage ──
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of [...listeners]) try { fn(); } catch { /* theirs */ } };
const endHooks = new Set(); // (origin, reason): a session was dropped ('ended' = the homeserver refused it, 'signout' = asked for)
export function onSignedOut(fn) { endHooks.add(fn); return () => endHooks.delete(fn); }
const readJson = (store, key, fallback) => { try { const v = JSON.parse(store().getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
const writeJson = (store, key, v) => { try { if (v == null) store().removeItem(key); else store().setItem(key, JSON.stringify(v)); } catch { /* private mode / full */ } };
const okSession = s => s && typeof s === 'object' && typeof s.access_token === 'string' && s.access_token && s.account && typeof s.account.username === 'string';
export function sessions() {
  const all = readJson(env.storage, SESSIONS_KEY, {});
  const out = {};
  if (all && typeof all === 'object') for (const [o, s] of Object.entries(all)) if (okSession(s) && s.origin === o && safeUrl(o)?.origin === o) out[o] = s;
  return out;
}
export const getSession = origin => sessions()[origin] || null;
export function currentOrigin() {
  const all = sessions();
  let cur = null;
  try { cur = env.storage().getItem(CURRENT_KEY); } catch { /* blocked */ }
  return cur && all[cur] ? cur : Object.keys(all)[0] || null;
}
export const currentSession = () => getSession(currentOrigin());
export const currentAccount = () => currentSession()?.account || null;
export function setCurrent(origin) {
  if (!getSession(origin)) return false;
  try { env.storage().setItem(CURRENT_KEY, origin); } catch { /* fine */ }
  changed();
  return true;
}
function account(a, domain, old) {
  if (!a || typeof a !== 'object') { if (old) return old; throw fail('failed', 'no account in the token answer'); }
  const username = str(a.username, 64);
  if (!username || /[\s@]/.test(username)) throw fail('failed', 'bad account in the token answer');
  if (a.domain != null && cleanDomain(a.domain) !== domain) throw fail('domain_mismatch'); // a homeserver only speaks for its own domain
  return { id: a.id == null ? null : String(a.id), username, domain, handle: handleOf(username, domain), display_name: str(a.display_name) || username, avatar_url: safeUrl(a.avatar_url)?.href || null };
}
// keep what the token endpoint answered (a refresh may leave out the account and the refresh token: the old ones stay)
function saveSession(hs, d, old) {
  const s = {
    origin: hs.origin, domain: hs.domain, name: hs.name || hs.domain, icon_url: hs.icon_url || null, token_url: hs.token_url,
    access_token: d.access_token,
    refresh_token: typeof d.refresh_token === 'string' && d.refresh_token ? d.refresh_token : old?.refresh_token || null,
    expires_at: Number(d.expires_in) > 0 ? Date.now() + Number(d.expires_in) * 1000 : null,
    account: account(d.account, hs.domain, old?.account),
  };
  const all = sessions();
  all[hs.origin] = s;
  writeJson(env.storage, SESSIONS_KEY, all);
  if (!old) try { env.storage().setItem(CURRENT_KEY, hs.origin); } catch { /* fine */ }
  changed();
  return s;
}
// sign out of a homeserver: its tokens are forgotten (the recent-homeservers list keeps the domain)
export function signOut(origin = currentOrigin(), reason = 'signout') {
  const all = sessions();
  if (!origin || !all[origin]) return false;
  delete all[origin];
  writeJson(env.storage, SESSIONS_KEY, Object.keys(all).length ? all : null);
  try { if (env.storage().getItem(CURRENT_KEY) === origin) { const next = Object.keys(all)[0]; if (next) env.storage().setItem(CURRENT_KEY, next); else env.storage().removeItem(CURRENT_KEY); } } catch { /* fine */ }
  changed();
  for (const fn of [...endHooks]) try { fn(origin, reason); } catch { /* theirs */ }
  return true;
}
export function signOutAll() { for (const o of Object.keys(sessions())) signOut(o); }

export function recentHomeservers() {
  const v = readJson(env.storage, RECENT_KEY, []);
  return (Array.isArray(v) ? v : []).filter(x => x && cleanDomain(x.domain) === x.domain).slice(0, RECENT_MAX).map(x => ({ domain: x.domain, name: str(x.name) || x.domain, icon_url: safeUrl(x.icon_url)?.href || null }));
}
export function rememberHomeserver(hs) {
  if (!hs || cleanDomain(hs.domain) !== hs.domain) return;
  writeJson(env.storage, RECENT_KEY, [{ domain: hs.domain, name: hs.name || hs.domain, icon_url: hs.icon_url || null }, ...recentHomeservers().filter(x => x.domain !== hs.domain)].slice(0, RECENT_MAX));
  changed();
}
export function forgetHomeserver(domain) {
  const left = recentHomeservers().filter(x => x.domain !== domain);
  writeJson(env.storage, RECENT_KEY, left.length ? left : null);
  changed();
}

// ── tokens ──
// the token endpoint has to be on the homeserver's origin or its domain's (checked again here: it is read back from storage)
const tokenUrl = hs => { const u = safeUrl(hs?.token_url); return u && (u.origin === hs.origin || u.host === hs.domain) ? u.href : null; };
async function tokenPost(hs, body) {
  const url = tokenUrl(hs);
  if (!url) throw fail('bad_url');
  let res;
  try { res = await env.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'omit', body: JSON.stringify(body) }); } catch { throw fail('unreachable'); }
  const d = await res.json().catch(() => null);
  if (!res.ok || !d || typeof d.access_token !== 'string' || !d.access_token) throw fail(typeof d?.error === 'string' && d.error ? d.error : 'failed', str(d?.error_description, 500), res.status);
  return d;
}
// the code from the homeserver's login page -> a session (stored, and made the current one)
export async function exchange(hs, { code, verifier, redirect_uri }) {
  const d = await tokenPost(hs, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri, client_id: CLIENT_ID });
  const s = saveSession(hs, d, null);
  rememberHomeserver(hs);
  return s;
}
// a new access token. One request at a time per homeserver; a refusal (not a network error) ends the session.
const refreshing = new Map();
export function refresh(origin = currentOrigin()) {
  if (refreshing.has(origin)) return refreshing.get(origin);
  const run = (async () => {
    const old = getSession(origin);
    if (!old?.refresh_token) throw fail('signed_out', '', 401);
    let d;
    try { d = await tokenPost(old, { grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: CLIENT_ID }); } catch (e) {
      if (e.code === 'unreachable' || e.status >= 500) throw e;
      const now = getSession(origin);
      if (now && now.refresh_token !== old.refresh_token) return now; // another tab got there first: its tokens are the good ones
      signOut(origin, 'ended');
      throw e;
    }
    if (!getSession(origin)) throw fail('signed_out', '', 401); // signed out while it was on its way
    return saveSession(old, d, old);
  })().finally(() => refreshing.delete(origin));
  refreshing.set(origin, run);
  return run;
}
// fetch() for the home homeserver's API: the path goes on the homeserver's origin with the access token. A 401 refreshes
// once and tries again; a second 401 (or a refused refresh) signs out and throws signed_out. -> the Response
export async function homeFetch(path, options = {}) {
  const { origin = currentOrigin(), ...opts } = options;
  let s = getSession(origin);
  if (!s) throw fail('signed_out', '', 401);
  const url = new URL(path, `${s.origin}/`);
  if (!ownUrl(s, url)) throw fail('bad_url'); // the token never leaves its homeserver
  const call = token => env.fetch(url.href, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  let res = await call(s.access_token);
  if (res.status !== 401) return res;
  const now = getSession(origin);
  if (now && now.access_token !== s.access_token) s = now; // (already refreshed elsewhere)
  else {
    try { s = await refresh(origin); } catch (e) {
      if (e.code === 'unreachable' || e.status >= 500) throw e;
      signOut(origin, 'ended');
      throw fail('signed_out', '', 401);
    }
  }
  res = await call(s.access_token);
  if (res.status === 401) { signOut(origin, 'ended'); throw fail('signed_out', '', 401); }
  return res;
}

// the homeserver's own origin, or its domain's (nookara.cc accounts live on chat.nookara.cc, their friends and DMs on nookara.cc)
function ownUrl(s, url) {
  if (!s || !url || url.username || url.password) return false;
  if (url.origin === s.origin) return true;
  return url.host === s.domain && !!safeUrl(url.href);
}
export const isOwnUrl = (u, origin = currentOrigin()) => { try { return ownUrl(getSession(origin), new URL(u)); } catch { return false; } };

// ── what else the homeserver's discovery says (PROTOCOL 3, 4a-4c, 20) ──
// -> { origin, domain, api_url (the social API's base), reports_url, account_url, remote_token_url, remote_url, accepts_remote, pushers_url }
// reports_url: where a message of one of this homeserver's accounts in a DM hosted elsewhere is reported, when it is not
// <api_url>/social/reports (Nookara names its own report route)
// Every address has to be on the homeserver's origin (api_url: or its domain's); one that isn't is left out (null).
const docs = new Map(); // origin -> { at, p }
export function homeInfo(origin = currentOrigin(), { fresh = false } = {}) {
  if (!origin) return Promise.reject(fail('signed_out', '', 401));
  const had = docs.get(origin);
  if (had && !fresh && Date.now() - had.at < 10 * 60 * 1000) return had.p;
  const p = (async () => {
    const doc = (await getJson(`${origin}/.well-known/ember`)) || {};
    const s = getSession(origin);
    const domain = s?.domain || cleanDomain(doc.homeserver?.domain) || new URL(origin).host;
    const at = (u, wide) => { const x = safeUrl(u, `${origin}/`); return x && (x.origin === origin || (wide && x.host === domain)) && !x.search && !x.hash ? x.href.replace(/\/+$/, '') : null; };
    const f = doc.federation && typeof doc.federation === 'object' ? doc.federation : {};
    return {
      origin, domain,
      api_url: at(doc.social?.api_url, true) || `${origin}/api/v2`,
      reports_url: at(doc.social?.reports_url, true) || null,
      account_url: at(doc.login?.account_url) || null,
      remote_token_url: at(f.remote_token_url) || (f.remote_token_url === null ? null : `${origin}/api/v2/auth/remote-token`),
      remote_url: at(f.remote_url) || null,
      accepts_remote: str(f.accepts_remote) || 'none',
      pushers_url: at(doc.push?.pushers_url) || null,
    };
  })();
  docs.set(origin, { at: Date.now(), p });
  p.catch(() => { if (docs.get(origin)?.p === p) docs.delete(origin); });
  return p;
}

// ── other homeservers (4b): home signs a token for them, they trade it for a session of their own ──
const sameOrigin = u => { try { const x = new URL(u); return x.origin; } catch { return null; } };
// -> the token (a jwt, good for one exchange)
export async function remoteToken(audience, { origin = currentOrigin() } = {}) {
  const aud = safeUrl(audience)?.origin;
  if (!aud) throw fail('bad_url');
  if (aud === origin) throw fail('own_homeserver');
  const info = await homeInfo(origin);
  if (!info.remote_token_url) throw fail('account_not_hosted_here', '', 403);
  let res;
  try { res = await homeFetch(info.remote_token_url, { origin, method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ audience: aud }) }); }
  catch (e) { if (e instanceof HomeserverError) throw e; throw fail('unreachable'); }
  const d = await res.json().catch(() => null);
  if (!res.ok || typeof d?.token !== 'string' || !d.token) throw fail(str(d?.error) || 'failed', str(d?.reason || d?.error_description, 300), res.status);
  return d.token;
}
// the other homeserver's side: the token becomes a session there. remoteUrl: its federation.remote_url (default: the usual path)
export async function remoteExchange(target, token, remoteUrl) {
  const o = safeUrl(target)?.origin;
  const url = safeUrl(remoteUrl || `${o}/api/v2/auth/remote`);
  if (!o || !url || sameOrigin(url.href) !== o) throw fail('bad_url'); // the token is for that homeserver and goes nowhere else
  let res;
  try { res = await env.fetch(url.href, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token }) }); } catch { throw fail('unreachable'); }
  const d = await res.json().catch(() => null);
  if (!res.ok || typeof d?.access_token !== 'string' || !d.access_token) throw Object.assign(fail(str(d?.error) || 'failed', str(d?.error_description, 300), res.status), d && typeof d === 'object' ? { data: d } : {});
  return { access_token: d.access_token, refresh_token: typeof d.refresh_token === 'string' ? d.refresh_token : null, expires_at: Number(d.expires_in) > 0 ? Date.now() + Number(d.expires_in) * 1000 : null, account: d.account && typeof d.account === 'object' ? d.account : null };
}
// both steps. One at a time per homeserver (a socket and three requests noticing a 401 together make one trip)
const signingIn = new Map();
export function remoteSignIn(target, { origin = currentOrigin(), remoteUrl } = {}) {
  const key = `${origin}>${target}`;
  if (!signingIn.has(key)) signingIn.set(key, (async () => remoteExchange(target, await remoteToken(target, { origin }), remoteUrl))().finally(() => signingIn.delete(key)));
  return signingIn.get(key);
}

// ── the round trip ──
// What the login page's answer has to be before its code is used. ev = { origin, data } (a message from auth/callback.html),
// pending = { state }. -> null (not ours: ignore it) | { code }; throws state / declined / failed
export function checkCallback(ev, pending, emberOrigin) {
  if (!ev || !emberOrigin || ev.origin !== emberOrigin) return null; // only Ember's own callback page, never another origin
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.type !== 'ember-auth') return null;
  if (!pending?.state || typeof d.state !== 'string' || d.state !== pending.state) throw fail('state');
  if (d.error) throw fail(d.error === 'access_denied' ? 'declined' : 'failed', str(d.error_description, 500));
  if (typeof d.code !== 'string' || !d.code) throw fail('failed');
  return { code: d.code };
}
export const popupRedirectUri = () => new URL(`${env.base}auth/callback.html`, location.href).href.split(/[?#]/)[0];
export const pageRedirectUri = () => `${location.origin}${location.pathname}#/auth/callback`;
const slim = hs => ({ domain: hs.domain, origin: hs.origin, name: hs.name, icon_url: hs.icon_url, authorize_url: hs.authorize_url, token_url: hs.token_url });

// Open the homeserver's login page and wait for it: resolves to the stored session. Call it straight from a click (the
// pop-up is opened before anything is awaited). A blocked pop-up turns into a full-page trip: the page leaves, and
// handleCallback() finishes it on the way back (back = whatever the caller wants handed to it then).
export async function startLogin(hs, { hint = '', back = {} } = {}) {
  const w = 480, h = 680;
  let win = null;
  try { win = window.open('', 'ember-auth', `popup=yes,width=${w},height=${h},left=${Math.max(0, Math.round(screenX + (outerWidth - w) / 2))},top=${Math.max(0, Math.round(screenY + (outerHeight - h) / 2))}`); } catch { /* blocked */ }
  const verifier = randomToken(32), state = randomToken(24);
  let challenge;
  try { challenge = await pkceChallenge(verifier); } catch (e) { try { win?.close(); } catch { /* fine */ } throw fail('failed', e?.message); }
  if (!win) {
    const redirect_uri = pageRedirectUri();
    writeJson(env.session, PENDING_KEY, { hs: slim(hs), verifier, state, redirect_uri, back: { hash: location.hash, ...back } });
    location.assign(authorizeUrl(hs, { redirect_uri, state, challenge, hint }));
    return new Promise(() => {}); // (the page is leaving)
  }
  const redirect_uri = popupRedirectUri();
  try { win.location.replace(authorizeUrl(hs, { redirect_uri, state, challenge, hint })); } catch (e) { try { win.close(); } catch { /* fine */ } throw e instanceof HomeserverError ? e : fail('failed', e?.message); }
  return new Promise((done, reject) => {
    // the callback page answers through window.opener, or (when the login page cut the opener off) a BroadcastChannel
    let chan = null, poll = null, giveUp = null, settled = false;
    const stop = () => { removeEventListener('message', onMsg); try { chan?.close(); } catch { /* fine */ } clearInterval(poll); clearTimeout(giveUp); };
    async function onMsg(ev) {
      let got;
      try { got = checkCallback(ev, { state }, location.origin); } catch (e) { stop(); try { win.close(); } catch { /* fine */ } if (!settled) { settled = true; reject(e); } return; }
      if (!got) return;
      stop();
      try { win.close(); } catch { /* fine */ }
      try { const s = await exchange(hs, { code: got.code, verifier, redirect_uri }); if (!settled) { settled = true; done(s); } } catch (e) { if (!settled) { settled = true; reject(e); } }
    }
    addEventListener('message', onMsg);
    try { chan = new BroadcastChannel('ember-auth'); chan.onmessage = onMsg; } catch { /* old browser */ }
    // closed without an answer: the caller hears "cancelled", but a late answer (opener cut off: `closed` lies) still signs in
    poll = setInterval(() => { let gone = false; try { gone = win.closed; } catch { /* fine */ } if (gone) { clearInterval(poll); setTimeout(() => { if (!settled) { settled = true; reject(fail('cancelled')); } }, 1500); } }, 500);
    giveUp = setTimeout(() => { stop(); if (!settled) { settled = true; reject(fail('cancelled')); } }, 15 * 60 * 1000);
  });
}

// Page load after a full-page sign-in: the address is <app>#/auth/callback?code=..&state=.. (or ?code=..&state=..#/auth/callback,
// depending on how the homeserver adds its answer). loc = { hash, search }. -> null (not a sign-in return) |
// { ok: true, session, back } | { error, back }
export const isCallbackHash = hash => /^#\/auth\/callback(\?|$)/.test(hash || '');
export async function handleCallback(loc = location) {
  const hash = String(loc.hash || ''), search = String(loc.search || '');
  if (!isCallbackHash(hash)) return null;
  const q = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : search.replace(/^\?/, ''));
  const pending = readJson(env.session, PENDING_KEY, null);
  writeJson(env.session, PENDING_KEY, null);
  const back = (pending && typeof pending.back === 'object' && pending.back) || {};
  const state = q.get('state'), code = q.get('code');
  if (!pending?.state || !pending.hs || !state || state !== pending.state) return { error: 'state', back };
  if (q.get('error')) return { error: q.get('error') === 'access_denied' ? 'declined' : 'failed', back };
  if (!code) return { error: 'failed', back };
  try { return { ok: true, session: await exchange(pending.hs, { code, verifier: pending.verifier, redirect_uri: pending.redirect_uri }), back }; } catch (e) { return { error: e?.code || 'failed', back }; }
}
