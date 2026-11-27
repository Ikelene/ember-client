// Talking to a homeserver about accounts (PROTOCOL §4a): your own sign-in methods, and its settings for the admins.
// A homeserver you are connected to as an instance is asked through the instance session (api.js); the one you signed in
// on the v2 way (homeserver.js) through homeFetch. The words for what comes back are in homeAdmin.js.
import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { registry } from './ids.js';
import { useChat } from './store.js';
import { homeFetch, getSession, sessions, popupRedirectUri, HomeserverError } from './homeserver.js';
import { useHomeSession } from './homeSessions.js';
import { checkLinkMessage } from './homeAdmin.js';

const NONE = [];
function refused(data, status) {
  const code = typeof data?.error === 'string' && data.error ? data.error : 'request_failed';
  return Object.assign(new Error(code), data && typeof data === 'object' ? data : {}, { error: code, status });
}
// JSON from the homeserver of a v2 session (origin: which one; the current one when left out). Throws like apiFetch does:
// an Error whose `error` is the server's code, with whatever else the server said
export async function homeJson(path, { origin, method = 'GET', body } = {}) {
  let res;
  try {
    res = await homeFetch(path, { ...(origin ? { origin } : {}), method, credentials: 'omit', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch (e) {
    if (e instanceof HomeserverError) throw Object.assign(new Error(e.code), { error: e.code, status: e.status ?? 0 });
    throw Object.assign(new Error('unreachable'), { error: 'unreachable', status: 0 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw refused(data, res.status);
  return data || {};
}
// a homeserver's API by origin: the instance session when it is connected, else the v2 session for it
export const viaInstance = origin => !!registry.get(origin)?.session;
export function hsCall(origin, path, { method = 'GET', body } = {}) {
  if (viaInstance(origin)) return apiFetch(path, { inst: origin, method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }).catch(e => { throw Object.assign(e, { error: e.error || e.message }); });
  return homeJson(path, { origin, method, body });
}
// the public discovery doc (who it is, the servers it lists, how many it has)
export async function discoveryDoc(origin) {
  try {
    const res = await fetch(`${origin}/.well-known/ember`, { headers: { Accept: 'application/json' }, credentials: 'omit' });
    const d = res.ok ? await res.json().catch(() => null) : null;
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
}

// ── where you are an admin ──
// v2 sessions on homeservers that aren't connected as instances: asked once each (GET /api/v1/me says instance_admin)
const asked = new Map(); // origin|account -> Promise<{ admin, owner }>
function adminOf(s) {
  const key = `${s.origin}|${s.account?.id || s.account?.username}`;
  if (!asked.has(key)) asked.set(key, homeJson('/api/v1/me', { origin: s.origin }).then(d => ({ admin: !!d.instance_admin, owner: !!d.instance_owner }), () => { asked.delete(key); return { admin: false, owner: false }; }));
  return asked.get(key);
}
const hostOf = origin => { try { return new URL(origin).host; } catch { return origin; } };
// -> [{ origin, domain, name, icon_url, isOwner, managed }]: every homeserver this device is signed in to as an admin or the owner
export function useAdminHomeservers() {
  const instances = useChat(s => s.instances || NONE);
  useHomeSession();
  const [homes, setHomes] = useState(NONE);
  const key = Object.values(sessions()).map(s => `${s.origin}|${s.account?.id}`).join();
  useEffect(() => {
    let live = true;
    Promise.all(Object.values(sessions()).map(s => adminOf(s).then(a => (a.admin || a.owner ? { origin: s.origin, domain: s.domain, name: s.name || s.domain, icon_url: s.icon_url || null, isOwner: a.owner, managed: null } : null))))
      .then(list => { if (live) setHomes(list.filter(Boolean)); });
    return () => { live = false; };
  }, [key]);
  const mine = instances.filter(i => i.isAdmin || i.isOwner).map(i => ({ origin: i.origin, domain: i.homeserver?.domain || hostOf(i.origin), name: i.homeserver?.name || i.name, icon_url: i.homeserver?.icon_url || i.icon || null, isOwner: !!i.isOwner, managed: i.managed || null }));
  return [...mine, ...homes.filter(h => !mine.some(m => m.origin === h.origin) && getSession(h.origin))];
}

// ── your own sign-in methods ──
export const loadLogins = origin => homeJson('/api/v2/account/logins', { origin }).then(d => (Array.isArray(d.logins) ? d.logins : []));
export const unlinkLogin = (origin, id) => homeJson(`/api/v2/account/logins/${encodeURIComponent(id)}`, { origin, method: 'DELETE' }).then(d => (Array.isArray(d.logins) ? d.logins : []));
// Link a login to the account: the homeserver hands out a one-time address that goes through the provider and comes back
// to auth/callback.html with ?linked= / ?link_error=. Call it straight from a click (the pop-up opens before anything is
// awaited; a blocked pop-up turns into a full-page trip). -> the method id; throws an Error whose `error` is the code
// ('cancelled', 'link_refused', the server's own)
export async function linkLogin(origin, id) {
  const w = 480, h = 680;
  let win = null;
  try { win = window.open('', 'ember-link', `popup=yes,width=${w},height=${h},left=${Math.max(0, Math.round(screenX + (outerWidth - w) / 2))},top=${Math.max(0, Math.round(screenY + (outerHeight - h) / 2))}`); } catch { /* blocked */ }
  const fail = code => Object.assign(new Error(code), { error: code });
  let url;
  try {
    // no pop-up: the whole page makes the trip and comes back to this address (Chat.jsx reads the answer on load)
    const d = await homeJson(`/login/link/${encodeURIComponent(id)}`, { origin, method: 'POST', body: { return_to: win ? popupRedirectUri() : `${location.origin}${location.pathname}${location.hash}` } });
    const u = new URL(String(d.url || ''));
    if (u.origin !== origin) throw fail('failed'); // the trip starts on the homeserver itself, nowhere else
    url = u.href;
  } catch (e) {
    try { win?.close(); } catch { /* fine */ }
    // the list loaded a moment ago, so a request that never arrives is the homeserver refusing this origin (CORS on /login/*), not the network
    throw e.error === 'unreachable' ? fail('link_refused') : e.error ? e : fail('failed');
  }
  if (!win) { location.assign(url); return new Promise(() => {}); } // (the page is leaving)
  try { win.location.replace(url); } catch { try { win.close(); } catch { /* fine */ } throw fail('failed'); }
  return new Promise((done, reject) => {
    let chan = null, poll = null, giveUp = null, settled = false;
    const stop = () => { removeEventListener('message', onMsg); try { chan?.close(); } catch { /* fine */ } clearInterval(poll); clearTimeout(giveUp); };
    const end = (err, val) => { if (settled) return; settled = true; stop(); if (err) reject(err); else done(val); };
    function onMsg(ev) {
      const got = checkLinkMessage(ev, location.origin);
      if (!got) return;
      try { win.close(); } catch { /* fine */ }
      if (got.error) end(fail(got.error)); else end(null, got.linked);
    }
    addEventListener('message', onMsg);
    try { chan = new BroadcastChannel('ember-auth'); chan.onmessage = ev => onMsg({ origin: location.origin, data: ev.data }); } catch { /* old browser */ }
    // closed without an answer: "cancelled" (the caller reads the list again anyway, in case the answer got lost)
    poll = setInterval(() => { let gone = false; try { gone = win.closed; } catch { /* fine */ } if (gone) { clearInterval(poll); setTimeout(() => end(fail('cancelled')), 1500); } }, 500);
    giveUp = setTimeout(() => end(fail('cancelled')), 15 * 60 * 1000);
  });
}
