// Ember on the web signs in with Nookara the way the apps do (PROTOCOL.md §2.5): the "approve this app" screen, then a token
// of its own (localStorage['ember_token']). The website's own session (velora_token) is never read or written here.
// The desktop / Android shells keep their own sign-in (store.js loginAgain); none of this runs for them.
import { clientPath, clientUrl, onEmberHost, AUTH_POPUP_URL, AUTH_ORIGINS } from './hosts.js';
import { getToken, isWebEmber } from '../api.js';
import { dropNookaraSessions } from './instances.js';
import { toast, stopKeepingMessages, getState } from './store.js';
import { forgetAccount as forgetKeptMessages } from './msgCache.js';
import { acctKey } from './ids.js';
import { EMBER_API, notifBridge } from '../compat.js';
import { DEFAULT_HOMESERVER, probeDefault, defaultProbe, startLogin, handleCallback, isCallbackHash, currentSession, signInWith, signOut as forgetHome, signOutAll as forgetHomes, signOutAccount as forgetHomeAccount } from './homeserver.js';

const STATE = 'ember_signin_state', BACK = 'ember_signin_back';
export const hasNookara = () => !!getToken();
const rand = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// "Sign in with Nookara": back = where to come back to (e.g. { add: 'http://host' } reopens the add-a-server dialog there)
// ember.nookara.cc never leaves for a site page: sign-in is a popup on nookara.cc that posts { type: 'nookara-auth', token, user } back
let popupListener = false;
function onAuthMessage(ev) {
  if (!AUTH_ORIGINS.includes(ev.origin)) return; // only nookara.cc (or the old velora.ikelene.net), never any other origin
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.type !== 'nookara-auth' || typeof d.token !== 'string' || !d.token) return;
  const name = typeof d.user === 'string' ? d.user : d.user && (d.user.username || d.user.name);
  try {
    localStorage.setItem('ember_token', d.token);
    if (name) { localStorage.setItem('ember_user', String(name)); rememberAccount(String(name), d.token, (d.user && d.user.pfp) || null); }
    localStorage.removeItem('ember_me_cache_v2');
    let back = {}; try { back = JSON.parse(sessionStorage.getItem(BACK) || '{}') || {}; sessionStorage.removeItem(BACK); } catch { /* none */ }
    history.replaceState(null, '', clientUrl(back.hash && !back.hash.startsWith('#/signin') ? back.hash : '#/home'));
  } catch { return; }
  location.reload(); // boots again, signed in
}
function popupSignIn(back) {
  if (!popupListener) { popupListener = true; addEventListener('message', onAuthMessage); }
  try { sessionStorage.setItem(BACK, JSON.stringify({ hash: location.hash, ...back })); } catch { /* fine */ }
  const w = 480, h = 640;
  const left = Math.max(0, Math.round(screenX + (outerWidth - w) / 2)), top = Math.max(0, Math.round(screenY + (outerHeight - h) / 2));
  let win = null;
  try { win = window.open(AUTH_POPUP_URL(), 'nookara-signin', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top); } catch { /* blocked */ }
  if (!win) {
    try { win = window.open(AUTH_POPUP_URL(), '_blank'); } catch { /* blocked */ }
    toast(win ? 'Your browser blocked the pop-up, so Nookara sign-in opened in a new tab.' : 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.');
  }
}
// Signing in starts on the default homeserver, nookara.cc. Until it answers Ember Protocol v2 (homeserver.js) that is the
// Nookara sign-in below, unchanged; once it does, the same button opens its login page like any other homeserver's -
// unless its accounts are Nookara accounts (homeserver.js signInWith): those keep signing in with Nookara.
// -> a promise while a homeserver login is open (the session, or null), nothing for the Nookara sign-in
export function startSignIn(back = {}) {
  if (!isWebEmber()) { startNookaraSignIn(back); return undefined; }
  const via = p => (p?.v2 ? signInOn(p.hs, { back }) : startNookaraSignIn(back));
  const known = defaultProbe();
  if (known) { if (known.error === 'unreachable') probeDefault(); return via(known); } // (answered already: the pop-up opens inside the click)
  return Promise.race([probeDefault(), new Promise(r => setTimeout(r, 2500))]).then(via);
}
// sign in on a homeserver that was looked up (the default one, or one typed in: nookara.cc, alice@nookara.cc, example.org)
export function signInOn(hs, { hint, back = {} } = {}) {
  if (signInWith(hs) === 'nookara') { startNookaraSignIn(back); return undefined; }
  return homeLogin(hs, { hint, back });
}
// open a homeserver's login page (hs from homeserver.js resolve) and say how it went. -> the session | null
export async function homeLogin(hs, { hint, back } = {}) {
  try {
    const s = await startLogin(hs, { hint, back });
    toast(`Signed in as ${s.account.handle}.`, true);
    adoptHomeSession(s, back);
    return s;
  } catch (e) {
    if (e?.code !== 'cancelled') toast(homeLoginText(e?.code, hs?.domain));
    return null;
  }
}
// Signed in through the pop-up (the gate, Add homeserver, Add account): when the app isn't running as a Nookara account and
// isn't already running as this one, start over as it, where the sign-in was asked from (the full-page trip does the same on its
// way back, Chat.jsx). Signed in with Nookara, the new session just joins the others (Settings > Homeservers, the switchers).
function adoptHomeSession(s, back) {
  if (getToken() || !s?.account) return;
  const running = getState().home;
  if (running && String(running.origin).toLowerCase() === String(s.origin).toLowerCase() && running.account?.handle === s.account.handle) return;
  const hash = back?.hash && !isCallbackHash(back.hash) && !back.hash.startsWith('#/signin') ? back.hash : '#/home';
  history.replaceState(null, '', clientUrl(hash));
  location.reload();
}
export const homeLoginText = (code, domain) => (code === 'declined' ? 'Sign-in was cancelled.' : code === 'state' ? SIGNIN_TEXT.state : code === 'unreachable' ? `Couldn't reach ${domain || 'the homeserver'} - try again.` : `Couldn't sign in${domain ? ` to ${domain}` : ''} - try again.`);
// page load: back from a homeserver's login page after a full-page trip (#/auth/callback, the pop-up was blocked)
// -> null | { ok, session, back } | { error, back }
let homeFinishing = null;
export const finishHomeLogin = () => (homeFinishing ||= (async () => {
  if (!isCallbackHash(location.hash)) return null;
  const run = handleCallback({ hash: location.hash, search: location.search });
  history.replaceState(null, '', clientUrl('#/home')); // the code leaves the address bar straight away
  const r = await run;
  if (r?.back?.hash && !isCallbackHash(r.back.hash) && !r.back.hash.startsWith('#/signin')) history.replaceState(null, '', clientUrl(r.back.hash));
  return r;
})());
// which sign-in this browser has: 'nookara' (the Nookara session everything Nookara-side runs on today), 'homeserver'
// (only a v2 homeserver session), or null. Both can exist; homeSession() is the v2 one either way.
export const homeSession = () => currentSession();
export const sessionKind = () => (getToken() ? 'nookara' : currentSession() ? 'homeserver' : null);
// the signed-in Nookara account's name as a handle (nookara.cc is its homeserver)
export const nookaraHandle = username => `${username}@${DEFAULT_HOMESERVER}`;
// sign out of a homeserver (its tokens are forgotten), or of all of them
// (the homeservers forget this device's pusher first, while the session can still ask them to: push.js)
export const signOutHome = origin => { const go = () => forgetHome(origin); return import('../push.js').then(p => p.dropPushers()).catch(() => {}).then(go, go); };
export const signOutHomes = () => forgetHomes();
// sign out of one account (several can share a homeserver): its pushers go only when it is the one the app runs as
export function signOutHomeAccount(s) {
  const go = () => forgetHomeAccount(s.key);
  return (s.active ? import('../push.js').then(p => p.dropPushers()).catch(() => {}) : Promise.resolve()).then(go, go);
}
function startNookaraSignIn(back = {}) {
  if (onEmberHost()) { popupSignIn(back); return; }
  if (!isWebEmber()) { location.href = `/login?next=${encodeURIComponent(clientPath())}`; return; }
  const state = rand();
  try { sessionStorage.setItem(STATE, state); sessionStorage.setItem(BACK, JSON.stringify({ hash: location.hash, ...back })); } catch { /* private mode: the state check will fail and say so */ }
  location.href = `${EMBER_API}/app-login?client=web&state=${state}`;
}
// page load: /chat#/signin?code=..&state=.. (or ?error=declined) -> null (not a sign-in return) | { ok, error, back }
let finishing = null; // (one run per page load, even if the page effect runs twice)
export const finishSignIn = () => (finishing ||= finish());
async function finish() {
  if (!isWebEmber() || !/^#\/signin(\?|$)/.test(location.hash)) return null;
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  let want = null, back = {};
  try { want = sessionStorage.getItem(STATE); back = JSON.parse(sessionStorage.getItem(BACK) || '{}') || {}; sessionStorage.removeItem(STATE); sessionStorage.removeItem(BACK); } catch { /* none */ }
  history.replaceState(null, '', clientUrl(back.hash && !back.hash.startsWith('#/signin') ? back.hash : '#/home'));
  const code = q.get('code'), state = q.get('state');
  if (q.get('error')) return { back, error: q.get('error') === 'declined' ? 'declined' : 'failed' };
  if (!code || !state || !want || state !== want) return { back, error: 'state' };
  try {
    const r = await fetch(`${EMBER_API}/app-exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) throw new Error(d.error || 'invalid_code');
    localStorage.setItem('ember_token', d.token);
    if (d.username) { localStorage.setItem('ember_user', d.username); rememberAccount(d.username, d.token, null); }
    return { back, ok: true };
  } catch { return { back, error: 'failed' }; }
}
// the Ember accounts signed in on this browser (the account switcher's list). Separate from the website's velora_saved:
// web Ember has tokens of its own.
const SAVED = 'ember_saved';
export function savedEmberAccounts() {
  try { const a = JSON.parse(localStorage.getItem(SAVED) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.username && x.token) : []; } catch { return []; }
}
export function rememberAccount(username, token, pfp) {
  try {
    if (!token || !username) return;
    const old = savedEmberAccounts();
    const keep = pfp || old.find(a => a.username.toLowerCase() === username.toLowerCase())?.pfp || null;
    const list = old.filter(a => a.username.toLowerCase() !== username.toLowerCase());
    list.unshift({ username, token, pfp: keep });
    localStorage.setItem(SAVED, JSON.stringify(list.slice(0, 10)));
  } catch { /* private mode */ }
}
export function forgetAccount(username) {
  try { localStorage.setItem(SAVED, JSON.stringify(savedEmberAccounts().filter(a => a.username.toLowerCase() !== username.toLowerCase()))); } catch { /* fine */ }
}
// switch this browser to a saved account: its token is checked first; a dead one is dropped from the list. Reloads on success.
export async function switchEmberAccount(a) {
  const r = await fetch(`${EMBER_API}/session`, { headers: { Authorization: `Bearer ${a.token}` } }).catch(() => null);
  if (!r) throw new Error('unreachable');
  if (r.status === 401 || r.status === 403) { forgetAccount(a.username); throw new Error('ended'); }
  if (!r.ok) throw new Error('unreachable');
  localStorage.setItem('ember_token', a.token);
  localStorage.setItem('ember_user', a.username);
  localStorage.removeItem('ember_me_cache_v2');
  history.replaceState(null, '', clientUrl('#/home'));
  location.reload();
}
export const SIGNIN_TEXT = { declined: 'Sign-in was cancelled.', state: "That sign-in didn't match this browser - try again.", failed: "Couldn't sign in with Nookara - try again." };

// forget Ember's Nookara sign-in (and the sessions it opened on Nookara-login servers) and start over signed out
export function endSession(notice) {
  // this account's kept messages (msgCache.js) go first: nothing new is written, the delete gets a moment before the reload
  stopKeepingMessages();
  const kept = Promise.race([forgetKeptMessages(acctKey('a')).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
  dropNookaraSessions(); // (while ember_user still says whose sessions they are)
  try { localStorage.removeItem(acctKey('ember_e2ee_unlocked')); } catch { /* fine */ } // (the keys go below, so this device isn't unlocked any more)
  try { indexedDB.deleteDatabase('nke1'); notifBridge()?.postMessage(JSON.stringify({ type: 'dm_key', kid: '', jwk: null })); } catch { /* */ } // this device's DM keys go too, it takes a PIN to read them again
  try { forgetAccount(localStorage.getItem('ember_user') || ''); localStorage.removeItem('ember_token'); localStorage.removeItem('ember_user'); localStorage.removeItem('ember_me_cache_v2'); if (notice) sessionStorage.setItem('ember_notice', notice); } catch { /* fine */ }
  history.replaceState(null, '', clientUrl('#/home'));
  kept.then(() => location.reload());
}
// Settings > Sign out: tell Nookara, drop Ember's token. The website's own session is untouched.
export async function signOutNookara() {
  const t = getToken();
  if (t) await fetch(`${EMBER_API}/sign-out`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } }).catch(() => {});
  endSession();
}
