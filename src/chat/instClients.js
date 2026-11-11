// Which clients a member of an Ember server is connected with right now, as that server reports it (ember-server PROTOCOL §7.1).
// Only the person themselves and Manage users holders get an answer; for everyone else (and older servers) there is no data.
// A profile card watches the member while it is open (chat_clients_watch on the server's socket, live updates), with a one-off
// REST read when the socket is not up. Keyed by server origin + the member's id there (principal ids are only unique per server).
import { apiFetch } from '../api.js';
import { sendTo } from './instances.js';

const data = new Map();     // key -> { online, sessions, last_online } | null (not allowed / ended)
const watching = new Map(); // key -> { inst, server, uid, n }
const subs = new Set();
const keyOf = (inst, uid) => `${inst}\n${uid}`;
const bump = () => subs.forEach(fn => fn());
const clean = d => ({ online: !!d.online, sessions: Array.isArray(d.sessions) ? d.sessions.slice(0, 8) : [], last_online: Number(d.last_online) || null });

export const instClientsOf = (inst, uid) => data.get(keyOf(inst, String(uid)));
export const onInstClients = fn => { subs.add(fn); return () => subs.delete(fn); };

function ask(w) {
  if (sendTo(w.inst, { type: 'chat_clients_watch', server: w.server, user_id: w.uid, nonce: `clients:${w.uid}` })) return;
  // no socket right now: read it once (it is watched again when the socket comes back, rewatchInstClients)
  apiFetch(`/api/v1/servers/${encodeURIComponent(w.server)}/members/${encodeURIComponent(w.uid)}/clients`, { inst: w.inst })
    .then(d => { if (watching.has(keyOf(w.inst, w.uid))) { data.set(keyOf(w.inst, w.uid), clean(d)); bump(); } })
    .catch(e => { if (e?.status === 403 || e?.status === 404) { data.set(keyOf(w.inst, w.uid), null); bump(); } });
}
// start watching (server = that server's own sid, not namespaced); returns the stop function
export function watchInstClients(inst, server, uid) {
  uid = String(uid);
  const k = keyOf(inst, uid);
  const w = watching.get(k);
  if (w) w.n++;
  else { const nw = { inst, server: String(server), uid, n: 1 }; watching.set(k, nw); ask(nw); }
  return () => {
    const x = watching.get(k);
    if (!x || --x.n > 0) return;
    watching.delete(k);
    data.delete(k);
    sendTo(inst, { type: 'chat_clients_unwatch', server: x.server, user_id: uid });
  };
}
// the server's socket is (back) up: it forgot what this one watched
export function rewatchInstClients(inst) { for (const w of watching.values()) if (w.inst === inst) ask(w); }
// frames from instances.js: chat_clients, and chat_error for a watch
export function onInstClientsFrame(inst, m) {
  if (m.type === 'chat_clients') {
    const k = keyOf(inst, String(m.user_id));
    if (!watching.has(k)) return;
    data.set(k, m.ended ? null : clean(m));
    bump();
    return;
  }
  if (m.type === 'chat_error' && m.request === 'chat_clients_watch') {
    const uid = String(m.nonce || '').replace(/^clients:/, '');
    const k = keyOf(inst, uid);
    if (watching.has(k)) { data.set(k, null); bump(); }
  }
}
