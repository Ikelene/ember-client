// Display names (Nookara display-names.js): the name shown instead of the username, everywhere a person's name is drawn.
// The username stays the stable handle: mentions insert @username, menus / links / lookups still go by it.
//
// Where the name comes from:
//   - Ember servers (instances): the member / author object's own `display_name` (the server keeps it in step with Nookara;
//     for accounts made on the server itself it's simply their name). That is the server's word, so it wins.
//   - Nookara people (DMs, group chats, friends, profiles, Nookara people seen on an Ember server): the public profile's
//     `display_name`, read through the shared lookup cache in store.js in batches (like pronouns.js), and kept live by the
//     `user_update` event (Nookara sends display_name with every profile change).
// Webhooks, bridged people and bot aliases only ever have the name they came with.
import { useEffect, useState } from 'react';
// (store.js is loaded lazily: this file is also used by pure helpers that the node tests import, aliases.js)
const store = () => import('./store.js');

const vals = new Map();      // lowercase username -> display name ('' = none)
const subs = new Map();      // lowercase username -> Set of setState callbacks
const anySubs = new Set();   // callbacks for "some name changed" (lists that show many people)
const pending = new Set();
const queue = [];
let running = 0, flushTimer = null, listening = false;
const CONCURRENT = 2, BATCH = 100;

const key = n => String(n || '').toLowerCase();
const clean = v => (typeof v === 'string' ? v.trim() : '');
function put(k, v) {
  if (!k || vals.get(k) === v) return;
  vals.set(k, v);
  subs.get(k)?.forEach(fn => fn(v));
  anySubs.forEach(fn => fn());
}
// a public profile / user object from Nookara that carries display_name (null = they have none)
export function seedDisplayName(u) {
  if (!u || typeof u.username !== 'string' || !('display_name' in u)) return;
  put(key(u.username), clean(u.display_name));
}
export const seedDisplayNames = list => (list || []).forEach(seedDisplayName);

function pump() {
  if (flushTimer || running >= CONCURRENT || !queue.length) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const ks = queue.splice(0, BATCH);
    running++;
    store().then(s => s.lookupMany(ks)).then(got => ks.forEach(k => { const d = got.get(k); put(k, d ? clean(d.display_name) : (vals.get(k) ?? '')); }),
      () => ks.forEach(k => { if (!vals.has(k)) put(k, ''); }))
      .finally(() => { running--; ks.forEach(k => pending.delete(k)); pump(); });
  }, 25);
}
const SKIP = new Set(['system', 'nookara', 'unknown', '']);
function want(k) {
  if (!k || SKIP.has(k) || pending.has(k)) return;
  pending.add(k); queue.push(k); pump();
}
// ask for many names at once (a member list, the mention picker): only the ones not known yet
export function wantDisplayNames(usernames) { for (const n of usernames || []) { const k = key(n); if (k && !vals.has(k)) want(k); } }

function listen() {
  if (listening) return;
  listening = true;
  // Nookara's live profile event (store.js re-dispatches it as vc-user-update)
  addEventListener('vc-user-update', e => {
    const u = e.detail?.user;
    if (!u?.username) return;
    if (e.detail.previous_username) put(key(e.detail.previous_username), '');
    if ('display_name' in u) put(key(u.username), clean(u.display_name)); else want(key(u.username));
  });
  // your own edit (ProfileEditor) shows up straight away
  addEventListener('vc-profile-changed', e => {
    const k = key(e.detail?.username);
    if (!k) return;
    if (e.detail && 'display_name' in e.detail) { put(k, clean(e.detail.display_name)); return; }
    store().then(s => { s.forgetProfile(k); pending.delete(k); want(k); });
  });
}

// the Nookara display name for a username ('' = none, or not known yet). enabled=false: don't look it up
export function useDisplayName(username, enabled = true) {
  const k = enabled ? key(username) : '';
  const [v, setV] = useState(() => (k ? vals.get(k) || '' : ''));
  useEffect(() => {
    if (!k) { setV(''); return undefined; }
    listen();
    let set_ = subs.get(k);
    if (!set_) subs.set(k, (set_ = new Set()));
    set_.add(setV);
    setV(vals.get(k) || '');
    if (!vals.has(k)) want(k);
    return () => { set_.delete(setV); if (!set_.size) subs.delete(k); };
  }, [k]);
  return v;
}
// re-render when any known display name changes (for code that calls displayNameOf() over a list)
export function useDisplayNamesVersion() {
  const [n, setN] = useState(0);
  useEffect(() => { listen(); const fn = () => setN(x => x + 1); anySubs.add(fn); return () => { anySubs.delete(fn); }; }, []);
  return n;
}
// what's known right now, no lookup ('' = none / not known)
export const displayNameOf = username => vals.get(key(username)) || '';

// an Ember server's person object: members carry inst, message authors a kind (velora | local | bot); Nookara's own carry neither
const onServer = u => !!(u.inst || u.kind);
// Is this someone whose name belongs to an Ember server rather than Nookara? (a server-made account, a bot there, a webhook,
// a bridged person, an alias) - those never get a Nookara lookup by name.
export function serverOwnName(u) {
  if (!u) return true;
  if (u.webhook || u.name_only || u.bridge || u.alias_name) return true;
  if (onServer(u) && u.kind !== 'velora') return true;
  return false;
}
// the name to show. live = the Nookara display name ('' if none / not known)
export function personName(u, live = '') {
  if (!u) return '';
  if (u.alias_name) return u.alias_name;
  const own = clean(u.display_name);
  // on an Ember server the server's own name for the person wins (its nickname / display name), when it says one
  if (onServer(u) && own && own !== u.username) return own;
  if (!serverOwnName(u) && live) return live;
  if (own) return own;
  return u.username || '';
}
// hook: the name to show for a person object as Ember holds it (message author, member, DM partner { username }...)
export function useName(u) {
  const live = useDisplayName(u?.username, !!u && !serverOwnName(u));
  return personName(u, live);
}
// a name is "different" from the username: show "@username" as a subtitle next to it
export const showsHandle = (shown, u) => !!u?.username && !!shown && shown !== u.username;

// for tests
export function _reset() { vals.clear(); subs.clear(); anySubs.clear(); pending.clear(); queue.length = 0; }
export const _put = (username, v) => put(key(username), clean(v));

// a name as a component (renders plain text): <NameText u={author} fallback="Nookara" />
export function NameText({ u, fallback = '' }) { return useName(u) || fallback; }
