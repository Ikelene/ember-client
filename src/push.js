// Browser push for Nookara (server side: webpush.js). One subscription per browser.
// On a v2 homeserver session (no Nookara sign-in) the same browser subscription goes to Nookara's push gateway instead
// (PROTOCOL 20): the gateway answers with a pushkey for this device, and every homeserver I'm signed in on gets a pusher with it.
import { apiFetch, getToken } from './api.js';
import { connections } from './chat/instances.js';
import { currentOrigin } from './chat/homeserver.js';
import { pushPlan } from './chat/social.js';
import { isHomeHost, NOOKARA_ORIGIN } from './chat/hosts.js';
import { EMBER_API } from './compat.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}
const b64ToBytes = b64 => {
  const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

// is THIS browser subscribed?
export async function browserSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return !!(reg && await reg.pushManager.getSubscription());
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser can't do notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for Nookara in your browser settings.' : 'You need to allow notifications.');
  const reg = await registration();
  const v2 = v2Session();
  const { publicKey } = v2 ? await gateway('/push/vapid') : await apiFetch('/push/vapid');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  if (v2) { await syncPushers(); return; } // (no Nookara account to subscribe: the homeservers push through the gateway)
  await apiFetch('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
}

// ── homeserver sessions: Nookara's push gateway and a pusher on each homeserver ──
export const PUSH_APP_ID = 'ember.web';
const PUSHKEY = 'ember_pushkey'; // localStorage: { endpoint, pushkey } - the gateway's key for this browser's subscription
const v2Session = () => !getToken() && !!currentOrigin();
// Nookara's site (the gateway, the VAPID key): this origin on nookara.cc / ember.nookara.cc, nookara.cc from anywhere else
const site = () => { try { return isHomeHost(location.hostname) || /^(localhost|127\.)/.test(location.hostname) ? '' : NOOKARA_ORIGIN; } catch { return NOOKARA_ORIGIN; } };
async function gateway(path, init) {
  const r = await fetch(`${site()}${path}`, { credentials: 'omit', ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'request_failed'), { status: r.status });
  return d;
}
// this device's pushkey: POST /_ember/push/v1/register { app_id, kind: 'webpush', target: { subscription } } -> { pushkey }
// (the same subscription always gets the same key). null when this browser has no subscription.
export async function devicePushkey() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return null;
  try { const had = JSON.parse(localStorage.getItem(PUSHKEY) || 'null'); if (had?.endpoint === sub.endpoint && had.pushkey) return had.pushkey; } catch { /* asked again */ }
  const d = await gateway('/_ember/push/v1/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: PUSH_APP_ID, kind: 'webpush', target: { subscription: sub.toJSON() } }) });
  if (typeof d.pushkey !== 'string' || !d.pushkey) return null;
  try { localStorage.setItem(PUSHKEY, JSON.stringify({ endpoint: sub.endpoint, pushkey: d.pushkey })); } catch { /* fine */ }
  return d.pushkey;
}
const deviceName = () => { const ua = navigator.userAgent; return `${/Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'}${/Android/.test(ua) ? ' on Android' : /iPhone|iPad/.test(ua) ? ' on iOS' : /Windows/.test(ua) ? ' on Windows' : /Mac OS X/.test(ua) ? ' on macOS' : /Linux/.test(ua) ? ' on Linux' : ''}`; };
// a pusher on every homeserver I'm signed in on that takes them (social.js pushPlan), and Nookara's relay push off for
// exactly those, so nothing is told twice. -> the origins that have a pusher now
const have = new Map(); // origin -> pushkey registered there (this page load)
let syncing = null;
export function syncPushers() {
  return (syncing ||= (async () => {
    if (!v2Session()) return [];
    const pushkey = await devicePushkey().catch(() => null);
    const instances = [...connections.values()].map(c => ({ origin: c.origin, info: c.info, signedIn: !!c.session && !!c.source, relayPush: !!getToken() && !!c.prefs && c.prefs.push !== false }));
    const plan = pushPlan({ v2: true, pushkey, instances });
    for (const r of plan.register) {
      if (have.get(r.origin) === pushkey) continue;
      try { await apiFetch(new URL(r.url).pathname, { inst: r.origin, method: 'POST', body: JSON.stringify({ app_id: PUSH_APP_ID, pushkey, device_name: deviceName() }) }); have.set(r.origin, pushkey); } catch { /* next time it connects */ }
    }
    const done = [...have.keys()];
    for (const origin of pushPlan({ v2: true, pushkey, instances, registered: done }).relayOff) {
      const c = connections.get(origin);
      try { await apiFetch(`${EMBER_API}/instances/prefs`, { method: 'PATCH', body: JSON.stringify({ url: origin, push: false }) }); if (c) c.prefs = { ...c.prefs, push: false }; } catch { /* stays on: twice is better than never */ }
    }
    return done;
  })().finally(() => { syncing = null; }));
}
// signing out: the homeservers forget this device (PROTOCOL 20: "a client removes its pusher when it signs out")
export async function dropPushers() {
  let pushkey = null;
  try { pushkey = JSON.parse(localStorage.getItem(PUSHKEY) || 'null')?.pushkey || null; } catch { /* none */ }
  if (!pushkey) return;
  const gone = [...connections.values()].filter(c => c.session && c.source).map(c => apiFetch(`/api/v2/pushers/${encodeURIComponent(pushkey)}`, { inst: c.origin, method: 'DELETE' }).catch(() => {}));
  have.clear();
  await Promise.race([Promise.all(gone), new Promise(r => setTimeout(r, 2000))]);
}
// a homeserver's socket came up (instances.js): it gets its pusher
let syncT = null;
if (typeof window !== 'undefined') addEventListener('ember-hs-ready', () => { clearTimeout(syncT); syncT = setTimeout(() => { syncPushers().catch(() => {}); }, 1500); });

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  if (v2Session()) { await dropPushers(); try { localStorage.removeItem(PUSHKEY); } catch { /* fine */ } }
  else await apiFetch('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}
