// Ember's state + its connection (one Nookara socket when signed in with Nookara, the /chat, /im and /groups APIs, and one socket per server instance).
// Components read it with useChat(selector) and change it through the actions below.
import { shareLink, clientUrl, notifLinkUrl, EMBER_ORIGIN, NOOKARA_ORIGIN } from './hosts.js';
import { serverUnreadCount } from './unread.js';
import { shortLinkFor } from './shortLinks.js';
import { loadPersonalEmojis, setStickers } from './personal.js';
import { packActive, playPackSound } from './messageSounds.js';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import serverCreationPolicy from '../server-creation-policy.json';
import { apiFetch, getToken, onScopeError, onAuthLost, isWebEmber, uploadFetch, uploadInPieces, PIECES_OVER } from '../api.js';
import { endSession, startSignIn } from './session.js';
import * as E2EE from './e2ee/session.js';
import { fileKindOfMime } from './e2ee/files.js';
import { sendOrHold, flushHeld, firstLink, parseOg, cleanPreview, memberIds } from './e2ee/homedm.js';
import { rememberedDest, TEMP_LINK, tempId } from './upload-dest.js';
import { callLinePlain } from './callText.js';
import { applyIdentity, applyNick } from './identity.js';
import { applyUserUpdate, instancesWithAccount } from './userUpdate.js';
import { findPending, dropSettled, wireText, settle } from './pending.js';
import { NOOKARA, K, parseK, instOf, bare, isInst, normOrigin, acctKey } from './ids.js';
import { parseAddress, addressHash, inviteUrl, inviteBase, parseProtocolLink, openRouteLink, serverOfInst, routeAddress, addressRoute, createErrorText } from './addresses.js';
import { setInviteHomes } from './inviteLink.js';
import { myIdOn } from './tokens.js';
import { readChannel as readMsgCache, writeChannel as writeMsgCache, dropChannels as dropMsgCache } from './msgCache.js';
import { connections, sendTo, startInstances, loadInstanceData, retryInstances, resumeInstances, renewNookaraSession, holdInstances, forgetIfEmpty, wakeInstance, instanceWoke, recheckSleepers, joinByAddress, ensureHost, resolveAddress } from './instances.js';
import { movedHome, hostedSlug } from './moved.js';
import { homeFetch, onSignedOut, currentSession, sessions as homeSessions, DEFAULT_HOMESERVER, resolve as resolveHomeserver, homeInfo, remoteToken, isOwnUrl, domainReportsUrl } from './homeserver.js';
import { reportRoute, reportBody, canReportSealed } from './e2ee/report.js';
import { social as socialApi, socialBase, socialFetch, createDm, setNookaraSocial, dmHostUrl } from './socialApi.js';
import { emptySocial, friendLists, mergeDms, cleanDm, socialReduce, socialRefetch, dmTitle, splitHandle, stableId, cleanHandle, accountName, remoteFriendLists, splitNookaraDms, nookaraDmView, dmHandle, listPresence } from './social.js';
import { attachmentRefs } from './signing-payload.js';
import { spoilerName } from './spoiler.js';
import { prepareInstanceAttachments } from './attachment-preparation.js';
import { setupSigning, signMessage, canSign, watchSignature, normBody, refreshSigningKey } from './signing.js';
import { SHORT } from '../version.js';
import { EMBER_API, NOOKARA_WIRE, isNookara, nookaraId, NOOKARA_ID_FIELD, OLD_EMBER_UPDATE, legacyToNew, desktopBridge, NOTIFICATION_ACTION_EVENT, SITE_SAVED } from '../compat.js';

let state = {
  me: null,                // { username, pfp, color, rank } - null while signed out of Nookara (web Ember works without it)
  e2eeStatus: 'loading',   // end-to-end encrypted DMs on this device: loading | none (no keys yet) | locked | ready
  e2eeGate: null,          // the set up / unlock popup is open
  e2eeKeyChanged: {},      // username (lower) -> their key changed since I last saw it
  botPeers: {},            // username (lower) -> true: a bot account. DMs with bots are never encrypted (bots can't hold keys)
  signedIn: false,         // signed in with Nookara: DMs, groups, friends, modmail, legacy servers, Nookara-login instances
  home: null,              // signed in on a v2 homeserver instead (no Nookara sign-in): { origin, domain, id, account }. `me` is that account
  social: emptySocial(),   // the home homeserver's friends and DMs (social.js): { loaded, friends, incoming, outgoing, blocked, dms, presence }
                           // (signed in with Nookara: only the people and DMs on OTHER homeservers - Nookara's own are friends / dms / groups below)
  nkHome: null,            // signed in with Nookara: my Nookara account as other homeservers know it { origin, domain, id, nookara: true }
  conn: 'connecting',      // connecting | open | closed
  connected: false,        // the home socket has been open at least once since the page loaded
  connRetryAt: 0,          // closed: when the next try is (it never gives up)
  servers: [],             // my servers
  detail: {},              // sid -> { server, channels }
  members: {},             // sid -> [member]
  membersMore: {},         // sid -> next offset, for a big Nookara-hosted server whose member list comes in pages (absent: all loaded)
  presence: {},            // username -> { status, custom, activities }
  presenceReady: false,    // the first presence_bulk came in
  people: {},              // username -> { username, pfp, color, rank }
  msgs: {},                // key -> { list, hasMore, loading, loaded }
  typing: {},              // key -> { username: until }
  statusReplyDraft: null,  // { username, text }: the next DM to that person answers their custom status
  dms: [],                 // IM conversations
  groups: [],              // group chats
  friends: [],
  friendsLoaded: false,     // /friends answered once (Home shows "No friends yet" only after)
  blocks: null, // people I blocked ({username, ...}); null until loaded
  unread: {},              // key -> true
  modmail: { messages: [], unread: 0 }, // Nookara Moderator Chat (to me)
  staff: false,            // Nookara owner / admin: can write as Nookara Administrator
  view: { kind: 'home' },  // home | channel {sid, cid} | dm {username} | group {room} | instance {inst, then?} (a server that isn't connected yet)
  menu: null,              // the open right-click menu
  commands: {},            // sid -> { bots, commands, cid }: bot slash commands I can run
  interactionModal: null,  // a form a bot asked me to fill: { server, channel, interaction, modal }
  savedMedia: null,
  emojis: null,            // custom emojis from my servers: [{ sid, name, icon, emojis: [...] }]        // Saved Media (starred GIFs + files on the account), loaded on first use
  mentions: {},            // cid -> mentions that came in live (on top of the server's count)
  unreadN: {},             // cid -> { sid, n }: messages that came in live while you weren't looking (on top of the server's unread_count)
  srvMentions: {},         // sid -> the same, per server
  notify: {},              // target (cid / sid) -> { level, muted_until, push }
  toastOk: false,
  settings: { show_typing: true, share_typing: true, share_activity: true, sounds: true, notify_sound: 'short', notifications: 'mentions', dm_privacy: 'everyone', compact: false, animations: true, link_images: true, link_previews: true, developer_mode: false, allow_vc_calls: true, yt_mode: 'ask', dm_upload_dest: 'ask', sleep_servers: true, radio_enabled: false, radio_url: 'https://www.clubfmserver.be/pink.mp3', strip_tracking: null, lock_emojis: false },
  lastCid: {},             // sid -> cid
  error: null,
  voice: null,             // the voice channel / call I'm in: { room, info, status, users, muted, deafened, speaking, ringing }
  voiceStates: {},         // cid -> [{ username, muted, deafened }] - who's in each voice channel
  dmCalls: {},             // username (lower) -> { room, users, with } - calls going on with people
  dmCallWith: {},          // call room -> the other person
  incoming: [],            // calls ringing me: [{ callId, from, room }]
  pinsVersion: {},         // cid, d:<name> or g:<room> -> bumped when its pins change
  voicePrefs: null,
  permUpdate: null,        // "New permission updates" dialog: { version, legacy, missing: [{id, name, reason}] }
  scopePrompt: null,       // "This needs a new permission" card: { name, reason }
  scopeLack: null,         // scopes this login can't use: { ACCOUNT_WRITE: 'missing' | 'disabled' } (null = website session / not loaded = everything works)
  reauth: null,            // after "Log in again": { state: waiting | working | failed, error }
  locked: false,           // Ember and DMs are off for this account: the whole app is the notice (Gate.jsx LockedScreen)
  lockReason: null,        // why (Nookara's restriction_reason): 'staff' | 'birthday_required' (no birthday set yet) | 'under_minimum_age'
  instances: [],           // the instances I'm on: [{ origin, name, icon, mode, status, claimed, isAdmin, isOwner, user }]
  signing: null,           // this device's signing key: { state: ready | no_scope | unsupported | revoked | error, kid }
  sigs: {},                // signed message -> 'ok' | 'bad' (checked here, never taken from the instance)
  joinRequests: {},        // sid -> people waiting to be let in (live count)
  reports: {},             // sid -> open reports (live count, moderators of an instance)
  nookaraNames: {},         // Nookara id -> current username (instance members are v:<id>; their presence comes from the home socket by name)
  nookaraFaces: {},         // Nookara id -> their live public face on Nookara { id, username, pfp, color, rank } (v: people on instances)
  emojiUrls: {},
  personalEmojis: null,    // { list, max, pro_max }: my personal emojis (personal.js)
  personalStickers: null,  // { list, max, pro_max }: my personal stickers (personal.js)
  stickers: {},            // sid -> { list, max }: an Ember server's stickers (personal.js)           // eid -> picture of an instance's custom emoji
  notifUnread: 0,          // Nookara notifications not read yet (the bell's badge)
  homeRequests: 0,         // friend requests + message requests waiting for me (the Home button's count)
  notifs: null,            // the bell's popup while it's open: { list (unread only, newest first), cursor, loading, error }
};
const subs = new Set();
let desktopFocused = true;
const desktopActions = new Map();
function onceDesktopAction(action) {
  const key = `${action?.type || ''}:${action?.callId || action?.tag || action?.to || ''}:${action?.action || ''}:${action?.text || ''}`;
  const now = Date.now();
  for (const [k, t] of desktopActions) if (now - t > 5000) desktopActions.delete(k);
  if (desktopActions.has(key)) return false;
  desktopActions.set(key, now);
  return true;
}
const pageFocused = () => document.visibilityState === 'visible' && (desktopBridge()?.isDesktop ? desktopFocused : document.hasFocus());
function set(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  subs.forEach(f => f());
}
const subscribe = f => { subs.add(f); return () => subs.delete(f); };
// the homeservers this device uses: their invite links (by address) show as invite cards (inviteLink.js addressInviteRef)
let homesOf = null;
subs.add(() => {
  if (state.instances === homesOf) return;
  homesOf = state.instances;
  setInviteHomes((homesOf || []).filter(i => i.v2).map(i => { const domain = i.homeserver?.domain || i.host; return { domain, bases: [inviteBase(domain, i.invites), `${i.origin}/i/`] }; }));
});
export const getState = () => state;
// a custom emoji's picture: an instance's own (from its emoji list), else Nookara's
// an emoji Ember doesn't know yet is looked for on Nookara (personal emojis and Nookara servers' emojis live there);
// CustomEmojiImg (text.jsx) then tries the Ember server the message is on (emojis a bridge brought in from Discord / Fluxer)
export const customEmoji = (eid, animated) => state.emojiUrls[eid] || `/uploads/emojis/${eid}.${animated ? 'gif' : 'png'}`;
export const patchState = p => set(p);
// Ember desktop: games' Discord rich presence (captured by the app) becomes your status, tied to this socket
let rpcNow = null;
if (typeof window !== 'undefined' && desktopBridge()?.onRpcActivity) {
  const apply = a => {
    rpcNow = a || null;
    if (rpcNow) send({ type: 'set_rich_presence', activity: { ...rpcNow, app: rpcNow.app || 'Discord RPC' } });
    else send({ type: 'clear_rich_presence' });
  };
  desktopBridge().onRpcActivity(apply);
  desktopBridge().onRpcStatus(s => set({ rpcStatus: s }));
  desktopBridge().rpcState?.().then(s => { set({ rpcStatus: s }); if (s.activity) apply(s.activity); }).catch(() => {});
}
export function useChat(sel = s => s) {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ── keys for a conversation ──
export const keyOf = v => (v.kind === 'channel' ? `c:${v.cid}` : v.kind === 'dm' ? `d:${String(v.username).toLowerCase()}` : v.kind === 'group' ? `g:${v.room}` : v.kind === 'modmail' ? `mm:${String(v.username || '').toLowerCase()}` : v.kind === 'notes' ? 'n:' : '');
const upd = (obj, k, fn) => ({ ...obj, [k]: fn(obj[k]) });

// timeouts on an instance (Server settings > AutoMod, or a moderator): no posting, reacting, voice or sounds until then
export const untilText = t => { const d = new Date(t); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export function timedOutIn(sid, st = state) { const t = sid && st.detail[sid]?.server?.timeout_until; return t && t > Date.now() ? t : null; }
export function useTimedOut(sid) {
  const until = useChat(s => (sid ? s.detail[sid]?.server?.timeout_until : null) || null);
  const [, tick] = useState(0);
  useEffect(() => { if (!until || until <= Date.now()) return undefined; const t = setTimeout(() => tick(x => x + 1), Math.min(until - Date.now() + 100, 2147483647)); return () => clearTimeout(t); }, [until]);
  return until && until > Date.now() ? until : null;
}

// ── people / presence ──
export function remember(list) {
  const add = {};
  for (const p of list) if (p?.username) add[p.username] = { ...(state.people[p.username] || {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  if (Object.keys(add).length) set(s => ({ people: { ...s.people, ...add } }));
}
const lookups = new Map();
// public profiles are cached for 5 minutes: an edit still shows at once (Nookara sends user_update, which clears this)
const LOOKUP_MS = 5 * 60 * 1000, LOOKUP_BATCH = 100;
// a public Nookara endpoint (no token): what signed-out Ember may still ask Nookara for (public profiles)
const publicJson = path => fetch(path).then(r => r.json().then(d => (r.ok ? d : Promise.reject(Object.assign(new Error(d.error || 'request_failed'), { status: r.status })))));
const faceOfProfile = d => ({ id: d.id != null ? String(d.id) : undefined, username: d.username, pfp: d.pfp_url || null, color: d.color || null, rank: d.rank });
export function lookup(username) { // the public profile (cached for 5 minutes)
  const k = String(username).toLowerCase();
  const hit = lookups.get(k);
  if (hit && Date.now() - hit.at < LOOKUP_MS) return hit.p;
  const path = `/account/lookup/${encodeURIComponent(username)}`;
  const p = (getToken() ? apiFetch(path) : publicJson(path)).then(d => {
    remember([faceOfProfile(d)]);
    return d;
  });
  p.catch(() => lookups.delete(k));
  lookups.set(k, { at: Date.now(), p });
  return p;
}
// many public profiles in as few requests as possible (GET /account/lookup?u=a,b,c - up to 100 per request), into the
// same cache as lookup(). -> Map(lower-case username -> profile); names that don't exist (or are hidden) are left out.
export async function lookupMany(usernames) {
  const out = new Map(), ask = [];
  for (const n of new Set((usernames || []).map(x => String(x || '').trim()).filter(Boolean))) {
    const k = n.toLowerCase(), hit = lookups.get(k);
    if (hit && Date.now() - hit.at < LOOKUP_MS) out.set(k, hit.p); else ask.push(n);
  }
  for (let i = 0; i < ask.length; i += LOOKUP_BATCH) {
    const chunk = ask.slice(i, i + LOOKUP_BATCH);
    const path = `/account/lookup?u=${chunk.map(encodeURIComponent).join(',')}`;
    const batch = (getToken() ? apiFetch(path) : publicJson(path)).then(d => {
      const users = d?.users || [];
      remember(users.map(faceOfProfile));
      return new Map(users.map(u => [String(u.username).toLowerCase(), u]));
    });
    for (const n of chunk) {
      const k = n.toLowerCase();
      const p = batch.then(m => m.get(k) || Promise.reject(Object.assign(new Error('not_found'), { status: 404 })));
      p.catch(() => lookups.delete(k));
      lookups.set(k, { at: Date.now(), p });
      out.set(k, p);
    }
  }
  const done = new Map();
  await Promise.all([...out].map(([k, p]) => p.then(d => { done.set(k, d); }, () => {})));
  return done;
}
// Nookara people on an instance server (v:<id>) show their live Nookara face - picture, accent colour, rank - like on Nookara's own
// servers. By id when signed in (/chat/identities), else by the name the instance knows, through the public profile (kept
// only if Nookara says it's the same id). The instance's stored picture is only the fallback. Local accounts never get one.
const faceAsked = new Map(); // id -> when
let faceQueue = new Map(), faceTimer = null;
export function wantNookaraFaces(people) {
  for (const u of people || []) {
    const id = String(nookaraId(u) || '');
    if (!isNookara(u?.kind) || !/^[1-9]\d{0,19}$/.test(id) || Date.now() - (faceAsked.get(id) || 0) < 300000) continue;
    faceAsked.set(id, Date.now()); faceQueue.set(id, u.username);
  }
  if (faceQueue.size && !faceTimer) faceTimer = setTimeout(flushFaces, 60);
}
async function flushFaces() {
  const q = faceQueue; faceQueue = new Map(); faceTimer = null;
  const got = {};
  const ids = [...q.keys()];
  if (getToken()) {
    for (let i = 0; i < ids.length; i += 200) {
      const r = await apiFetch(`/chat/identities?ids=${ids.slice(i, i + 200).join(',')}`).catch(() => null);
      for (const u of r?.users || []) if (u.username) got[u.id] = u;
    }
  } else {
    const found = await lookupMany(ids.slice(0, 100).map(id => q.get(id))).catch(() => new Map());
    for (const id of ids.slice(0, 100)) { const d = found.get(String(q.get(id) || '').toLowerCase()); if (d && String(d.id) === id) got[id] = { id, username: d.username, pfp: d.pfp_url || null, color: d.color || null, rank: d.rank }; }
  }
  for (const id of ids) if (!got[id]) got[id] = { id, miss: true }; // nobody to show: stop holding their name colour back
  if (Object.keys(got).length) set(s => ({ nookaraFaces: { ...s.nookaraFaces, ...got }, nookaraNames: { ...s.nookaraNames, ...Object.fromEntries(Object.entries(got).filter(([, u]) => !u.miss).map(([id, u]) => [id, u.username])) } }));
}
// someone as shown in an instance server: a Nookara person with their Nookara face, a local account with the picture it set on that
// server (account profiles), a bot as plain. Nookara's own servers already carry the live face.
// what Ember uses of a server profile: a #rrggbb colour, http(s) pictures, plain text (the server should send just that; this makes sure)
const httpUrl = v => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
export function cleanServerProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : null);
  const out = { pfp: httpUrl(p.pfp), banner: httpUrl(p.banner), color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : null, bio: str(p.bio, 300), pronouns: str(p.pronouns, 40) };
  return Object.values(out).some(Boolean) ? out : null;
}
// someone's look on their Ember server only (server profiles: the member's `profile`), by their id there. One index per member list
const serverProfiles = new WeakMap();
// (a homeserver with several servers: the one on screen when it is one of them, else the first I'm in)
const instMembers = (inst, s) => { const v = s.view?.sid; const sid = v && instOf(v) === inst && s.members?.[v] ? v : (s.servers || []).find(x => x.inst === inst)?.sid; return sid ? s.members?.[sid] || null : null; }; // (some callers pass a partial state)
export function serverProfileOf(u, s = state) {
  if (!u?.inst || u.inst === NOOKARA || u.id == null) return null;
  const list = instMembers(u.inst, s);
  if (!list) return null;
  let idx = serverProfiles.get(list);
  if (!idx) { idx = new Map(list.filter(m => m.profile).map(m => [String(m.id), cleanServerProfile(m.profile)])); serverProfiles.set(list, idx); }
  return idx.get(String(u.id)) || null;
}
export function faceOf(u, s = state) {
  if (!u || !u.inst || u.inst === NOOKARA) return u;
  const sp = serverProfileOf(u, s);
  let out;
  if (u.kind === 'local') out = { ...u, pfp: httpUrl(u.pfp), color: null }; // (its picture is the one it set on that server: account profiles)
  else {
    const f = isNookara(u.kind) ? s.nookaraFaces[String(nookaraId(u))] : null;
    out = f && !f.miss ? { ...u, pfp: f.pfp || u.pfp || null, color: f.color || null, rank: f.rank } : u;
  }
  return sp ? { ...out, pfp: sp.pfp || out.pfp, color: sp.color || out.color } : out;
}
export const useFace = u => {
  const f = useChat(s => (u?.inst && isNookara(u.kind) ? s.nookaraFaces[String(nookaraId(u))] : null));
  const ml = useChat(s => (u?.inst && u.inst !== NOOKARA ? instMembers(u.inst, s) : null)); // (their server profile can change)
  return useMemo(() => faceOf(u), [u, f, ml]); // eslint-disable-line react-hooks/exhaustive-deps
};
// a profile card / page that is open re-reads its person when Nookara says they changed (user_update); fn(event) -> unsubscribe
export const onUserUpdate = fn => { const h = e => fn(e.detail); addEventListener('vc-user-update', h); return () => removeEventListener('vc-user-update', h); };
// drop the cached public profile (after you edit your own), so the next lookup is fresh
export function forgetProfile(username) { lookups.delete(String(username || '').toLowerCase()); }
export function wantPresence(username) {
  if (username) watched.add(username);
  if (!username || state.presence[username]) return;
  send({ type: 'chat_presence', username });
}
// Nookara only sends presence to the people who can see it (friends, DMs, groups, small shared servers) and to the
// sockets that asked about someone: ask for a whole list at once (one chat_presence_watch per 200, answered by one
// presence_bulk), and again after every reconnect so the lists we show stay live.
const watched = new Set();
export function watchPresence(usernames) {
  const fresh = [...new Set((usernames || []).filter(Boolean))].filter(n => !watched.has(n));
  fresh.forEach(n => watched.add(n));
  for (let i = 0; i < fresh.length; i += 200) send({ type: 'chat_presence_watch', usernames: fresh.slice(i, i + 200) });
}
function rewatchPresence() {
  const me = state.me?.username;
  const names = [...new Set([...watched, ...Object.keys(state.presence)])].filter(n => n && n !== me).slice(-1000);
  for (let i = 0; i < names.length; i += 200) send({ type: 'chat_presence_watch', usernames: names.slice(i, i + 200) });
}
// Spotify's `progress` is sampled by the server, but the clock that advances
// it must begin on this device when the presence payload arrives. Using the
// server wall clock here makes even a small clock skew look like 5-second jumps.
function localizePresence(presence) {
  // online only on the website or in a game signed in with Nookara, not connected with Ember: offline here (Nookara sends `chat`)
  if (presence && presence.chat === false && presence.status !== 'offline') return { ...presence, status: 'offline', auto_idle: false, mobile: false, console: false, custom: null, activities: [] };
  if (!presence?.activities?.length) return presence;
  const receivedAt = Date.now();
  return { ...presence, activities: presence.activities.map(a => (a?.app === 'Spotify' && Number.isFinite(Number(a.progress)) ? { ...a, progress_at: receivedAt } : a)) };
}

// ── the socket ──
let sock = null, retry = 0, nonce = 0;
const pendingAcks = new Map(); // nonce -> key
let lastEmberActivity = 0;
// Keep other devices quiet for ten minutes after actual use of Ember.  This
// is intentionally not the socket's 25-second keepalive: a suspended or
// backgrounded tab must not pretend that the user is still here.
function noteEmberActivity() {
  const now = Date.now();
  if (now - lastEmberActivity < 30000) return;
  if (send({ type: 'chat_active' })) lastEmberActivity = now;
}
// a frame about an instance's community / channel / voice room goes to that instance's socket, with the bare ids
function routeFrame(obj) {
  let inst = null, out = obj;
  for (const f of ['channel', 'server', 'sid', 'room']) {
    const v = obj[f];
    if (typeof v !== 'string') continue;
    const bf = f === 'room' && v.startsWith('bf_');
    const p = parseK(bf ? v.slice(3) : v);
    if (p.inst === NOOKARA) continue;
    if (inst && inst !== p.inst) return null;
    inst = p.inst;
    out = { ...out, [f]: bf ? `bf_${p.id}` : p.id };
  }
  return { inst: inst || NOOKARA, obj: out };
}
export function send(obj) {
  const r = routeFrame(obj);
  if (!r) return false;
  if (r.inst !== NOOKARA) return sendTo(r.inst, r.obj);
  if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
  return false;
}
export function sendBinary(buf) {
  if (sock && sock.readyState === 1 && sock.bufferedAmount < 256 * 1024) sock.send(buf);
}
// voice.js listens here (voice JSON, calls, who's in which voice channel, and the audio frames)
let voiceHook = null;
export const onVoiceEvent = fn => { voiceHook = fn; };
const VOICE_EVENTS = new Set(['voice', 'voice_open', 'voice_closed', 'voice_call_incoming', 'voice_call_ringing', 'voice_call_answered', 'voice_call_accepted', 'voice_call_failed', 'voice_call_ended', 'chat_voice_state', 'chat_call_state', 'voice_sound', 'voice_sound_failed', 'chat_rtc_joined', 'chat_rtc_published', 'chat_rtc_offer', 'chat_rtc_ready', 'chat_rtc_room', 'chat_rtc_resumed', 'chat_rtc_left']);
// is this a phone (or tablet)? -> the socket says mobile: true and people see the phone mark next to you.
// 1. the desktop app is never mobile
// 2. Chromium's Client Hints say so (navigator.userAgentData.mobile) -> mobile
// 3. a phone user agent (iPhone / iPod / "Android ... Mobile" / "Mobi") -> mobile
// 4. an Android tablet / iPad (also iPadOS Safari's Mac-looking UA with touch) only counts with a touch-first
//    pointer, as the tiebreak. The window width alone never decides it (a narrow desktop window isn't a phone).
// The Android app (a WebView) is detected by the same rules.
export function isMobileDevice() {
  try {
    if (desktopBridge()?.isDesktop) return false;
    if (navigator.userAgentData?.mobile === true) return true;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod|Android.*Mobile|Mobi|Windows Phone/i.test(ua)) return true;
    const tablet = /Android|iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return tablet && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch { return false; }
}
// never gives up: backoff to ~30 s (with jitter), and straight away when the network / tab comes back. A dropped
// connection never signs anyone out - only Nookara rejecting the token does (auth_error invalid_token, a 401, `kicked`).
export const backoff = n => Math.min(30000, 1000 * 2 ** Math.min(n, 5)) * (0.8 + Math.random() * 0.4);
let sockTimer = null;
// Phones (Ikelene 2026-11-22): after a while in another app the socket is often stuck - still "connecting" (started while the app
// was asleep) or "open" but dead - and Ember used to wait for the OS to give up on it, which could take minutes. Now a connect
// that hasn't opened in CONNECT_TIMEOUT is dropped and retried, and coming back to the app checks the socket (resumeSocket).
const CONNECT_TIMEOUT = 8000;
let sockStarted = 0, lastHeard = 0, probeTimer = null;
// throw a stuck / dead socket away and connect again right now
function dropSocket() {
  const old = sock;
  clearTimeout(probeTimer); probeTimer = null;
  if (old) {
    sock = null; // (its onclose then does nothing: it's not the current socket any more)
    try { old.close(); } catch { /* already gone */ }
    if (old.readyState !== 0) voiceHook?.({ type: 'voice_closed', dropped: true });
  }
  set({ conn: 'closed' });
  retry = 0; connect();
}
export function connect() {
  clearTimeout(sockTimer); sockTimer = null;
  if (sock && sock.readyState <= 1) return;
  if (!getToken()) return;
  set({ conn: 'connecting', connRetryAt: 0 });
  // (`npm run dev`: the page's own root is vite's hot-reload socket, so Nookara's is reached through the /ws proxy in vite.config.js)
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${import.meta.env?.DEV ? '/ws' : ''}`);
  sock = s;
  sockStarted = Date.now();
  // never opened: let it go and run its close handling ourselves (the normal retry with backoff), not waiting on the browser to
  setTimeout(() => { if (sock === s && s.readyState === 0) { const closed = s.onclose; s.onclose = null; try { s.close(); } catch { /* fine */ } closed?.(); } }, CONNECT_TIMEOUT);
  s.onopen = () => { lastHeard = Date.now(); s.send(JSON.stringify({ type: 'auth_token', token: getToken(), mobile: isMobileDevice(), client: { version: SHORT } })); }; // (`client` is shown to people with Manage users)
  s.binaryType = 'arraybuffer';
  s.onmessage = e => {
    if (sock === s) lastHeard = Date.now();
    if (typeof e.data !== 'string') { voiceHook?.({ binary: e.data }); return; }
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handleEvent(m);
  };
  s.onclose = () => {
    if (sock !== s) return;
    set({ conn: 'closed' });
    voiceHook?.({ type: 'voice_closed', dropped: true }); // the voice link went with the socket (voice.js waits for the next one to resume a call)
    const wait = backoff(retry++);
    set({ connRetryAt: Date.now() + wait });
    clearTimeout(sockTimer); sockTimer = setTimeout(connect, wait);
  };
}
// "Retry now" / the network or the tab came back: try again right away (the home socket and every instance)
export function retryNow() {
  if (state.signedIn) resumeSocket(true);
  retryInstances();
}
// back in the app (or the network came back): closed -> connect now; stuck connecting -> start over; open but quiet for a while
// (pings stop while a phone app is in the background) -> ping it, and if nothing answers within 3.5 s it's dead: start over.
// now = the Retry now button (a connect in progress is replaced straight away)
export function resumeSocket(now = false) {
  if (!state.signedIn || !getToken()) return;
  const t = Date.now();
  if (!sock || sock.readyState >= 2) { if (state.conn !== 'open') { retry = 0; connect(); } return; }
  if (sock.readyState === 0) { if (now || t - sockStarted > 3000) dropSocket(); return; }
  if (t - lastHeard < 30000 || probeTimer) return;
  const s = sock, asked = t;
  try { s.send(JSON.stringify({ type: 'ping' })); } catch { dropSocket(); return; }
  probeTimer = setTimeout(() => { probeTimer = null; if (sock === s && lastHeard < asked) dropSocket(); }, 3500);
}
if (typeof window !== 'undefined') {
  const back = () => { resumeSocket(); resumeInstances(); };
  addEventListener('online', back);
  addEventListener('focus', back);
  addEventListener('pageshow', back);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') back(); });
}
setInterval(() => send({ type: 'ping' }), 25000);

// one event from the home socket (inst = nookara) or from an instance's (already in Ember's shapes, ids namespaced)
// an instance may only say what PROTOCOL.md §7 lets it: nothing that is Nookara's own (DMs, kicks, presence, calls...)
const INSTANCE_EVENTS = new Set(['chat_message', 'chat_message_update', 'chat_message_delete', 'chat_reactions', 'chat_typing', 'chat_pins_update', 'chat_server_update', 'chat_server_removed', 'chat_roles_update', 'chat_perms_changed', 'chat_channels_update', 'chat_member_update', 'chat_presence', 'chat_members_stale', 'chat_emojis_update', 'chat_stickers_update', 'chat_identity_update', 'chat_ack', 'chat_error', 'chat_ephemeral', 'chat_join_request', 'chat_join_result', 'chat_report', 'chat_timeout', 'chat_server_added', 'chat_starboard', 'chat_shop_update', 'chat_commands_update', 'chat_interaction_message', 'chat_interaction_modal', 'game_status', 'game_console', 'game_linked', 'game_unlinked', 'voice_sound', 'voice_sound_failed', 'e2ee_keys_changed', 'e2ee_link_request', 'e2ee_link_done']);
const INSTANCE_VOICE = /^(chat_rtc_|chat_voice_state$)/;
const LOCKED_EVENTS = new Set(['auth_success', 'auth_error', 'restrictions', 'error', 'kicked', 'ember_update', OLD_EMBER_UPDATE, 'web_build']); // (what still matters while locked)
// "who posted recently" (channel list, Modern): people who posted in a channel lately, newest first. The server's list comes
// with the channels (recent); this adds what arrives live.
function notePoster(msg) {
  const a = msg?.author;
  if (!a?.username || msg.system || a.webhook || a.bot) return;
  set(s => {
    const prev = s.recentPosts?.[msg.channel] || [];
    const next = [{ username: a.username, pfp: a.pfp || null, at: Date.now() }, ...prev.filter(x => x.username !== a.username)].slice(0, 5);
    return { recentPosts: { ...(s.recentPosts || {}), [msg.channel]: next } };
  });
}
export function handleEvent(m, inst = NOOKARA) {
  if (inst !== NOOKARA && !INSTANCE_EVENTS.has(m?.type) && !INSTANCE_VOICE.test(String(m?.type))) return;
  if (inst !== NOOKARA && m.type === 'chat_error' && String(m.request || '').startsWith('chat_rtc')) { voiceHook?.({ ...m, inst }); return; }
  if (inst === NOOKARA && (m.type === 'chat_error' || m.type === 'error') && (m.error === 'insufficient_scope' || m.error === 'scope_disabled')) scopeDenied(m); // before anything else, voice errors included
  if (state.locked && (inst !== NOOKARA || !LOCKED_EVENTS.has(m?.type))) return; // Ember is switched off: only what can switch it back on (or sign out) gets in
  if (VOICE_EVENTS.has(m.type) || (m.type === 'chat_error' && String(m.request || '').startsWith('chat_rtc'))) { voiceHook?.({ ...m, inst }); return; }
  onEvent(m, inst);
}
// an instance's socket closed: a voice channel on it is over
// dropped = the socket just went (a call can resume on the next one); otherwise the call is over for good
export function instanceVoiceClosed(origin, { dropped = false } = {}) { voiceHook?.({ type: 'voice_closed', inst: origin, dropped }); }
// a socket is (back) up and said chat_ready: a call held over a drop can resume now
export function voiceSocketReady(inst = NOOKARA) { voiceHook?.({ type: 'voice_socket_ready', inst }); }
// me, as that instance knows me
const meOn = inst => (inst === NOOKARA || !inst ? state.me : connections.get(inst)?.user) || state.me;
export const isMineMsg = msg => isMine(msg);
const isMine = msg => {
  const inst = msg.inst || instOf(msg.channel || '');
  if (inst === NOOKARA) return msg.author?.username === state.me?.username;
  const u = connections.get(inst)?.user;
  return !!u && !!msg.author && msg.author.id === u.id;
};

function onEvent(m, inst = NOOKARA) {
  switch (m.type) {
    case 'auth_success': {
      retry = 0;
      const was = state.locked;
      if (m.disabled_scopes !== undefined) applyDisabled(m.disabled_scopes, m.restriction_reason);
      if (state.locked) break; // (nothing to say hello for: the socket only waits to hear it's switched back on)
      if (!was) send({ type: 'chat_hello' }); // (just unlocked: unlockAccount said it)
      lastEmberActivity = 0; // (a new socket: the server hasn't heard about this one yet)
      if (pageFocused()) noteEmberActivity(); // a window nobody is looking at reconnecting isn't someone using Ember
      if (rpcNow) send({ type: 'set_rich_presence', activity: { ...rpcNow, app: rpcNow.app || 'Discord RPC' } }); // a game status from the desktop app, again after a reconnect
      break;
    }
    case 'restrictions': // staff changed which services this account may use, or the birthday was set (live, Nookara ws.js applyRestrictions)
      if (m.disabled_scopes !== undefined) applyDisabled(m.disabled_scopes, m.restriction_reason);
      checkPermissions(); // (the greyed-out controls follow too)
      break;
    case 'error': break; // (scope errors were handled above)
    case 'auth_error':
      if (m.error === 'invalid_token' || m.error === 'banned') { if (isWebEmber()) authLost(); else location.href = '/login?next=/chat'; }
      break;
    case 'chat_ready':
      if (inst === NOOKARA && state.e2eeStatus === 'loading' && state.signedIn) E2EE.init().catch(() => {});
      else if (inst === NOOKARA) E2EE.flushOutbox();
      set(s => ({ conn: 'open', connected: true, presence: { ...s.presence, [m.you.username]: localizePresence(m.you.presence) } }));
      rewatchPresence(); // (a new socket: the server forgot what this one was watching)
      if (inst === NOOKARA) voiceSocketReady(NOOKARA);
      catchUp();
      loadNotifCount(); // (anything that happened while the socket was down)
      break;
    case 'chat_message':
      if (m.message?.enc) { openSdm(m.message).then(o => addMessage(`c:${o.channel}`, o)); break; } // a homeserver DM: opened here first
      addMessage(`c:${m.message.channel}`, m.message); notePoster(m.message); break;
    // Nookara: somebody I can see changed their profile (picture, colour, name, bio ...): patch every cache that holds them, refresh any open
    // profile card, and ask the instances they are on to re-read it too (instances otherwise pick it up on their own 10-15 min schedule)
    case 'user_update':
      if (inst !== NOOKARA || !m.user?.id) break;
      lookups.clear();
      set(s => applyUserUpdate(s, m));
      dispatchEvent(new CustomEvent('vc-user-update', { detail: m }));
      if (m.previous_username && m.previous_username !== m.user.username) { loadDMs(); loadGroups(); loadFriends(); } // (name-keyed lists + conversations)
      for (const o of instancesWithAccount(state, m.user.id)) sendTo(o, { type: 'chat_profile_refresh', [NOOKARA_ID_FIELD]: String(m.user.id) });
      // my own profile: the servers with their own accounts where my profile follows it get the new one (accountProfile.js)
      if (state.me && [m.user.username, m.previous_username].includes(state.me.username)) import('./accountProfile.js').then(x => x.syncAllAccountProfiles()).catch(() => {});
      break;
    case 'chat_identity_update':
      if (inst !== NOOKARA) { if (m.user?.id) { set(s => applyIdentity(s, m.user, inst)); loadMembersOf(inst); } break; }
      lookups.clear();
      set(s => applyIdentity(s, m.user));
      break;
    // only for you (e.g. "You claimed your daily chat credits") - shows in that channel, never saved
    case 'chat_ephemeral': {
      const key = `c:${m.channel}`;
      const b = state.msgs[key];
      if (b?.loaded) set(s => ({ msgs: { ...s.msgs, [key]: { ...b, list: [...b.list, { id: `eph${Date.now()}`, ephemeral: true, system: true, sys_kind: m.kind, body: m.body, amount: m.amount, created_at: Date.now() }] } } }));
      break;
    }
    case 'chat_commands_update': loadCommands(m.server); break;
    case 'chat_interaction_modal': set({ interactionModal: m }); break;
    case 'chat_interaction_message': {
      const msg = m.message;
      set(s => ({ msgs: upd(s.msgs, `c:${msg.channel}`, b => {
        if (!b?.loaded) return b;
        if (m.op === 'delete') return { ...b, list: b.list.filter(x => x.id !== msg.id) };
        if (b.list.some(x => x.id === msg.id)) return { ...b, list: b.list.map(x => (x.id === msg.id ? msg : x)) };
        return { ...b, list: ordered([...b.list, msg]) };
      }) }));
      break;
    }
    case 'chat_message_update':
      if (m.message?.enc) { openSdm(m.message).then(o => set(s => ({ msgs: upd(s.msgs, `c:${o.channel}`, b => b && { ...b, list: b.list.map(x => (x.id === o.id ? { ...o, reactions: o.reactions || x.reactions } : x)) }) }))); break; }
      set(s => ({ msgs: upd(s.msgs, `c:${m.message.channel}`, b => b && { ...b, list: b.list.map(x => (x.id === m.message.id ? { ...m.message, reactions: m.message.reactions || x.reactions } : x)) }) }));
      watchSignature(m.message);
      break;
    case 'modmail': { // a moderator message to me
      const viewing = keyOf(state.view) === 'mm:' && document.visibilityState === 'visible';
      set(s => ({ modmail: { messages: [...s.modmail.messages, m.message], unread: viewing ? 0 : s.modmail.unread + 1 } }));
      addMessage('mm:', mmToMsg(m.message));
      if (viewing) apiFetch('/chat/modmail/read', { method: 'POST' }).catch(() => {});
      else ping('mm:', { author: { username: 'Nookara Administrator', pfp: '/assets/icon.png' }, body: m.message.body }, true);
      break;
    }
    case 'modmail_staff': { // staff: a moderator message went out (from anyone on staff)
      const key = `mm:${String(m.username).toLowerCase()}`;
      // my own message's copy is already there (or coming back from the POST) - only add other staff members' ones
      if (state.msgs[key]?.loaded && !state.msgs[key].list.some(x => x.mmId === m.message.id) && !state.msgs[key].list.some(x => x.pending && x.body === m.message.body)) addMessage(key, mmToMsg(m.message));
      break;
    }
    case 'im_edited': // a DM was edited (m.with = the other person)
      E2EE.openMessage({ id: m.id, from_id: m.from_id, to_id: m.to_id, from: m.with, body: m.body, enc: m.enc, edited_at: m.edited_at }).then(o => {
        set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.map(x => (x.imId === m.id ? { ...x, body: o.body, sealed: o.sealed, attachments: sealedAtts(o), edited_at: m.edited_at } : x)) }) }));
        bumpPins(`d:${String(m.with).toLowerCase()}`);
      });
      break;
    case 'e2ee_keys_changed': // someone's keys or linked clients changed (or they just set up, so messages held for them can go)
      // (a homeserver says it by stable id: mine, or someone I share a DM with there)
      if (typeof m.id === 'string' && m.id.includes('@')) { E2EE.forgetDoc(m.id); freshAt.clear(); if (inst !== NOOKARA && state.home?.id === m.id && inst === state.home.origin) E2EE.init().catch(() => {}); E2EE.flushOutbox(); dispatchEvent(new CustomEvent('e2ee-keys-changed', { detail: m.id })); }
      if (inst === NOOKARA && m.username) { E2EE.forgetBundle(m.username); E2EE.flushOutbox(m.username); dispatchEvent(new CustomEvent('e2ee-keys-changed', { detail: m.username })); }
      break;
    case 'e2ee_link_request':
      if (inst !== NOOKARA && inst !== state.home?.origin) break; // (only my own home speaks for my keys)
      if (state.e2eeStatus === 'ready') toast(m.kind === 'device' ? 'A device is asking to read your DMs. To approve it, go to Settings, Privacy.' : `${m.label} is asking to read your DMs. To approve it, go to Settings, Privacy.`);
      break;
    case 'im_pins_update': // pinned or unpinned in a DM (m.with = the other person)
      set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.map(x => (x.imId === m.id ? { ...x, pinned: !!m.pinned } : x)) }) }));
      bumpPins(`d:${String(m.with).toLowerCase()}`);
      break;
    case 'im_reactions': // a reaction in a DM (m.with = the other person)
      set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.map(x => (x.imId === m.id ? { ...x, reactions: m.reactions.length ? m.reactions : undefined } : x)) }) }));
      break;
    // Nookara says something new is out: the desktop app checks + downloads now, the website offers a reload
    case 'ember_update':
    case OLD_EMBER_UPDATE: // (servers that haven't moved yet)
      desktopBridge()?.checkForUpdates?.();
      break;
    case 'web_build':
      dispatchEvent(new CustomEvent('vc-web-build', { detail: m.build }));
      break;
    case 'chat_reactions':
      set(s => ({ msgs: upd(s.msgs, `c:${m.channel}`, b => b && { ...b, list: b.list.map(x => (x.id === m.id ? { ...x, reactions: m.reactions.length ? m.reactions : undefined } : x)) }) }));
      break;
    case 'chat_message_delete':
      set(s => ({ msgs: upd(s.msgs, `c:${m.channel}`, b => b && { ...b, list: b.list.filter(x => x.id !== m.id) }) }));
      break;
    case 'chat_starboard': dispatchEvent(new CustomEvent('vc-starboard', { detail: m })); break; // a starboard got a post / a star count changed
    case 'chat_shop_update': dispatchEvent(new CustomEvent('vc-shop', { detail: m })); break; // an instance: my pay request for a shop role was paid / declined / expired
    // Ember Link (Minecraft): live card / console lines / links - components listen, nothing goes into state
    case 'game_status': case 'game_console': case 'game_linked': case 'game_unlinked': dispatchEvent(new CustomEvent('vc-game', { detail: m })); break;
    case 'chat_ack': {
      sentOk(m.nonce);
      const key = pendingAcks.get(m.nonce);
      pendingAcks.delete(m.nonce);
      signedSends.delete(m.nonce);
      hdSends.delete(m.nonce);
      if (key && m.message?.enc) { openSdm(m.message).then(o => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: settle(b.list, m.nonce, o) }) }))); break; }
      if (key) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: settle(b.list, m.nonce, m.message) }) }));
      if (m.message?.signature) watchSignature(m.message);
      break;
    }
    case 'chat_error': {
      // a homeserver DM whose host has newer keys of someone than I sealed to: theirs are asked for again, and it goes once more
      if (m.error === 'stale_keys' && hdSends.has(m.nonce)) {
        const d = hdSends.get(m.nonce);
        hdSends.delete(m.nonce);
        if (!d.retried) { (Array.isArray(m.members) ? m.members : []).forEach(id => E2EE.forgetDoc(id)); freshAt.delete(d.dm); sendSdm({ ...d, retried: true }); break; }
      }
      hdSends.delete(m.nonce);
      if (m.error === 'bad_signature') refreshSigningKey(); // (a rotated key: "try again" then signs with the new one)
      // the server turned the signature down: same choice as when signing fails here. The message stays pending while they decide
      const resend = SIGN_REFUSED.has(m.error) && signedSends.get(m.nonce);
      signedSends.delete(m.nonce);
      if (resend) {
        const nonce = m.nonce, box = pendingAcks.get(nonce);
        const failed = why => { pendingAcks.delete(nonce); set(s => ({ msgs: upd(s.msgs, box, b => b && { ...b, list: b.list.map(x => (x.nonce === nonce ? { ...x, failed: why } : x)) }) })); };
        askSendUnsigned().then(yes => {
          if (!yes) { failed(m.error); return; }
          set(s => ({ msgs: upd(s.msgs, box, b => b && { ...b, list: b.list.map(x => (x.nonce === nonce ? { ...x, unsigned: true } : x)) }) }));
          if (!resend()) failed('offline');
        });
        break;
      }
      // an instance session from before "Sign messages" (or uploads / voice) was approved: get a fresh one, then say what to do
      if (inst !== NOOKARA && m.error === 'insufficient_scope') {
        renewNookaraSession(inst).then(scopes => toast(scopes?.includes('sign') && scopes.includes('chat') ? 'Your login on this server was out of date - it is updated now, send it again.' : errorText('inst_scope')));
        const key = pendingAcks.get(m.nonce);
        if (key) { pendingAcks.delete(m.nonce); set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === m.nonce ? { ...x, failed: m.error } : x)) }) })); }
        break;
      }

      const key = pendingAcks.get(m.nonce);
      if (key) {
        pendingAcks.delete(m.nonce);
        set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === m.nonce ? { ...x, failed: m.error } : x)) }) }));
        if (['automod_blocked', 'timed_out', 'slow_down', 'message_too_long'].includes(m.error)) toast(errorText(m.error)); // (the server's rules: say why)
      } else if (!['chat_typing', 'chat_presence', 'chat_read'].includes(m.request)) toast(inst !== NOOKARA && m.error === 'insufficient_scope' ? errorText('inst_scope') : errorText(m.error));
      break;
    }
    case 'chat_typing': typingFrom(`c:${m.channel}`, m.bridged?.name ? noteBridgedTyper(m.bridged) : m.username, m.typing, inst); break;
    case 'dm_typing': typingFrom(`d:${String(m.from).toLowerCase()}`, m.from, m.typing); break;
    case 'chat_channels_update':
      set(s => ({ detail: upd(s.detail, m.server, d => d && { ...d, categories: m.categories ?? d.categories, channels: m.channels.map(c => ({ ...(d.channels.find(x => x.cid === c.cid) || {}), ...c })) }) }));
      refreshServer(m.server);
      break;
    case 'chat_server_update': {
      // a broadcast copy has no "you" parts (role, permissions) - keep ours
      const keep = o => ({ role: o.role, perms: o.perms, invite: o.invite ?? m.server.invite, inst: o.inst });
      set(s => ({
        servers: s.servers.map(x => (x.sid === m.server.sid ? { ...x, ...m.server, ...keep(x) } : x)),
        detail: upd(s.detail, m.server.sid, d => d && { ...d, server: { ...d.server, ...m.server, ...keep(d.server) } }),
      }));
      break;
    }
    case 'chat_emojis_update':
      loadEmojis();
      break;
    case 'chat_stickers_update': { // an Ember server's stickers changed (personal.js)
      const sid = String(m.server || '').includes('|') ? m.server : K(inst, m.server);
      if (m.server) setStickers(sid, m.stickers);
      break;
    }
    // ── instances ──
    case 'chat_join_request': {
      const srv = state.servers.find(x => x.sid === m.sid);
      set(s => ({ joinRequests: { ...s.joinRequests, [m.sid]: (s.joinRequests[m.sid] || 0) + 1 } }));
      toast(`${m.request?.user?.username || 'Someone'} wants to join ${srv?.name || 'a server'}.`, true);
      break;
    }
    case 'chat_report': // a member reported something (moderators): Server settings > Reports listens for the list
      dispatchEvent(new CustomEvent('vc-report', { detail: m }));
      set(s => ({ reports: { ...s.reports, [m.server]: m.open } }));
      break;
    case 'chat_timeout': // AutoMod (or a moderator) timed me out, or lifted it (until: null)
      set(s => ({ detail: upd(s.detail, m.server, d => d && { ...d, server: { ...d.server, timeout_until: m.until || null } }) }));
      if (m.until > Date.now()) { toast(`You're timed out until ${untilText(m.until)}.`); dispatchEvent(new CustomEvent('vc-timed-out', { detail: { sid: m.server } })); }
      break;
    case 'chat_join_result': {
      const name = state.servers.find(x => x.sid === m.sid)?.name;
      if (m.accepted) toast(`You're in${name ? `: ${name}` : ''}!`, true); else toast('Your request to join was turned down.');
      loadInstanceData(inst);
      break;
    }
    case 'chat_server_added':
      set(s => ({ servers: s.servers.some(x => x.sid === m.server.sid) ? s.servers.map(x => (x.sid === m.server.sid ? { ...x, ...m.server } : x)) : [...s.servers, m.server] }));
      if (m.server?.name) toast(`You joined ${m.server.name}.`, true);
      break;
    case 'instance_update': case 'instance_restarting': break; // handled by the connection itself
    case 'chat_roles_update':
      set(s => ({ detail: upd(s.detail, m.server, d => d && { ...d, roles: m.roles }) }));
      break;
    case 'chat_perms_changed': // someone changed my roles there
      if (state.commands[m.server]) loadCommands(m.server);
      refreshServer(m.server); if (inst === NOOKARA) { loadServers(); loadMembers(m.server); } else loadInstanceData(inst); // (Manage users changes what the member list shows)
      break;
    case 'chat_members_stale':
      loadMembers(m.server);
      break;
    case 'chat_presence': // someone on an Ember server (a bot, or a person on servers with member_presence) connected / left it. Matched by server (instance-namespaced) + principal id
      if (inst === NOOKARA || (m.presence !== 'online' && m.presence !== 'offline') || m.user_id == null) break;
      set(s => ({
        members: upd(s.members, m.server, list => (list ? list.map(x => (String(x.id) === String(m.user_id) ? { ...x, presence: m.presence } : x)) : list)),
        commands: s.commands[m.server] ? { ...s.commands, [m.server]: { ...s.commands[m.server], bots: s.commands[m.server].bots.map(b => (String(b.id) === String(m.user_id) ? { ...b, online: m.presence === 'online' } : b)) } } : s.commands,
      }));
      break;
    case 'instance_wake': // (from Nookara) a server that's asleep here has something new: unread on the rail
      if (inst === NOOKARA && m.instance) instanceWoke(m.instance);
      break;
    case 'chat_server_removed':
      forgetServerCache(m.server);
      set(s => ({ servers: s.servers.filter(x => x.sid !== m.server), detail: Object.fromEntries(Object.entries(s.detail).filter(([k]) => k !== m.server)) }));
      if (state.view.sid === m.server) { go({ kind: 'home' }); toast(m.reason === 'deleted' ? 'That server was deleted.' : m.reason === 'left' ? 'You left the server.' : `You were ${m.reason === 'banned' ? 'banned' : 'removed'} from that server.`); }
      if (inst !== NOOKARA) forgetIfEmpty(inst); // (an Ember server you're no longer in leaves the list, so it doesn't come back on reconnect)
      break;
    case 'chat_member_update':
      if (inst !== NOOKARA && state.commands[m.server] && String(m.user_id || '').startsWith('b:')) loadCommands(m.server);
      set(s => ({
        servers: s.servers.map(x => (x.sid === m.server ? { ...x, member_count: m.member_count } : x)),
        members: upd(s.members, m.server, list => {
          if (!list) return list;
          const rest = list.filter(x => m.member?.id != null ? String(x.id) !== String(m.member.id) : m.user_id != null ? String(x.id) !== String(m.user_id) : x.username !== m.username);
          const old = list.find(x => !rest.includes(x));
          const nu = inst === NOOKARA || !m.member ? m.member : { ...m.member, inst, joined_at: m.member.joined_at ?? old?.joined_at ?? (m.change === 'joined' ? Date.now() : undefined) };
          return m.change === 'joined' || m.change === 'role' ? [...rest, nu] : rest;
        }),
      }));
      if (m.member && inst !== NOOKARA && 'nick' in m.member) set(s => applyNick(s, m.member, (s.detail[m.server]?.channels || []).map(c => c.cid))); // (a server nickname: the names on loaded messages too)
      if (m.member && inst === NOOKARA) remember([m.member]);
      else if (m.member) wantNookaraFaces([m.member]);
      break;
    case 'presence_update':
      set(s => ({ presence: { ...s.presence, [m.username]: localizePresence(m.presence) } }));
      break;
    case 'presence_bulk': // the answer to chat_presence_watch
      if (Array.isArray(m.presences) && m.presences.length) set(s => ({ presenceReady: true, presence: { ...s.presence, ...Object.fromEntries(m.presences.map(x => [x.username, localizePresence(x.presence)])) } }));
      else if (!state.presenceReady) set({ presenceReady: true }); // (Home waits for this so friends don't jump from Offline to Online)
      break;
    case 'im_received':
    case 'im_sent': {
      if (m.message?.from_bot) markBotPeer(m.message.from);
      if (m.message?.to_bot) markBotPeer(m.message.to);
      E2EE.openMessage(m.message).then(opened => {
        const msg = imToMsg(opened);
        if (m.nonce || m.message.nonce) msg.nonce = m.nonce || m.message.nonce;
        const other = m.type === 'im_sent' || msg.author?.username === state.me?.username ? m.message.to : m.message.from;
        addMessage(`d:${String(other).toLowerCase()}`, msg);
        if (m.type === 'im_received') typingFrom(`d:${String(other).toLowerCase()}`, other, false);
        loadDMs();
      });
      break;
    }
    case 'im_ack': {
      sentOk(m.nonce);
      const key = pendingAcks.get(m.nonce);
      pendingAcks.delete(m.nonce);
      dmSends.delete(m.nonce);
      if (key) E2EE.openMessage(m.message).then(opened => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: settle(b.list, m.nonce, imToMsg(opened)) }) })));
      break;
    }
    case 'im_error': {
      // the keys I sealed to were out of date (a new client, or a new key): once more with fresh ones. No keys any more: back to waiting.
      const again = dmSends.get(m.nonce);
      if (again && (m.error === 'stale_keys' || m.error === 'recipient_no_keys') && !again.retried) { again.retried = true; E2EE.forgetBundle(again.to); E2EE.forgetBundle(state.me?.username); sendDm(again); break; }
      dmSends.delete(m.nonce);
      const key = pendingAcks.get(m.nonce);
      pendingAcks.delete(m.nonce);
      if (key) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === m.nonce ? { ...x, failed: m.request_sent ? 'dm_request_sent' : m.error } : x)) }) }));
      break;
    }
    case 'note': { // a personal note, from this device or another one
      const msg = noteToMsg(m.note);
      if (m.nonce) msg.nonce = m.nonce;
      addMessage('n:', msg);
      break;
    }
    case 'note_edited':
      set(s => ({ msgs: upd(s.msgs, 'n:', b => b && { ...b, list: b.list.map(x => (x.noteId === m.note.id ? { ...x, body: m.note.body, edited_at: m.note.edited_at } : x)) }) }));
      break;
    case 'note_deleted':
      dropNote(m.id);
      break;
    case 'roomMessage':
      if (String(m.room || '').startsWith('grp_')) { addMessage(`g:${m.room}`, groupToMsg(m)); loadGroups(); }
      break;
    case 'room_message_deleted': // someone took back their own group message
      dropGroupMessage(m.room, m.id);
      bumpPins(`g:${m.room}`);
      loadGroups();
      break;
    case 'room_message_edited': // the author changed their group message
      set(s => ({ msgs: upd(s.msgs, `g:${m.room}`, b => b && { ...b, list: b.list.map(x => (x.gid === m.id ? { ...x, body: m.message, edited_at: m.edited_at } : x.reply?.id === `g${m.id}` ? { ...x, reply: { ...x.reply, body: String(m.message).slice(0, 200) } } : x)) }) }));
      bumpPins(`g:${m.room}`);
      loadGroups();
      break;
    case 'room_message_reactions': // a reaction in a group chat
      set(s => ({ msgs: upd(s.msgs, `g:${m.room}`, b => b && { ...b, list: b.list.map(x => (x.gid === m.id ? { ...x, reactions: m.reactions.length ? m.reactions : undefined } : x)) }) }));
      break;
    case 'room_pins_update': // pinned or unpinned in a group chat
      set(s => ({ msgs: upd(s.msgs, `g:${m.room}`, b => b && { ...b, list: b.list.map(x => (x.gid === m.id ? { ...x, pinned: !!m.pinned } : x)) }) }));
      bumpPins(`g:${m.room}`);
      break;
    case 'im_deleted': // the other side (or another device of mine) removed a DM
      set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.filter(x => x.imId !== m.id) }) }));
      bumpPins(`d:${String(m.with).toLowerCase()}`);
      loadDMs();
      break;
    case 'group_update': case 'group_removed': loadGroups(); break;
    case 'chat_pins_update': bumpPins(m.channel); break;
    case 'friend_request': case 'friend_request_accepted': loadFriends(); loadHomeRequests(); break;
    case 'blocks_changed': loadBlocks(); break;
    case 'chat_settings_changed': if (m.settings && typeof m.settings === 'object') set(s => ({ settings: { ...s.settings, ...m.settings } })); break; // (pinned DM categories from another device)
    case 'balance_changed': dispatchEvent(new CustomEvent('vc-balance', { detail: m })); break; // (your account card's credits row) // I blocked / unblocked someone (here or on another device)
    case 'notification_new': notificationNew(m); if (/request/.test(String(m.notification?.type || m.notification?.kind || ''))) loadHomeRequests(); break; // (a message request comes as a notification)
    case 'notifications_updated': notificationsUpdated(m); break; // read / deleted somewhere else (another tab, the site, a phone)
    // read on another device (desktop app, phone, another tab): the red counts here go too
    case 'im_read_sync': if (m.with) { const u = String(m.with).toLowerCase(); set(s => ({ dms: s.dms.map(c => (c.username.toLowerCase() === u ? { ...c, unread: 0 } : c)), unread: { ...s.unread, [`d:${u}`]: false } })); } break;
    case 'chat_read_sync': if (m.cid && m.sid) { clearMentions(m.sid, [m.cid]); channelSeen(m.sid, m.cid, m.id); } break;
    // friends and DMs on other homeservers (Nookara's /api/v2/social tells its own socket): a request, a new DM, a message in one
    case 'social_friends_update': case 'social_presence': case 'social_dm_update': case 'social_dm_remove': case 'social_dm_activity':
      if (inst === NOOKARA && state.nkHome) socialEvent(state.nkHome.origin, m);
      break;
    case 'kicked': if (isWebEmber()) authLost(); else location.href = '/login'; break;
    default: break;
  }
}

// ── messages ──
function addMessage(key, msg) {
  const b = state.msgs[key];
  const mine = isMine(msg);
  if (msg.signature) watchSignature(msg);
  let p = b && mine ? findPending(b.list, msg) : -1;
  if (p >= 0 && outbox.has(b.list[p].nonce) && msg.nonce !== b.list[p].nonce && !deliveredIn([msg], outbox.get(b.list[p].nonce))) p = -1;
  if (b?.loaded || p >= 0) { // (my own message: its copy is replaced even while the conversation is reloading)
    if (msg.id && b.list.some(x => x.id === msg.id)) return;
    // my own message over the socket before the ack: replace the pending copy with the same text
    let list = b.list;
    // (a DM with files went out as text + links, so it is matched on that, or on the nonce when the server echoes it)
    if (p >= 0) { sentOk(list[p].nonce); list = list.map((x, i) => (i === p ? msg : x)); } else list = [...list, msg];
    set(s => ({ msgs: { ...s.msgs, [key]: { ...b, list: ordered(list) } } }));
  }
  if (msg.author) typingFrom(key, msg.author.bridge ? bridgedToken(msg.author.bridge, msg.author.username) : msg.author.username, false, msg.inst || NOOKARA);
  // The conversation only counts as "open" when Ember itself has focus.
  // A new message in the visible-but-inactive window should still notify.
  const open = keyOf(state.view) === key && pageFocused();
  const n = key.startsWith('c:') ? effectiveNotify(msg.channel, msg.server) : null;
  const sdm = soc() && key.startsWith('c:') ? dmOfChannel(msg.channel) : null; // a DM on a homeserver: its one channel
  if (sdm) dmMessage(sdm, msg, mine, open);
  if (!mine && open && key.startsWith('d:')) markDmRead(state.view.username);
  if (!mine && !open && !n?.muted) {
    set(s => ({ unread: { ...s.unread, [key]: true } }));
    if (key.startsWith('c:')) {
      const sid = msg.server;
      set(s => ({ servers: s.servers.map(x => (x.sid === sid ? { ...x, unread: true } : x)), unreadN: { ...s.unreadN, [msg.channel]: { sid, n: (s.unreadN[msg.channel]?.n || 0) + 1 } } }));
    }
    // (a sealed DM's notification never carries what it says: it is read where it is opened)
    if (!n || n.level !== 'none') ping(key, sdm && msg.enc ? { ...msg, body: 'New message', attachments: [] } : msg, n?.level === 'all' || !!sdm, packActive());
    // a red count on the channel + server for mentions (replies to you count)
    if (key.startsWith('c:') && mentionsMe(msg)) {
      set(s => ({ mentions: { ...s.mentions, [msg.channel]: (s.mentions[msg.channel] || 0) + 1 }, srvMentions: { ...s.srvMentions, [msg.server]: (s.srvMentions[msg.server] || 0) + 1 } }));
    }
  }
  // message sounds (a pack replaces the normal notification sound): the conversation I'm looking at, or whatever would have pinged me
  if (packActive() && !mine && state.settings.sounds && !msg.system && !msg.ephemeral && !n?.muted && n?.level !== 'none' && state.presence[state.me?.username]?.status !== 'dnd') {
    const direct = !msg.channel || n?.level === 'all';
    // (the conversation I'm looking at counts even when the window is in the background)
    if (keyOf(state.view) === key || direct || mentionsMe(msg)) playPackSound(msg.author?.bot ? 'bot' : 'receive');
  }
  if (open && key.startsWith('c:') && msg.id) readChannel(msg.channel, msg.id);
}
// tell the server how far I've read; over HTTPS when the socket is down (a dropped chat_read left channels unread after a reload)
function readChannel(cid, id) {
  if (!cid || !id) return;
  if (!send({ type: 'chat_read', channel: cid, id })) apiFetch(`/chat/channels/${cid}/read`, { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {});
}
// a channel I've now seen: nothing left in it, and its server's dot / count only for what's left in its other channels
function channelSeen(sid, cid, lastId) {
  set(s => {
    const unread = { ...s.unread, [`c:${cid}`]: false };
    const unreadN = { ...s.unreadN };
    delete unreadN[cid];
    const d = s.detail[sid];
    const channels = d ? d.channels.map(c => (c.cid === cid ? { ...c, unread: false, unread_count: 0, last_read_id: lastId ? String(lastId) : c.last_read_id } : c)) : null;
    const servers = s.servers.map(x => {
      if (x.sid !== sid) return x;
      if (!channels) return { ...x, unread: Object.values(unreadN).some(u => u.sid === sid) };
      return { ...x, unread: channels.some(c => c.unread || unread[`c:${c.cid}`]), unread_count: channels.reduce((n, c) => n + (c.unread ? c.unread_count || 0 : 0), 0) };
    });
    return { unread, unreadN, servers, detail: d ? { ...s.detail, [sid]: { ...d, channels } } : s.detail };
  });
}
// the window came back into focus on a conversation: whatever came in while it was in the background is read now
function markViewRead() {
  noteEmberActivity();
  const v = state.view;
  const key = keyOf(v);
  const wasUnread = !!state.unread[key];
  set(s => ({ unread: { ...s.unread, [key]: false } }));
  if (viewingDm()) markDmRead(viewingDm());
  if (v.kind !== 'channel') return;
  const ch = state.detail[v.sid]?.channels.find(c => c.cid === v.cid);
  if (!wasUnread && !state.unreadN[v.cid] && !ch?.unread && !ch?.mentions && !state.mentions[v.cid]) return;
  const last = state.msgs[key]?.list.filter(x => !x.pending && !x.ephemeral).pop();
  if (last) readChannel(v.cid, last.id);
  clearMentions(v.sid, [v.cid]);
  channelSeen(v.sid, v.cid, last?.id);
}
// everything waiting, for the tab title and icon: messages (muted servers / channels left out) and pings (mentions + DMs)
export function unreadTotals(s = state) {
  const now = Date.now();
  const muted = t => { const n = s.notify[t]; return !!(n?.muted_until && n.muted_until > now); };
  let count = 0, pings = 0;
  for (const x of s.servers) {
    if (muted(x.sid)) continue;
    pings += (x.mentions || 0) + (s.srvMentions[x.sid] || 0);
    // muted channels never count, loaded or not (unread.js serverUnreadCount)
    count += serverUnreadCount(x, { channels: s.detail[x.sid]?.channels || null, unread: s.unread, unreadN: s.unreadN, muted: cid => muted(cid) });
  }
  for (const c of s.dms) if (c.unread) { count += c.unread; pings += c.unread; }
  for (const d of s.social.dms) if (d.unread) { count += d.unread; pings += d.unread; } // (DMs on homeservers)
  for (const [k, v] of Object.entries(s.unread)) {
    if (!v) continue;
    if (k.startsWith('g:')) count += 1;
    else if (k.startsWith('d:') && !s.dms.some(c => `d:${c.username.toLowerCase()}` === k && c.unread)) { count += 1; pings += 1; }
  }
  if (s.modmail?.unread) { count += s.modmail.unread; pings += s.modmail.unread; }
  if (s.homeRequests) { count += s.homeRequests; pings += s.homeRequests; } // friend + message requests waiting
  return { count, pings };
}
// is this message for me? @me, a reply to my message, @everyone / @here, or one of my roles
export function mentionsMe(msg) {
  const inst = msg.inst || instOf(msg.channel || '');
  const me = (inst === NOOKARA ? state.me : connections.get(inst)?.user)?.username;
  const myId = myIdOn(inst);
  if (!me || isMine(msg)) return false;
  if (msg.reply?.author?.username === me) return true;
  if (msg.mention_everyone) return true;
  if (msg.mention_roles?.length && msg.server) {
    const mine = state.members[msg.server]?.find(x => x.username === me)?.roles || [];
    if (msg.mention_roles.some(r => mine.includes(r))) return true;
  }
  // only a <@my id> token pings (a plain "@name" in the text is just text)
  return myId != null && String(msg.body || '').includes(`<@${myId}>`);
}
// the Hyperfocus sounds (public/assets/sounds/chat)
const SOUNDS = { message: '/assets/sounds/chat/message.mp3', mention: '/assets/sounds/chat/mention.m4a', join: '/assets/sounds/chat/joinVC.mp3', leave: '/assets/sounds/chat/leaveVC.mp3', call: '/assets/sounds/chat/call.mp3', ringtone: '/assets/sounds/chat/ringtone-deltarune.mp3?v=20261012', ringtone_epic: '/assets/sounds/chat/ringtone-epic.mp3?v=20261011', notify: '/assets/sounds/chat/notify.mp3?v=20261011', notify_short: '/assets/sounds/chat/message-short.mp3?v=20261114', notify_soft: '/assets/sounds/chat/message-default.mp3?v=20261113', voice_start: '/assets/sounds/chat/voice-start.mp3', voice_send: '/assets/sounds/chat/voice-send.mp3', voice_delete: '/assets/sounds/chat/voice-delete.mp3', notify_classic: '/assets/sounds/chat/message.mp3', mute: '/assets/sounds/chat/mute.mp3', unmute: '/assets/sounds/chat/unmute.mp3', deafen: '/assets/sounds/chat/deafen.mp3', undeafen: '/assets/sounds/chat/undeafen.mp3' };
let lastSound = 0;
export function playSound(name, volume = 0.6) {
  if (name === 'message') name = { classic: 'notify_classic', soft: 'notify_soft' }[state.settings.notify_sound] || 'notify_short'; // new-message sound (My Account > Chat > Notification sound)
  if (!state.settings.sounds || !SOUNDS[name]) return null;
  const now = Date.now();
  const burst = name === 'notify_short' || name === 'notify_soft' || name === 'notify_classic' || name === 'mention';
  if (burst && now - lastSound < 600) return null; // a burst of messages = one sound
  if (burst) lastSound = now;
  try { const a = new Audio(SOUNDS[name]); a.volume = volume; a.play().catch(() => {}); return a; } catch { return null; }
}
// settings preview: always plays, whatever the Sounds switch says
export function previewNotifySound(kind) {
  try { const a = new Audio(SOUNDS[{ classic: 'notify_classic', soft: 'notify_soft' }[kind] || 'notify_short']); a.volume = 0.6; a.play().catch(() => {}); } catch { /* no audio */ }
}
// incoming-call ringtone: loops while a call rings; 1 in 100 calls rings the rare EPIC variant (rolled once per call)
const ringPick = new Map(); // callId -> 'ringtone' | 'ringtone_epic'
let ringAudio = null, ringKey = '';
export function syncRing(callIds) {
  const key = (callIds || []).join('|');
  if (key === ringKey) return;
  ringKey = key;
  if (!key) { if (ringAudio) { ringAudio.pause(); ringAudio = null; } ringPick.clear(); return; }
  if (ringAudio) return; // already ringing: keep looping the file chosen for the first call
  if (!state.settings.sounds || state.presence[state.me?.username]?.status === 'dnd') return;
  const id = callIds[0];
  if (!ringPick.has(id)) ringPick.set(id, Math.random() < 0.01 ? 'ringtone_epic' : 'ringtone');
  try { const a = new Audio(SOUNDS[ringPick.get(id)]); a.loop = true; a.volume = 0.7; a.play().catch(() => {}); ringAudio = a; } catch { ringAudio = null; }
}
function ping(key, msg, everyMessage = false, quiet = false) {
  if (state.presence[state.me?.username]?.status === 'dnd') return;
  // DM call lines ("[Voice call] missed call") read from my side: "You missed a call from X"
  const callText = key.startsWith('d:') ? callLinePlain(msg.body, { caller: msg.author?.username, me: state.me?.username, other: key.slice(2) }) : null;
  if (callText) msg = { ...msg, body: callText };
  const direct = !msg.channel || everyMessage; // a DM / group chat, or a channel set to "All messages"
  const mention = mentionsMe(msg);
  const hidden = !pageFocused();
  // pings in servers make the same sound as a new DM
  if ((direct || mention) && !quiet) { if (packActive()) playPackSound(msg.author?.bot ? 'bot' : 'receive'); else playSound('message'); }
  // no desktop / browser pop-ups any more (Ikelene 2026-11-13): sounds, unread badges and the bell stay, phones get push.
  // Only Ember desktop's in-game overlay still shows a toast for DMs and mentions while a game is in front.
  if (hidden && (direct || mention)) overlayToastHook?.(key, msg);
}

// Ember desktop in-game overlay (chat/overlay.js): gets first pick of notifications while a game is in front
let overlayToastHook = null;
export const onOverlayToast = fn => { overlayToastHook = fn; };

// someone typing on the other side of a bridge (Discord / Fluxer / Matrix) has no account here: the typing list holds a
// token for them, and this keeps the name, picture and platform behind it
const bridgedTypers = new Map();
export const bridgedTyper = token => bridgedTypers.get(token) || null;
const bridgedToken = (platform, name) => `~${platform}:${name}`;
function noteBridgedTyper(b) {
  const token = bridgedToken(b.platform, b.name);
  bridgedTypers.set(token, { name: String(b.name), pfp: b.avatar || null, platform: String(b.platform) });
  if (bridgedTypers.size > 500) bridgedTypers.delete(bridgedTypers.keys().next().value);
  return token;
}
const typingTimers = {};
function typingFrom(key, username, on = true, inst = NOOKARA) {
  if (!username || username === meOn(inst)?.username) return;
  const t = { ...(state.typing[key] || {}) };
  if (on === false) delete t[username]; else t[username] = Date.now() + 7000;
  set(s => ({ typing: { ...s.typing, [key]: t } }));
  clearTimeout(typingTimers[key]);
  typingTimers[key] = setTimeout(() => {
    const now = Date.now();
    const cur = Object.fromEntries(Object.entries(state.typing[key] || {}).filter(([, until]) => until > now));
    set(s => ({ typing: { ...s.typing, [key]: cur } }));
  }, 7100);
}
// a DM's files, from its opened message (E2EE.openMessage): their links go to Messages.jsx, which opens them on the way to the screen
function sealedAtts(m) {
  return (m.sealed?.files || []).map(link => { const f = E2EE.parseFileLink(link); return f ? { url: link, sealed: true, name: f.name, type: fileKindOfMime(f.mime, f.name) } : null; }).filter(Boolean);
}
export function imToMsg(m) {
  const meName = state.me?.username;
  const fromMe = m.from === meName;
  return {
    id: `im${m.id}`, imId: m.id, body: m.body, attachments: sealedAtts(m), system: !!m.from_system, sealed: m.sealed || null, notEncrypted: !m.enc && !m.from_system && !m.from_bot && !m.to_bot && !/^\[Voice call\]/i.test(m.body || ''),
    wire: m.sealed?.wire, fromId: m.from_id, toId: m.to_id, quote: m.sealed?.quote || null,
    statusReply: m.status_reply?.text ? String(m.status_reply.text) : null,
    reply: m.reply ? { id: `im${m.reply.id}`, author: m.reply.gone ? null : { username: m.reply.from, pfp: state.people[m.reply.from]?.pfp || null }, body: m.reply.gone ? 'Original message was deleted' : m.reply.body } : null,
    author: m.from_system ? null : { username: m.from, pfp: fromMe ? state.me?.pfp : m.from_pfp, color: fromMe ? state.me?.color : state.people[m.from]?.color, rank: state.people[m.from]?.rank, ...(m.from_bot ? { bot: true } : {}) },
    created_at: new Date(m.sent_at).getTime(), edited_at: m.edited_at ? new Date(m.edited_at).getTime() : null, reactions: m.reactions || undefined, pinned: !!m.pinned,
  };
}
export function groupToMsg(m) {
  const p = state.people[m.user] || {};
  return {
    id: m.id ? `g${m.id}` : `g${m.timestamp}_${m.user}`, gid: m.id || null, room: m.room || null, body: m.message, attachments: [], system: !!m.system, sys_kind: m.sys_kind || undefined,
    reply: m.reply ? { id: `g${m.reply.id}`, author: { username: m.reply.user, pfp: state.people[m.reply.user]?.pfp || null }, body: m.reply.message } : null,
    author: m.system ? null : { username: m.user, pfp: p.pfp || null, color: p.color || null, rank: m.rank },
    created_at: m.timestamp, edited_at: m.edited_at || null, reactions: m.reactions?.length ? m.reactions : undefined, pinned: !!m.pinned_at,
  };
}

// a conversation's messages in time order, each once (a reconnect refetch or a late socket event can't shuffle them)
function ordered(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const k = m.imId ? `im${m.imId}` : m.gid ? `g${m.gid}` : m.id;
    if (k && !m.pending && seen.has(k)) continue;
    if (k && !m.pending) seen.add(k);
    out.push(m);
  }
  const done = out.filter(m => !m.pending && !m.failed);
  const waiting = out.filter(m => m.pending || m.failed);
  done.sort((a, b) => (Number(a.created_at) - Number(b.created_at)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return [...done, ...waiting];
}
const ADMIN_AUTHOR = { username: 'Nookara Administrator', pfp: '/assets/icon.png', webhook: true, staff: true };
const mmToMsg = m => ({ id: `mm${m.id}`, mmId: m.id, author: ADMIN_AUTHOR, body: m.body, attachments: [], created_at: m.created_at, staffBy: m.admin || undefined });
// Personal Notes (a chat with yourself, /chat/notes on Nookara): plain text, attachments are links in it like group chats
export const noteToMsg = n => ({ id: `note${n.id}`, noteId: n.id, body: n.body, attachments: [], system: false, author: { username: state.me?.username, pfp: state.me?.pfp, color: state.me?.color, rank: state.me?.rank }, created_at: n.created_at, edited_at: n.edited_at || null });
export async function loadModmail() {
  const d = await apiFetch('/chat/modmail').catch(() => null);
  if (d) set(s => ({ modmail: { messages: d.messages, unread: keyOf(s.view) === 'mm:' ? 0 : d.unread } }));
  apiFetch('/chat/modmail/staff').then(x => set(() => ({ staff: !!x.staff }))).catch(() => {});
}
export async function loadMessages(v, { older = false } = {}) {
  restoreOutbox(); // (once: unsent messages from before a reload show even while offline)
  const key = keyOf(v);
  const b = state.msgs[key];
  if (b?.loading || (older && !b?.hasMore) || (!older && b?.loaded)) return;
  set(s => ({ msgs: { ...s.msgs, [key]: { list: [], hasMore: false, ...(s.msgs[key] || {}), loading: true } } }));
  try {
    let list = [], hasMore = false;
    const first = older ? b.list.find(x => !x.pending) : null;
    if (v.kind === 'channel') {
      const sdm = isInst(v.cid) ? sdmOf(v.cid) : null, kid = sdm ? E2EE.myKid() : null; // a homeserver DM: only my own wraps are asked for
      const d = await apiFetch(`/chat/channels/${v.cid}/messages?limit=50${first ? `&before=${first.id}` : ''}${kid ? `&kids=${kid}` : ''}`);
      list = sdm ? await Promise.all(d.messages.map(x => openSdm(x, sdm))) : d.messages; hasMore = d.has_more;
    } else if (v.kind === 'dm') {
      if (!older) checkBotPeer(v.username);
      const d = await apiFetch(`/im/with/${encodeURIComponent(v.username)}?limit=50${first ? `&before=${first.imId}` : ''}`);
      list = (await Promise.all(d.messages.map(E2EE.openMessage))).map(imToMsg); hasMore = d.has_more;
    } else if (v.kind === 'notes') {
      const d = await apiFetch(`/chat/notes?limit=50${first ? `&before=${first.noteId}` : ''}`);
      list = d.notes.map(noteToMsg); hasMore = d.has_more;
    } else if (v.kind === 'modmail') {
      const d = await apiFetch(v.username ? `/chat/modmail/with/${encodeURIComponent(v.username)}` : '/chat/modmail');
      list = d.messages.map(mmToMsg);
    } else if (v.kind === 'group') {
      const d = await apiFetch(`/groups/${encodeURIComponent(v.room)}/messages?limit=300`);
      const names = [...new Set(d.messages.map(m => m.user).filter(Boolean))].filter(n => !state.people[n]?.pfp);
      await lookupMany(names.slice(0, 100)).catch(() => null);
      list = d.messages.map(groupToMsg);
    }
    if (v.kind === 'channel' && isInst(v.cid)) list.forEach(watchSignature); else remember(list.map(m => m.author).filter(Boolean));
    const hadCopies = new Set((state.msgs[key]?.list || []).filter(x => x.pending).map(x => x.nonce));
    set(s => {
      const cur = s.msgs[key] || { list: [] };
      const ids = new Set(list.map(m => m.id));
      const live = dropSettled(cur.list.filter(m => !ids.has(m.id)), list, isMine);
      return { msgs: { ...s.msgs, [key]: { list: ordered(older ? [...list, ...cur.list] : [...list, ...live]), hasMore, loading: false, loaded: true } } };
    });
    // my queued ones: a copy the reload matched to a real message went (dropSettled), one that wasn't on screen shows again
    const now = state.msgs[key]?.list || [];
    for (const it of [...outbox.values()]) {
      if (keyOf(it.v) !== key || now.some(x => x.nonce === it.nonce)) continue;
      if (hadCopies.has(it.nonce) && deliveredIn(now, it)) sentOk(it.nonce); else showQueued(it);
    }
  } catch (e) {
    set(s => ({ msgs: { ...s.msgs, [key]: { list: (s.msgs[key]?.list || []).filter(m => m.pending), hasMore: false, loading: false, loaded: true, error: e.message } } })); // (my unsent ones stay)
  }
}
// after a reconnect: what came in while we were gone (inst: which socket it was)
export async function catchUp(inst = NOOKARA) {
  restoreOutbox(); // (once: the first socket that's up)
  flushOutbox(inst);
  if (inst === NOOKARA) recheckSleepers(); // (a wake ping may have been missed while Nookara's socket was down)
  // the open server was showing its kept channel list: the real one, and its members, now that it's connected
  const cv = state.view;
  if (cv.kind === 'channel' && (isInst(cv.sid) ? instOf(cv.sid) === inst : inst === NOOKARA) && state.detail[cv.sid]?.cached) {
    wakeServer(cv.sid).then(d => { if (d && keyOf(state.view) === keyOf(cv)) open(state.view); });
  }
  // bot slash commands of this socket's servers (bots may have changed them while it was down / asleep), and the open one's
  if (inst !== NOOKARA) {
    const want = new Set(Object.keys(state.commands).filter(sid => isInst(sid) && instOf(sid) === inst));
    if (cv.kind === 'channel' && isInst(cv.sid) && instOf(cv.sid) === inst) want.add(cv.sid);
    for (const sid of want) loadCommands(sid, cv.kind === 'channel' && cv.sid === sid ? cv.cid : undefined);
  }
  const mine = key => instOf(key.slice(2)) === inst;
  if (inst === NOOKARA) {
    // A rename may have happened while this socket was offline. Refresh the IDs
    // already present in cached channel history, including members who have left.
    const identityIds = new Set();
    for (const [key, buffer] of Object.entries(state.msgs)) if (key.startsWith('c:') && mine(key)) {
      for (const message of buffer.list) for (const person of [message.author, message.subject, message.reply?.author, message.reply?.subject]) {
        if (person?.id && /^[1-9]\d*$/.test(String(person.id))) identityIds.add(String(person.id));
      }
    }
    const ids = [...identityIds];
    for (let start = 0; start < ids.length; start += 200) {
      apiFetch(`/chat/identities?ids=${ids.slice(start, start + 200).join(',')}`).then(result => {
        set(s => result.users.reduce(applyIdentity, s));
      }).catch(() => {});
    }
  }
  for (const [key, b] of Object.entries(state.msgs)) {
    if (!key.startsWith('c:')) { if (inst === NOOKARA && b.loaded) set(s => ({ msgs: { ...s.msgs, [key]: { ...b, loaded: false } } })); continue; }
    if (b.error && mine(key)) { set(s => ({ msgs: { ...s.msgs, [key]: { ...b, loaded: false, error: undefined } } })); continue; } // (it couldn't load while offline: again now)
    if (!mine(key)) continue;
    if (!b.loaded) continue;
    const last = [...b.list].reverse().find(x => !x.pending && !x.failed);
    if (!last) continue;
    apiFetch(`/chat/channels/${key.slice(2)}/messages?after=${last.id}&limit=100`).then(async d => { for (const m of d.messages) addMessage(key, await openSdm(m)); }).catch(() => {});
  }
  const v = state.view;
  if (v.kind !== 'home' && (v.kind !== 'channel' ? inst === NOOKARA : instOf(v.cid) === inst)) loadMessages(v);
  if (inst !== NOOKARA) return;
  loadServers();
  if (state.nkHome) loadSocial(); // (requests and DMs on other homeservers that came in while the socket was down)
  // presence for the people on your home page (asked before the socket was ready, or stale after a reconnect)
  const names = new Set([...state.friends.map(f => f.friend_username), ...state.dms.map(c => c.username).filter(n => n !== 'System')]);
  [...names].slice(0, 150).forEach(username => send({ type: 'chat_presence', username }));
}

// an attachment as a link (DMs / group chats are plain text). Files in Nookara account storage (and old catbox ones) keep
// their real name as #n=<name>; a temporary-storage link (/t/<id>/<name>) already carries it in the path.
// my own accent colour is known right now: put it in the face cache an instance reads names through, so a message that is still
// sending shows the accent straight away (not the role colour until my Nookara face loads, then a flip)
function seedMyFace(instUser) {
  if (!nookaraId(instUser) || !state.me) return;
  const fid = String(nookaraId(instUser)), f = state.nookaraFaces[fid];
  if (!f || f.miss) set(s => ({ nookaraFaces: { ...s.nookaraFaces, [fid]: { id: fid, username: state.me.username, pfp: state.me.pfp || null, color: state.me.color || null, rank: state.me.rank } } }));
}
// ── messages sent while offline: they stay (greyed) and keep trying, then go red with Try again / Delete. Kept on this device
// (per account) until they go, so a reload doesn't lose them. Files still uploading aren't kept: only ones already uploaded.
const RETRY_GAPS = [2000, 4000, 8000, 15000, 30000, 30000, 60000, 60000]; // about 3.5 minutes of trying, then it goes red
const OUTBOX = () => acctKey('ember_outbox');
const sendInfo = new Map(); // nonce -> { v, text, replyTo, attachments, tries, at } for every send, so a failure can be queued
const outbox = new Map(); // nonce -> the same + failed, while it hasn't gone
const outboxTimers = new Map();
const slimReply = r => (r ? { id: r.id, imId: r.imId, gid: r.gid, alias: r.alias || null, author: r.author ? { username: r.author.username, pfp: r.author.pfp || null } : null, body: String(r.body || '').slice(0, 200) } : null);
function saveOutbox() {
  try { if (outbox.size) localStorage.setItem(OUTBOX(), JSON.stringify([...outbox.values()])); else localStorage.removeItem(OUTBOX()); } catch { /* storage full / private mode */ }
}
const outboxInst = item => (item.v.kind === 'channel' ? instOf(item.v.cid) : NOOKARA);
function showQueued(item) {
  const key = keyOf(item.v);
  const look = { pending: true, queued: !item.failed, inflight: !!item.sending, failed: item.failed ? 'offline' : undefined };
  set(s => ({ msgs: upd(s.msgs, key, b => {
    const list = b?.list || [];
    if (list.some(x => x.nonce === item.nonce)) return { ...b, list: list.map(x => (x.nonce === item.nonce ? { ...x, ...look } : x)) };
    const inst = outboxInst(item), me = inst === NOOKARA ? state.me : connections.get(inst)?.user || state.me;
    const temp = { id: item.nonce, nonce: item.nonce, ...look, body: item.text, wire: item.v.kind !== 'channel' ? wireText(item.text, item.attachments) : undefined, attachments: item.attachments || [], system: false,
      ...(inst !== NOOKARA ? { inst } : {}), author: { ...(me?.id ? { id: me.id } : {}), username: me?.username, pfp: me?.pfp, color: me?.color, rank: me?.rank, ...(nookaraId(me) ? { kind: me.kind || NOOKARA_WIRE, [NOOKARA_ID_FIELD]: nookaraId(me) } : {}) },
      created_at: item.at, reply: item.replyTo };
    return { list: [], hasMore: false, ...(b || {}), list: [...list, temp] };
  }) }));
}
function scheduleQueued(n, ms) {
  clearTimeout(outboxTimers.get(n));
  outboxTimers.set(n, setTimeout(() => resendQueued(n), ms));
}
// a send that couldn't go because a socket / the network is down: keep it and try again later. false = it isn't one of mine to keep
function queueOffline(n) {
  const info = sendInfo.get(n) || outbox.get(n);
  if (!info) return false;
  const item = { nonce: n, v: info.v, text: info.text, replyTo: info.replyTo, attachments: info.attachments, tries: info.tries, at: info.at, failed: info.tries >= RETRY_GAPS.length, sending: false, lastSend: outbox.get(n)?.lastSend };
  outbox.set(n, item);
  saveOutbox();
  showQueued(item);
  if (item.failed) { clearTimeout(outboxTimers.get(n)); outboxTimers.delete(n); } else scheduleQueued(n, RETRY_GAPS[item.tries]);
  return true;
}
// it went (the server's ack / echo, or a reload found it in the conversation): off the outbox
function sentOk(n) {
  if (!n || !outbox.delete(n)) return;
  clearTimeout(outboxTimers.get(n)); outboxTimers.delete(n);
  saveOutbox();
}
// a queued message goes again with the same nonce, and stays in the outbox (marked sending) until it's acknowledged, so a socket that
// drops in between can't lose it and Retry can't send it twice. fresh: Try again on a red one (the tries start over)
async function resendQueued(n, { fresh = false } = {}) {
  const item = outbox.get(n);
  if (!item || (!fresh && (item.failed || item.sending))) return false;
  clearTimeout(outboxTimers.get(n)); outboxTimers.delete(n);
  // encrypted DMs wait until this device's keys are open (just after a reload they still opening): no try counted
  if (item.v.kind === 'dm' && state.e2eeStatus !== 'ready' && !isBotPeer(item.v.username)) {
    if (state.e2eeStatus === 'loading') { scheduleQueued(n, 3000); return true; }
    item.failed = true; saveOutbox(); showQueued(item); // (encryption locked / not set up on this device: Try again once it is)
    return true;
  }
  // it was on its way when the page went away / the socket dropped: look in the conversation first, and only a load that worked counts
  if (item.check) {
    const key = keyOf(item.v);
    set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, loaded: false, error: undefined }) }));
    await loadMessages(item.v).catch(() => {});
    if (!outbox.has(n)) return true;
    const b = state.msgs[key];
    if (!b?.loaded || b.error) { scheduleQueued(n, 15000); return true; }
    item.check = false;
    if (deliveredIn(b.list, item)) { sentOk(n); set(s => ({ msgs: upd(s.msgs, key, x => x && { ...x, list: x.list.filter(m => m.nonce !== n) }) })); return true; }
  }
  item.failed = false;
  item.sending = true;
  item.lastSend = Date.now();
  saveOutbox();
  sendMessage(item.v, item.text, { replyTo: item.replyTo, attachments: item.attachments, noStatusReply: true, retry: { nonce: n, tries: fresh ? 0 : item.tries + 1, at: item.at } });
  return true;
}
// a real message of mine that is this queued one: the same text, and not older than the last time it went out (an earlier identical
// message doesn't count). Never sent at all = it can't be there.
function deliveredIn(list, item) {
  if (!item.lastSend) return false;
  const wire = item.v.kind === 'channel' ? item.text : wireText(item.text, item.attachments);
  return (list || []).some(m => !m.pending && isMine(m) && (m.wire ?? m.body) === wire && Number(m.created_at) >= item.lastSend - 5000);
}
// Try again on a red one: false = it isn't in the outbox (an older kind of failure)
export const retryQueued = n => { if (!outbox.has(n)) return false; resendQueued(n, { fresh: true }); return true; };
// a socket came back: everything waiting for it goes now. Ones that were mid-send on the old socket are checked against the
// conversation first, a moment later (catchUp is reloading it), so one that did arrive isn't sent twice
function flushOutbox(inst) {
  for (const item of [...outbox.values()]) {
    if (item.failed || outboxInst(item) !== inst) continue;
    if (item.sending) { item.sending = false; item.check = true; scheduleQueued(item.nonce, 4000); } else resendQueued(item.nonce);
  }
}
let outboxRestored = false;
function restoreOutbox() {
  if (outboxRestored) return;
  outboxRestored = true;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(OUTBOX()) || '[]'); } catch { /* broken: nothing to restore */ }
  for (const item of Array.isArray(list) ? list : []) {
    if (!item?.nonce || !item.v?.kind || typeof item.text !== 'string') continue;
    if (item.sending) { item.sending = false; item.check = true; } // (it was going when the page closed: maybe it got there)
    outbox.set(item.nonce, item);
    showQueued(item);
    if (!item.failed) scheduleQueued(item.nonce, item.check ? 6000 : RETRY_GAPS[Math.min(item.tries, RETRY_GAPS.length - 1)]);
  }
}
const isNetworkError = e => !e?.status && (e instanceof TypeError || ['offline', 'request_failed', 'instance_unreachable', 'instance_not_connected'].includes(e?.message));

// -> the pending copy's nonce (a forward watches it for the server's refusal). noStatusReply: a forward isn't the status reply being drafted
// retry (outbox only): { tries, at } of a queued message going again
export function sendMessage(v, text, { replyTo, attachments, uploads, noStatusReply, retry } = {}) {
  if (uploads?.length) { sendAfterUpload(v, text, { replyTo, attachments, uploads }); return undefined; }
  if (!retry) setTimeout(() => dispatchEvent(new CustomEvent('vc-sent', { detail: keyOf(v) })), 0); // the open conversation jumps to the bottom
  const key = keyOf(v);
  const n = retry?.nonce || `n${Date.now()}_${nonce++}`;
  if (v.kind !== 'modmail') {
    sendInfo.set(n, { v: { ...v }, text, replyTo: slimReply(replyTo), attachments: (attachments || []).filter(a => !a.local), tries: retry?.tries || 0, at: retry?.at || Date.now() });
    if (sendInfo.size > 300) sendInfo.delete(sendInfo.keys().next().value);
  }
  const instUser = v.kind === 'channel' && isInst(v.cid) ? connections.get(instOf(v.cid))?.user : null;
  const me = instUser || state.me; // an instance knows me by its own account
  // on an instance the pending copy carries the same author data (id / kind / nookara_id) and inst as the real message will, so
  // the picture and name colour resolve exactly the same way before and after the ack (no flash)
  seedMyFace(instUser);
  const temp = {
    id: n, nonce: n, pending: true, body: text, wire: v.kind !== 'channel' ? wireText(text, attachments) : undefined, attachments: attachments || [], system: false,
    ...(instUser ? { inst: instOf(v.cid), unsigned: !!nookaraId(instUser) && !signingInfo(v.sid).can } : {}),
    author: instUser ? { id: instUser.id, username: me.username, pfp: me.pfp, color: nookaraId(instUser) ? (state.me?.color || me.color) : me.color, rank: me.rank, kind: instUser.kind || (nookaraId(instUser) ? NOOKARA_WIRE : 'local'), [NOOKARA_ID_FIELD]: nookaraId(instUser) } : { username: me.username, pfp: me.pfp, color: me.color, rank: me.rank }, created_at: retry?.at || Date.now(),
    reply: replyTo ? { id: replyTo.id, author: replyTo.author, alias: replyTo.alias || null, body: String(replyTo.body || '').slice(0, 200) } : null,
    ...(retry ? { queued: true, inflight: true } : {}), // (going again: it stays on screen, greyed, until it's in)
  };
  if (v.kind !== 'group' || retry) { // (a group message shows no copy while it goes, except one going again from the outbox)
    // (not marked loaded: a forward into a conversation that was never opened must still fetch its history when it opens)
    // (going again: its copy is already there, it keeps its place)
    set(s => ({ msgs: upd(s.msgs, key, b => ({ list: [], hasMore: false, ...(b || {}), list: (b?.list || []).some(x => x.nonce === n) ? b.list.map(x => (x.nonce === n ? { ...x, ...temp, failed: undefined } : x)) : [...(b?.list || []), temp] })) }));
    if (v.kind !== 'group') pendingAcks.set(n, key); // (groups get no ack: their echo settles it)
  }
  if (state.settings.sounds && !retry) playPackSound('send'); // (only when a message sound pack is on)
  const sr = !noStatusReply && v.kind === 'dm' && state.statusReplyDraft && state.statusReplyDraft.username.toLowerCase() === String(v.username).toLowerCase() ? state.statusReplyDraft : null;
  if (sr) { temp.statusReply = sr.text; set({ statusReplyDraft: null }); }
  let ok;
  if (v.kind === 'notes') {
    apiFetch('/chat/notes', { method: 'POST', body: JSON.stringify({ body: wireText(text, attachments), nonce: n }) })
      .then(d => { sentOk(n); set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: ordered(settle(b.list, n, noteToMsg(d.note))) }) })); })
      .catch(e => { if (isNetworkError(e) && queueOffline(n)) return; set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: e.message } : x)) }) })); });
    return n;
  }
  if (v.kind === 'modmail') { // staff writing as Nookara Administrator
    apiFetch(`/chat/modmail/with/${encodeURIComponent(v.username)}`, { method: 'POST', body: JSON.stringify({ body: text }) })
      .then(d => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: ordered(b.list.map(x => (x.nonce === n ? mmToMsg(d.message) : x))) }) })))
      .catch(e => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: e.message } : x)) }) })));
    return n;
  }
  const sdm = v.kind === 'channel' && isInst(v.cid) ? sdmOf(v.cid) : null;
  if (sdm) { // a DM on a homeserver: sealed first (or held on this device while someone in it has no keys), never sent as it is
    ok = true;
    sendSdm({ nonce: n, dm: sdm.id, me: E2EE.mySid(), key, cid: v.cid, wire: wireText(text, attachments), reply_to: replyTo?.id, quote: replyTo ? { from: replyTo.author?.display_name || replyTo.author?.username || '', s: String(replyTo.body || '').slice(0, 200) } : null, created_at: retry?.at || Date.now() });
  } else if (v.kind === 'channel' && isDmServer(v)) { // a DM I can't find the members of: nothing leaves as plain text, ever
    ok = true;
    pendingAcks.delete(n);
    set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: 'dm_not_found' } : x)) }) }));
  } else if (v.kind === 'channel') {
    const info = signingInfo(v.sid);
    const frame = signature => send({ type: 'chat_send', channel: v.cid, message: text, reply_to: replyTo?.id, attachments, signature, nonce: n });
    if (isInst(v.sid)) { // saved files must live on this instance before their hashes can be signed
      ok = true;
      (async () => {
        attachments = await prepareAttachments(v, attachments || []);
        let signature;
        if (info.can) {
          try { signature = await signMessage({ instance: instOf(v.sid), community: bare(v.sid), channel: bare(v.cid), author: nookaraId(connections.get(instOf(v.sid)).user), body: normBody(text), attachments: attachmentRefs(attachments), reply_to: replyTo?.id ?? null, edit_of: null }, connections.get(instOf(v.sid)).info); }
          catch { if (!(await askSendUnsigned())) throw new Error('sign_failed'); }
        }
        if (signature) signedSends.set(n, () => frame(undefined));
        else if (info.can) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, unsigned: true } : x)) }) }));
        if (!frame(signature)) throw new Error('offline');
      })().catch(e => {
        pendingAcks.delete(n);
        signedSends.delete(n);
        if (isNetworkError(e) && queueOffline(n)) return;
        if (e.message !== 'sign_failed') toast(errorText(e.message)); // (they just said no: the message's own line says it)
        set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: e.message } : x)) }) }));
      });
    } else ok = frame();
  } else if (v.kind === 'dm') { // encrypted first, so it goes when that's done: failures come back the same way the server's would
    ok = true;
    sendDm({ nonce: n, to: v.username, key, wire: wireText(text, attachments), reply_to: replyTo?.imId, quote: replyTo ? { from: replyTo.author?.username || '', s: String(replyTo.body || '').slice(0, 200) } : null, status_reply: sr ? { text: sr.text } : undefined });
  } else {
    ok = send({ type: 'roomMessage', room: v.room, message: wireText(text, attachments), reply_to: replyTo?.gid });
    if (ok && retry) { sentOk(n); set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.filter(x => x.nonce !== n) }) })); } // (no ack for groups: its echo shows it)
  }
  if (!ok) { pendingAcks.delete(n); if (!queueOffline(n)) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: 'offline' } : x)) }) })); }
  setTyping(v, false);
  return n;
}
// ── bots in DMs: never encrypted, no key lookups, no "set up encryption" (Ikelene, 2026-11-12: "bots cant use it") ──
export const isBotPeer = username => !!username && !!state.botPeers[String(username).toLowerCase()];
export function markBotPeer(username) {
  const k = String(username || '').toLowerCase();
  if (!k || state.botPeers[k]) return;
  set(s => ({ botPeers: { ...s.botPeers, [k]: true } }));
}
// a DM opened before any message says who they are (a link, the quick switcher): ask once whether it's a bot
const botChecked = new Set();
export function checkBotPeer(username) {
  const k = String(username || '').toLowerCase();
  if (!k || k === 'system' || state.botPeers[k] || botChecked.has(k)) return;
  botChecked.add(k);
  apiFetch(`/chat/users/${encodeURIComponent(username)}`).then(d => { if (d?.bot?.bot) markBotPeer(username); }).catch(() => botChecked.delete(k));
}
export const useBotPeer = username => useChat(s => !!username && !!s.botPeers[String(username).toLowerCase()]);
// ── encrypted DMs going out ──
const dmSends = new Map(); // nonce -> what it was, until the server took it
async function sendDm(d) {
  dmSends.set(d.nonce, d);
  const patch = f => set(s => ({ msgs: upd(s.msgs, d.key, b => b && { ...b, list: b.list.map(x => (x.nonce === d.nonce ? f(x) : x)) }) }));
  if (isBotPeer(d.to)) { // a bot: plain text straight away, whatever this device's encryption state is
    if (!send({ type: 'im_send', to: d.to, message: d.wire, reply_to: d.reply_to, nonce: d.nonce })) { dmSends.delete(d.nonce); if (!queueOffline(d.nonce)) patch(x => ({ ...x, failed: 'offline' })); return; }
    pendingAcks.set(d.nonce, d.key);
    return;
  }
  try {
    const enc = await E2EE.seal(d.to, d.wire, { replyQuote: d.quote, fresh: !!d.retried });
    if (!send({ type: 'im_send', to: d.to, enc, reply_to: d.reply_to, status_reply: d.status_reply, nonce: d.nonce })) throw new Error('offline');
    pendingAcks.set(d.nonce, d.key);
    patch(x => (x.waiting ? { ...x, waiting: false } : x));
    E2EE.release(d.nonce);
  } catch (e) {
    dmSends.delete(d.nonce);
    if (e.message === 'no_keys') { // they haven't set up encrypted DMs: it goes unencrypted, and says so (Ikelene, 2026-11-06). They set up to reply.
      // (a file that was encrypted for this message would put its key in plain text: those only go once they have keys)
      if (/#nke=/.test(d.wire)) { pendingAcks.delete(d.nonce); patch(x => ({ ...x, failed: 'plain_files' })); return; }
      dmSends.set(d.nonce, d);
      if (!send({ type: 'im_send', to: d.to, message: d.wire, reply_to: d.reply_to, status_reply: d.status_reply, nonce: d.nonce })) { dmSends.delete(d.nonce); pendingAcks.delete(d.nonce); if (!queueOffline(d.nonce)) patch(x => ({ ...x, failed: 'offline' })); return; }
      pendingAcks.set(d.nonce, d.key);
      patch(x => (x.waiting ? { ...x, waiting: false } : x));
      E2EE.release(d.nonce);
      return;
    }
    pendingAcks.delete(d.nonce);
    if (isNetworkError(e) && queueOffline(d.nonce)) return;
    patch(x => ({ ...x, failed: e.message }));
  }
}
E2EE.setOutboxSender(h => sendDm({ ...h, key: `d:${String(h.to).toLowerCase()}` }));

// ── a DM on a homeserver (two people or a group): sealed to every member's keys (e2ee/homedm.js) ──
// Nookara's own DMs above are untouched. These are a homeserver's one-channel "servers" (seedDm): every message in them is
// an envelope, and nothing is ever sent to the host any other way.
const sdmOf = cid => (soc() && cid ? dmOfChannel(cid) : null);
// is this view / message in a DM's one-channel server, whether or not the DM list has it right now
const isDmServer = v => !!(v?.dm || state.detail[v?.sid || v?.server]?.server?.dm);
const sdmMsg = o => (o?.sealed ? { ...o, attachments: sealedAtts(o) } : o);
// a message of a DM's channel as the list keeps it: opened here, when this device can
function openSdm(msg, dm = sdmOf(msg?.channel)) {
  if (!dm || !msg?.enc) return Promise.resolve(msg);
  return E2EE.openDmMessage(msg, dm).then(sdmMsg).catch(() => ({ ...msg, body: '', sealed: { v: 2, state: 'failed' } }));
}
// a member of a homeserver DM got a new key: wrap what this device can open again for it, so they can read it too (PROTOCOL
// §4d.3). Only messages this device has opened can be wrapped; the host says which ones still lack a wrap.
export async function rewrapDm(id, member) {
  const dm = state.social.dms.find(x => x.id === id), host = dmHostOf(dm);
  if (!dm || !host || !(await ensureHost(host))) { toast("Couldn't reach that conversation's homeserver."); return 0; }
  const at = `/api/v2/social/dms/${encodeURIComponent(id)}/rewrap`;
  const open = new Map();
  for (const [k, b] of Object.entries(state.msgs)) if (k.startsWith('c:') && sdmOf(k.slice(2))?.id === id) for (const m of b?.list || []) if (m.sealed?.key) open.set(bare(m.id), { id: bare(m.id), key: m.sealed.key });
  let added = 0;
  try {
    for (const k of await E2EE.memberKeys(member)) {
      const need = await apiFetch(`${at}?member=${encodeURIComponent(member)}&kid=${encodeURIComponent(k.kid)}`, { inst: host });
      const items = (need?.messages || []).map(x => open.get(bare(String(x)))).filter(Boolean).slice(0, 500);
      if (!items.length) continue;
      const wraps = await E2EE.wrapsFor(items, k);
      const r = await apiFetch(at, { method: 'POST', inst: host, body: JSON.stringify({ member, kid: k.kid, wraps }) });
      added += Number(r?.added) || 0;
    }
    toast(added ? `They can read ${added} earlier message${added === 1 ? '' : 's'} again.` : 'Nothing this device has open is missing for them. Scroll up to load older messages and try again.', !!added);
  } catch (e) { toast(socialErrorText(e)); }
  return added;
}
// social_dm_rewrapped: messages of a DM were wrapped again for my key - what this device has of it is opened again
export function dmRewrapped(id) {
  const dm = state.social.dms.find(x => x.id === id);
  if (!dm) return;
  set(s => ({ msgs: Object.fromEntries(Object.entries(s.msgs).filter(([k]) => !(k.startsWith('c:') && sdmOf(k.slice(2))?.id === id))) }));
  if (state.view.dm === id) loadMessages(state.view);
}
// messages of a channel fetched elsewhere (pins, search): a homeserver DM's opened on this device, others as they are
export const openChannelMessages = list => Promise.all((list || []).map(m => openSdm(m)));
const hdSends = new Map(); // nonce -> what went out, until the host took it (stale_keys: once more, with fresh keys)
const freshAt = new Map(); // dm id -> when everyone's keys were last asked for afresh (held messages ask again and again)
const hdDeps = () => ({
  dmOf: id => state.social.dms.find(x => x.id === id) || null,
  bundlesFor(dm, { fresh = false } = {}) {
    const f = fresh && Date.now() - (freshAt.get(dm.id) || 0) > 60000;
    if (f) freshAt.set(dm.id, Date.now());
    return E2EE.bundlesForDm(dm, { fresh: f });
  },
  seal: ({ dm, bundles, text, quote, preview }) => E2EE.sealDm(dm, text, { replyQuote: quote, preview, bundles }),
  // the only thing that reaches the host: an envelope
  async post(dm, enc, item) {
    const host = dmHostOf(dm), cid = K(host, dm.channel);
    if (!host || !dm.channel || !(await ensureHost(host))) throw new Error('offline');
    hdSends.set(item.nonce, item);
    if (!send({ type: 'chat_send', channel: cid, enc, reply_to: item.reply_to, nonce: item.nonce })) { hdSends.delete(item.nonce); throw new Error('offline'); }
    pendingAcks.set(item.nonce, item.key || `c:${cid}`);
    sdmPatch(item, x => (x.waiting ? { ...x, waiting: false, missing: undefined } : x));
  },
  hold: item => E2EE.hold(item),
  release: nonce => E2EE.release(nonce),
});
const sdmPatch = (d, f) => set(s => ({ msgs: upd(s.msgs, d.key, b => b && { ...b, list: b.list.map(x => (x.nonce === d.nonce ? f(x) : x)) }) }));
async function sendSdm(d) {
  try {
    const dm = hdDeps().dmOf(d.dm);
    // the link preview is made here, on this device, and goes inside the message (no server is asked about the link)
    if (dm && d.preview === undefined) d.preview = state.settings?.link_previews !== false ? await makePreview(d.wire, dm).catch(() => null) : null;
    const r = await sendOrHold(d, hdDeps(), { fresh: !!d.retried });
    if (r.held) { pendingAcks.delete(d.nonce); sentOk(d.nonce); sdmPatch(d, x => ({ ...x, waiting: true, missing: r.missing, failed: undefined, queued: undefined, inflight: undefined })); }
  } catch (e) {
    pendingAcks.delete(d.nonce); hdSends.delete(d.nonce);
    if (isNetworkError(e) && queueOffline(d.nonce)) return;
    sdmPatch(d, x => ({ ...x, failed: e.message }));
  }
}
E2EE.setDmOutboxSender(items => flushHeld(items, E2EE.mySid() || '', hdDeps()));
E2EE.setNookaraSid(() => state.nkHome?.id || null);
// what a page says about itself, as far as a browser is allowed to read it (most sites don't allow it: then there is no preview)
async function makePreview(wire, dm) {
  const url = firstLink(wire);
  if (!url || !/^https:/i.test(url)) return null;
  const get = async (u, max) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    try {
      const r = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
      if (!r.ok || Number(r.headers.get('content-length') || 0) > max) return null;
      const blob = await r.blob();
      return blob.size <= max ? blob : null;
    } catch { return null; } finally { clearTimeout(t); }
  };
  const page = await get(url, 1024 * 1024);
  if (!page || !/html/i.test(page.type)) return null;
  const og = parseOg(await page.text(), url);
  let image = '';
  if (og.image && /^https:/i.test(og.image)) {
    const pic = await get(og.image, 512 * 1024);
    if (pic && /^image\/(png|jpeg|gif|webp)$/i.test(pic.type)) {
      try { image = (await uploadSealed(dm, new File([pic], 'preview', { type: pic.type }))).url; } catch { /* no picture then */ }
    }
  }
  return cleanPreview({ url, title: og.title, description: og.description, image });
}
// a file of a homeserver DM: encrypted here, kept by the host as bytes it can't open; its key travels inside the message
async function uploadSealed(dm, file, opts = {}) {
  const host = dmHostOf(dm);
  const { upload, key, iv } = await E2EE.sealFile(file);
  const fd = new FormData();
  fd.append('file', upload);
  const d = await uploadFetch(`/chat/media/upload?sid=${K(host, dm.sid)}&cid=${K(host, dm.channel)}&sealed=1`, fd, opts);
  const at = absUrl(host, d.url);
  if (!at) throw new Error('upload_failed');
  return { url: E2EE.fileLink(at, { key, iv, name: file.name, mime: file.type }), sealed: true, type: fileKindOfMime(file.type), name: file.name, size: file.size };
}
// ── reporting a message of a homeserver DM (e2ee/report.js): to whoever manages the SENDER's account ──
// where this message's report would go, or null when it can't be reported from here (mine, not opened on this device)
export function sdmReportRoute(view, m) {
  const h = soc();
  if (!h?.id || !view?.dm || !m?.sealed) return null;
  return canReportSealed(m, m.sealed.from, { id: h.id }) ? reportRoute(m.sealed.from, { id: h.id }) : null;
}
const jsonPost = async (url, body, token) => {
  let res;
  try { res = await fetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); }
  catch { throw Object.assign(new Error('unreachable'), { error: 'unreachable' }); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d?.error || 'request_failed'), d && typeof d === 'object' ? d : {}, { status: res.status });
  return d || {};
};
// -> the answer ({ duplicate? }). The report holds the sealed message and its one key: nothing else of the conversation
export async function sendSdmReport(view, m, reason, details) {
  const h = soc(), route = sdmReportRoute(view, m);
  const body = route && reportBody(route, { dm: view.dm, id: m.id, from: m.sealed.from, envelope: m.enc, key: m.sealed.key, reason, details });
  if (!body) throw new Error('cannot_report');
  // the sender's homeserver, by its domain's discovery document
  const info = await resolveHomeserver(route.domain).then(hs => homeInfo(hs.origin)).catch(() => null);
  if (route.to === 'nookara') {
    // a Nookara account: Nookara's report route, as the discovery document of its domain names it (social.reports_url)
    const url = info?.reports_url || (await domainReportsUrl(route.domain).catch(() => null)); // (else the domain's own doc says)
    if (h.nookara && route.own) return apiFetch(url && new URL(url).origin === normOrigin(NOOKARA_ORIGIN) ? new URL(url).pathname : '/api/report/dm-message', { method: 'POST', body: JSON.stringify(body) });
    if (!url) throw Object.assign(new Error('no_reports_url'), { error: 'no_reports_url' });
    if (isOwnUrl(url)) { const res = await homeFetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); const d = await res.json().catch(() => ({})); if (!res.ok) throw Object.assign(new Error(d?.error || 'request_failed'), d); return d; }
    // from another homeserver: a token my home signs for Nookara, good for this one report
    return jsonPost(url, body, await remoteToken(new URL(url).origin));
  }
  // any other homeserver's own account: its admins. My own home takes it with the session I have; another one with the
  // session my home (or Nookara) gets me there
  try {
    if (route.own && !h.nookara) return await socialFetch('/social/reports', { method: 'POST', body });
    if (!info) throw Object.assign(new Error('homeserver_unreachable'), { error: 'homeserver_unreachable' });
    const at = new URL(`${info.api_url}/social/reports`), host = normOrigin(at.origin);
    if (!(await ensureHost(host))) throw Object.assign(new Error('homeserver_unreachable'), { error: 'homeserver_unreachable' });
    return await apiFetch(at.pathname, { inst: host, method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    // 409 report_elsewhere { url }: the sender's account is managed somewhere else (a Nookara account, or another homeserver):
    // send the same report there once, never further
    const url = (e?.error || e?.message) === 'report_elsewhere' && (e.url || e.body?.url);
    if (!url || !/^https?:\/\//.test(url)) throw e;
    if (h.nookara && normOrigin(new URL(url).origin) === normOrigin(NOOKARA_ORIGIN)) return apiFetch(new URL(url).pathname, { method: 'POST', body: JSON.stringify(body) });
    return jsonPost(url, body, await remoteToken(new URL(url).origin));
  }
}
// who a held message waits for, by name
export function waitingNames(dmId, missing) {
  const dm = state.social.dms.find(x => x.id === dmId);
  return (missing || []).map(id => { const m = dm?.members.find(x => x.id === id); return m?.display_name || String(m?.handle || id).split('@')[0]; });
}
// held messages show in their conversation again after a reload
async function showHeld() {
  for (const h of await E2EE.held()) {
    if (h.dm && (h.me !== E2EE.mySid() || !h.key)) continue; // (a homeserver DM's, of another account on this device)
    const key = h.dm ? h.key : `d:${String(h.to).toLowerCase()}`;
    if (state.msgs[key]?.list.some(x => x.nonce === h.nonce)) continue;
    const lines = String(h.wire).split('\n');
    const links = lines.filter(l => E2EE.parseFileLink(l.trim()));
    const temp = { id: h.nonce, nonce: h.nonce, pending: true, waiting: true, ...(h.dm ? { missing: h.missing || [], channel: h.cid } : {}), body: lines.filter(l => !E2EE.parseFileLink(l.trim())).join('\n'), wire: h.wire, attachments: sealedAtts({ sealed: { files: links.map(l => l.trim()) } }), system: false, author: { username: state.me?.username, pfp: state.me?.pfp, color: state.me?.color, rank: state.me?.rank }, created_at: h.created_at };
    set(s => ({ msgs: upd(s.msgs, key, b => ({ list: [], hasMore: false, ...(b || {}), list: [...(b?.list || []), temp] })) }));
  }
}
E2EE.onChange(st => {
  const was = state.e2eeStatus;
  set({ e2eeStatus: st });
  if (st === 'ready' && was !== 'ready') { // what was locked can be opened now
    set(s => ({ msgs: Object.fromEntries(Object.entries(s.msgs).filter(([k]) => !k.startsWith('d:') && !(k.startsWith('c:') && sdmOf(k.slice(2))))) }));
    if (state.view?.kind === 'dm' || state.view?.dm) loadMessages(state.view);
    if (state.signedIn) loadDMs();
    showHeld();
    if (state.signedIn) flushOutbox(NOOKARA); // (queued DMs waited for the keys)
  }
  if (st === 'none' || st === 'locked') { // says so once a visit, and "Later" is always there
    let seen = true; try { seen = !!sessionStorage.getItem('ember.e2eeAsked'); sessionStorage.setItem('ember.e2eeAsked', '1'); } catch { /* private mode: ask each load */ seen = false; }
    if (!seen && !was.startsWith('r')) set({ e2eeGate: 'auto' });
  }
});
E2EE.onKeyChange(username => set(s => ({ e2eeKeyChanged: { ...s.e2eeKeyChanged, [String(username).toLowerCase()]: true } })));
export const openE2eeGate = (mode = 'ask') => set({ e2eeGate: mode }); // ('auto': the once-a-visit nudge, below)
export const closeE2eeGate = () => set({ e2eeGate: null });
export const dismissKeyChange = username => set(s => { const k = { ...s.e2eeKeyChanged }; delete k[String(username).toLowerCase()]; return { e2eeKeyChanged: k }; });
const SIGN_REFUSED = new Set(['bad_signature', 'signing_unavailable']);
const signedSends = new Map(); // nonce -> send it again without a signature (until the instance has answered)
export function dropFailed(v, n) {
  if (outbox.delete(n)) { clearTimeout(outboxTimers.get(n)); outboxTimers.delete(n); saveOutbox(); }
  const m = state.msgs[keyOf(v)]?.list.find(x => x.nonce === n);
  if (m?.waiting) E2EE.release(n);
  if (m?.uploads) { uploadAborts.get(n)?.abort(); uploadAborts.delete(n); m.attachments.forEach(a => a.local && URL.revokeObjectURL(a.url)); }
  set(s => ({ msgs: upd(s.msgs, keyOf(v), b => b && { ...b, list: b.list.filter(x => x.nonce !== n) }) }));
}

// Files picked in the composer upload only once the message is sent. Meanwhile the message sits at the bottom of the
// conversation with the files' previews and a progress bar (the composer is free for other messages); when every file is
// up, the placeholder goes and the real message (text + files) is sent the normal way.
// uploads: [{ file, spoiler }]
const uploadAborts = new Map(); // nonce -> AbortController
export const fileKind = f => (/^image\/gif$/.test(f.type) ? 'gif' : /^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video' : /^audio\//.test(f.type) ? 'audio' : 'file');
function sendAfterUpload(v, text, { replyTo, attachments = [], uploads }) {
  setTimeout(() => dispatchEvent(new CustomEvent('vc-sent', { detail: keyOf(v) })), 0);
  const key = keyOf(v);
  const n = `u${Date.now()}_${nonce++}`;
  const instUser = v.kind === 'channel' && isInst(v.cid) ? connections.get(instOf(v.cid))?.user : null;
  const me = instUser || state.me;
  const total = uploads.reduce((t, u) => t + u.file.size, 0) || 1;
  const previews = uploads.map(u => ({ url: URL.createObjectURL(u.file), type: fileKind(u.file), name: spoilerName(u.file.name, u.spoiler), size: u.file.size, local: true }));
  seedMyFace(instUser);
  const temp = {
    id: n, nonce: n, pending: true, uploading: { sent: 0, total }, uploads, ready: attachments, body: text, attachments: [...attachments, ...previews], system: false,
    ...(instUser ? { inst: instOf(v.cid) } : {}),
    author: instUser ? { id: instUser.id, username: me.username, pfp: me.pfp, color: nookaraId(instUser) ? (state.me?.color || me.color) : me.color, rank: me.rank, kind: instUser.kind || (nookaraId(instUser) ? NOOKARA_WIRE : 'local'), [NOOKARA_ID_FIELD]: nookaraId(instUser) } : { username: me.username, pfp: me.pfp, color: me.color, rank: me.rank }, created_at: Date.now(),
    reply: replyTo ? { id: replyTo.id, author: replyTo.author, alias: replyTo.alias || null, body: String(replyTo.body || '').slice(0, 200) } : null, replyTo,
  };
  const patch = f => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? f(x) : x)) }) }));
  set(s => ({ msgs: upd(s.msgs, key, b => ({ list: [], hasMore: false, loaded: true, ...(b || {}), list: [...(b?.list || []), temp] })) }));
  setTyping(v, false);
  const ctrl = new AbortController();
  uploadAborts.set(n, ctrl);
  (async () => {
    const done = [];
    let before = 0, shown = -1;
    for (const u of uploads) {
      const file = u.spoiler ? new File([u.file], spoilerName(u.file.name, true), { type: u.file.type }) : u.file;
      const a = await uploadAttachment(v, file, {
        dest: u.dest,
        expires: u.expires, // a Nookara Pro member's picked expiry (days or 'max'), temporary storage only
        signal: ctrl.signal,
        onProgress: sent => {
          const pct = Math.floor(((before + Math.min(sent, u.file.size)) / total) * 100);
          if (pct !== shown) { shown = pct; patch(x => ({ ...x, uploading: { sent: before + sent, total } })); }
        },
      });
      // the spoiler marker is in the name the server was told: make sure it survives whatever the server did to it
      done.push(u.spoiler ? { ...a, name: spoilerName(a.name || u.file.name, true) } : a);
      before += u.file.size;
    }
    return done;
  })().then(done => {
    uploadAborts.delete(n);
    if (ctrl.signal.aborted) return; // cancelled (a reload that dropped the placeholder doesn't stop the send)
    previews.forEach(p => URL.revokeObjectURL(p.url));
    set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.filter(x => x.nonce !== n) }) }));
    sendMessage(v, text, { replyTo, attachments: [...attachments, ...done] });
  }).catch(e => {
    uploadAborts.delete(n);
    if (e.name === 'AbortError') return;
    toast(errorText(e.message));
    patch(x => ({ ...x, uploading: null, failed: e.message || 'upload_failed' }));
  });
}
let lastTyping = 0;
export function setTyping(v, on = true) {
  if (state.settings.share_typing === false) return;
  const now = Date.now();
  if (on && now - lastTyping < 3000) return;
  lastTyping = on ? now : 0;
  if (v.kind === 'channel') send({ type: 'chat_typing', channel: v.cid, typing: on });
  else if (v.kind === 'dm') send({ type: 'dm_typing', to: v.username, typing: on });
}
// a message that couldn't be signed: the person decides, it's never dropped or sent unsigned behind their back
export const askSendUnsigned = (edit = false) => ask({
  title: edit ? "This edit couldn't be signed" : "This message couldn't be signed",
  text: `Signing shows people it really came from your Nookara account, and it didn't work this time. You can ${edit ? 'save it' : 'send it'} without a signature, but people here will see it marked as unsigned.`,
  confirm: edit ? 'Save unsigned' : 'Send unsigned',
}).then(Boolean);
// can this device sign in that community? (instances in Nookara mode: signing is always allowed there, never required)
export function signingInfo(sid) {
  const inst = instOf(sid || '');
  const c = inst === NOOKARA ? null : connections.get(inst);
  const allow = isNookara(c?.info?.accounts_mode);
  return { allow, can: allow && canSign() && !!nookaraId(c.user) };
}
// a conversation's pin list changed: an open panel loads it again (a channel by its cid, a DM by d:<name>, a group by g:<room>)
function bumpPins(key) { set(s => ({ pinsVersion: { ...s.pinsVersion, [key]: (s.pinsVersion[key] || 0) + 1 } })); }
export async function editMessage(id, text, m) {
  if (m?.noteId) { await apiFetch(`/chat/notes/${m.noteId}`, { method: 'PATCH', body: JSON.stringify({ body: text }) }); return; } // (every device gets note_edited)
  // a group message: everyone gets room_message_edited
  if (m?.gid && m?.room) { await apiFetch(`/groups/${encodeURIComponent(m.room)}/messages/${encodeURIComponent(m.gid)}`, { method: 'PATCH', body: JSON.stringify({ message: text }) }); return; }
  // a DM (im<id>): its own route; both people get im_edited
  if (/^im\d+$/.test(String(id))) {
    // an unencrypted DM to someone who still hasn't set up stays unencrypted
    // (a DM with a bot is always plain: no key lookup)
    if (!m?.sealed && m?.author?.username === state.me?.username && (isBotPeer(state.view?.username) || (await E2EE.bundleFor(state.view?.username, { fresh: true }).catch(() => ({}))).none)) {
      await apiFetch(`/im/${String(id).slice(2)}/edit`, { method: 'PATCH', body: JSON.stringify({ body: text }) });
      return;
    }
    const wire = [text, ...(m?.sealed?.files || [])].filter(Boolean).join('\n'); // (the text changes, the files stay)
    const peer = String(m.fromId) === String(m.toId) ? state.me?.username : (m.author?.username === state.me?.username ? state.view?.username : m.author?.username);
    const enc = await E2EE.sealEdit({ fromId: m.fromId, toId: m.toId, imId: m.imId, peer, quote: m.quote }, wire);
    await apiFetch(`/im/${String(id).slice(2)}/edit`, { method: 'PATCH', body: JSON.stringify({ enc }) });
    return;
  }
  const inst = m?.channel ? instOf(m.channel) : NOOKARA;
  const sdm = m?.channel && inst !== NOOKARA ? sdmOf(m.channel) : null;
  if (sdm) { // a homeserver DM: sealed again, signed as an edit of this message (the files and the reply quote stay)
    const wire = [text, ...(m?.sealed?.files || [])].filter(Boolean).join('\n');
    const enc = await E2EE.sealDm(sdm, wire, { replyQuote: m.sealed?.quote || null, preview: m.sealed?.preview && text.includes(m.sealed.preview.url) ? m.sealed.preview : null, editOf: id, fresh: true });
    await apiFetch(`/chat/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ enc }), inst });
    return;
  }
  if (isDmServer(m)) throw new Error('dm_not_found'); // (never as plain text)
  let signature;
  const info = m?.channel ? signingInfo(m.server) : null;
  if (info?.can) {
    try { signature = await signMessage({ instance: inst, community: bare(m.server), channel: bare(m.channel), author: nookaraId(connections.get(inst).user), body: normBody(text), attachments: attachmentRefs(m.attachments || []), reply_to: m.reply_to ?? m.reply?.id ?? null, edit_of: id, sticker: m.sticker?.tid ?? null }, connections.get(inst).info); }
    catch { if (!(await askSendUnsigned(true))) throw new Error('sign_failed'); }
  }
  const patch = sig => apiFetch(`/chat/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ message: text, signature: sig }), inst: inst === NOOKARA ? undefined : inst });
  try { await patch(signature); } catch (e) {
    if (!signature || !SIGN_REFUSED.has(e.message)) throw e;
    refreshSigningKey();
    if (!(await askSendUnsigned(true))) throw new Error('sign_failed');
    await patch(undefined);
  }
}
export async function deleteMessage(v, m) {
  if (v.kind === 'channel') await apiFetch(`/chat/messages/${m.id}`, { method: 'DELETE', inst: isInst(v.cid) ? instOf(v.cid) : undefined });
  else if (v.kind === 'dm') {
    await apiFetch(`/im/${m.imId}`, { method: 'DELETE' });
    set(s => ({ msgs: upd(s.msgs, keyOf(v), b => b && { ...b, list: b.list.filter(x => x.id !== m.id) }) }));
  } else if (v.kind === 'notes' && m.noteId) {
    await apiFetch(`/chat/notes/${m.noteId}`, { method: 'DELETE' });
    dropNote(m.noteId);
  } else if (v.kind === 'group' && m.gid) {
    await apiFetch(`/groups/${encodeURIComponent(v.room)}/messages/${encodeURIComponent(m.gid)}`, { method: 'DELETE' }); // everyone gets room_message_deleted
    dropGroupMessage(v.room, m.gid);
  }
}
function dropNote(noteId) {
  const id = `note${noteId}`;
  set(s => ({ msgs: upd(s.msgs, 'n:', b => b && { ...b, list: b.list.filter(x => x.id !== id) }) }));
}
function dropGroupMessage(room, gid) {
  const id = `g${gid}`;
  set(s => ({ msgs: upd(s.msgs, `g:${room}`, b => b && { ...b, list: b.list.filter(x => x.id !== id).map(x => (x.reply?.id === id ? { ...x, reply: null } : x)) }) }));
}
// a picture / video / audio file -> your Nookara storage (it shows up in Saved Media too)
export async function uploadMedia(file) {
  if (file.size > PIECES_OVER) { const d = await uploadInPieces('account', file); if (state.savedMedia) loadMedia(); return d.attachment; } // (same storage: Saved Media)
  const fd = new FormData();
  fd.append('file', file);
  const d = await uploadFetch('/chat/media/upload', fd);
  if (state.savedMedia) loadMedia();
  return d.attachment;
}
export const upload = uploadMedia;
// the real upload limits (MB), asked from Nookara once: a file sent in a conversation / a file kept on your Nookara account
let uploadLimits = { server_mb: 200, saved_mb: 100 };
let limitsAsked = null;
export const getUploadLimits = () => uploadLimits;
export function loadUploadLimits() {
  return (limitsAsked ||= apiFetch('/chat/media/limits')
    .then(d => { if (d?.server_mb) uploadLimits = { server_mb: d.server_mb, saved_mb: d.saved_mb || uploadLimits.saved_mb }; return uploadLimits; })
    .catch(() => { limitsAsked = null; return uploadLimits; }));
}
// files straight into Saved Media (your Nookara storage), not into a message
export async function saveFilesToMedia(files) {
  const cap = uploadLimits.saved_mb;
  let n = 0;
  for (const f of [...files].slice(0, 10)) {
    if (f.size > cap * 1024 * 1024) { toast(`${f.name} is too big - files kept on your account go up to ${cap} MB.`); continue; }
    try { await uploadMedia(f); n++; } catch (e) { toast(errorText(e.message)); }
  }
  if (n) { toast(n === 1 ? 'Saved to Saved Media.' : `Saved ${n} files to Saved Media.`, true); loadMedia(); }
  return n;
}
// any picture / GIF / video / sound in a message -> Saved Media (Klipy GIFs as a link, Nookara files as your own copy)
const SAVE_ERR = { cant_save_that: "That can't be saved - only pictures, videos and sounds sent in Ember can.", storage_limit_exceeded: "That doesn't fit in your Nookara storage." };
export async function saveToMedia(url, name) {
  try {
    if (/^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(url)) await apiFetch('/chat/media/gif', { method: 'POST', body: JSON.stringify({ url, preview: url, title: name || '' }) });
    else {
      const d = await apiFetch('/chat/media/save', { method: 'POST', body: JSON.stringify({ url, name }) });
      if (d.status === 'already') { toast("It's already in your Saved Media.", true); return; }
    }
    toast('Saved to Saved Media.', true);
    loadMedia();
  } catch (e) { toast(SAVE_ERR[e.message] || errorText(e.message)); }
}
// A file sent in a DM / group chat (anything not on an Ember instance) goes to one of two places on Nookara:
//   'temp'    Nookara's temporary storage (/t/<id>/<name>): free, deleted on a fixed date (opening it never moves it)
//   'account' your Nookara account storage: counts toward your storage, stays until you delete it
// (pictures / videos / sounds show inline, the rest is a download card). Which one: the chat setting dm_upload_dest
// ('ask' | 'account' | 'temp', synced to the account) with a copy in localStorage, or the picker below when it's 'ask'.
// opts.expires: a picked expiry (days, or 'max') - Nookara Pro only, the server refuses it otherwise (pro_required).
// Every file's date is fixed when it is sent and opening it never moves it. Left out = the normal lifetime for the file.
export async function uploadTemp(file, opts = {}) {
  if (file.size > PIECES_OVER) return (await uploadInPieces('temp', file, opts)).attachment; // (too big for one request through Cloudflare)
  const fd = new FormData();
  if (opts.expires != null && opts.expires !== 'default') fd.append('expires_in_days', String(opts.expires));
  fd.append('file', file);
  const d = await uploadFetch('/chat/media/temp', fd, opts);
  return d.attachment;
}
export async function uploadAccount(file, opts = {}) {
  const fd = new FormData();
  fd.append('file', file);
  const d = file.size > PIECES_OVER ? await uploadInPieces('account', file, opts) : await uploadFetch('/chat/media/account', fd, opts);
  if (state.savedMedia && /^(image|gif|video|audio)$/.test(d.attachment?.type)) loadMedia();
  return d.attachment;
}
export const uploadExternal = uploadTemp; // (old name)
const DEST_KEY = 'ember.dmUploadDest';
const readLocalDest = () => { try { const v = localStorage.getItem(DEST_KEY); return v === 'account' || v === 'temp' ? v : null; } catch { return null; } };
// the remembered destination ('account' | 'temp'), or null = ask
export function rememberedUploadDest() {
  return rememberedDest({ fromServer: !!state.settingsFromServer, setting: state.settings.dm_upload_dest, local: readLocalDest() });
}
export async function setUploadDest(v) {
  const dest = v === 'account' || v === 'temp' ? v : 'ask';
  try { await saveSettings({ dm_upload_dest: dest }); } catch (e) { toast(errorText(e.message)); } // (saveSettings keeps this device's copy too)
}
// what the picker shows (space left in account storage, the temporary storage rules); cached for a minute
let destInfo = null, destInfoAt = 0;
export function loadUploadDestinations(force) {
  if (!force && destInfo && Date.now() - destInfoAt < 60e3) return destInfo;
  destInfoAt = Date.now();
  destInfo = apiFetch('/chat/media/destinations').catch(() => { destInfoAt = 0; return null; });
  return destInfo;
}
// where these files go: the remembered choice, else the picker (resolves 'account' | 'temp', or null = cancelled).
// files: the File list (the picker greys out account storage when they don't fit)
export function chooseUploadDest(files) {
  const known = rememberedUploadDest();
  if (known) return Promise.resolve(known);
  if (state.uploadAsk) state.uploadAsk.resolve(null);
  const list = [...files];
  return new Promise(resolve => set({ uploadAsk: { total: list.reduce((t, f) => t + (f.size || 0), 0), biggest: list.reduce((m, f) => Math.max(m, f.size || 0), 0), count: list.length, resolve } }));
}
export function answerUploadAsk(dest, remember) {
  const a = state.uploadAsk;
  if (!a) return;
  set({ uploadAsk: null });
  if (dest && remember) setUploadDest(dest);
  a.resolve(dest || null);
}
// a temporary-storage link (/t/ or cdn.nookara.cc/temp/): { expires_in (seconds), ttl_days (null), at (when we asked) }, or 'gone' when it
// expired / was deleted, or null when that couldn't be found out. Answers are kept 10 minutes (a 'gone'
// forever), asked at most 4 at a time, and the same file in many messages is one request.
export { TEMP_LINK };
const TEMP_INFO_MS = 10 * 60 * 1000;
const tempInfos = new Map(); // id -> { p: Promise, at: when it was asked, v: the answer once there is one }
const tempWaiting = [];
let tempBusy = 0;
const tempSubs = new Set();
const tempPump = () => {
  while (tempBusy < 4 && tempWaiting.length) { tempBusy++; tempWaiting.shift()(); }
};
const tempAsk = id => new Promise(resolve => {
  tempWaiting.push(() => {
    const at = Date.now();
    fetch(`/t/info/${id}`, { credentials: 'omit', cache: 'no-store' })
      .then(r => (r.status === 404 ? 'gone' : r.ok ? r.json().then(d => ({ ...d, at })) : null))
      .catch(() => null)
      .then(v => { tempBusy--; tempPump(); resolve(v); });
  });
  tempPump();
});
function tempLoad(id) {
  const prev = tempInfos.get(id);
  const e = { at: Date.now(), v: prev?.v }; // an older answer stays on screen while the new one is on its way
  e.p = tempAsk(id).then(v => {
    if (v === null) { if (tempInfos.get(id) === e) { if (prev?.v !== undefined) tempInfos.set(id, prev); else tempInfos.delete(id); } return prev?.v ?? null; }
    e.v = v;
    tempSubs.forEach(f => f(id));
    return v;
  });
  tempInfos.set(id, e);
  return e;
}
export function tempFileInfo(url) {
  const id = tempId(url);
  if (!id) return Promise.resolve(null);
  const e = tempInfos.get(id);
  if (e && (e.v === 'gone' || Date.now() - e.at < TEMP_INFO_MS)) return e.p;
  return tempLoad(id).p;
}
// the answer we already have for a link (undefined = not asked / still asking), without asking
export const tempFileInfoNow = url => { const e = tempInfos.get(tempId(url)); return e && (e.v === 'gone' || Date.now() - e.at < TEMP_INFO_MS) ? e.v : undefined; };
export const onTempInfo = fn => { tempSubs.add(fn); return () => tempSubs.delete(fn); };
async function prepareAttachments(v, attachments) {
  return prepareInstanceAttachments(attachments, instOf(v.sid), location.origin, a =>
    apiFetch(`/chat/media/import?sid=${v.sid}&cid=${v.cid}`, {
      method: 'POST', body: JSON.stringify({ url: a.url, name: a.name || 'attachment' }),
    }));
}
// a file for the conversation you're in: an instance community keeps it on that instance (and hashes it for signing), the rest goes through Nookara
// opts: { onProgress(sent, total), signal }
export async function uploadAttachment(v, file, opts = {}) {
  const sdm = v.kind === 'channel' && isInst(v.cid) ? sdmOf(v.cid) : null;
  if (sdm) return uploadSealed(sdm, file, opts);
  if (isDmServer(v)) throw new Error('dm_not_found'); // (a DM's files only ever go up sealed)
  if (v.kind === 'channel' && isInst(v.sid)) {
    const fd = new FormData();
    fd.append('file', file);
    const d = await uploadFetch(`/chat/media/upload?sid=${v.sid}&cid=${v.cid}`, fd, opts);
    return { url: d.url, type: d.type, name: d.name, size: d.size, width: d.width, height: d.height, sha256: d.sha256 };
  }
  // DMs / group chats: opts.dest picked in the composer (a file without one, e.g. a command option, follows the setting)
  const dest = opts.dest || rememberedUploadDest() || 'temp';
  // encrypted here first: Nookara stores a file it can't open, its key travels inside the encrypted message. Not to someone who hasn't set up: their DM isn't encrypted
  if (v.kind === 'dm' && !isBotPeer(v.username) && !(await E2EE.bundleFor(v.username).catch(() => ({ none: false }))).none) {
    const { upload, key, iv } = await E2EE.sealFile(file);
    const a = await (dest === 'account' ? uploadAccount(upload, opts) : uploadTemp(upload, opts));
    return { url: E2EE.fileLink(a.url, { key, iv, name: file.name, mime: file.type }), sealed: true, type: fileKindOfMime(file.type), name: file.name, size: file.size };
  }
  return dest === 'account' ? uploadAccount(file, opts) : uploadTemp(file, opts);
}
// custom emojis of my Nookara servers + every instance's (each listed under its own namespaced sid). A server that isn't connected
// right now (asleep, disconnected, still connecting) keeps the list it had last time, also kept on this device, so its emojis can
// still be picked and sent from anywhere. Only a server you're not in any more (instances.js drops it) loses them.
const EMOJI_CACHE = () => acctKey('ember_emoji_cache');
const readEmojiCache = () => { try { const v = JSON.parse(localStorage.getItem(EMOJI_CACHE()) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const emojiUrlsOf = lists => {
  const urls = {};
  for (const sv of lists) for (const e of sv.emojis || []) if (e.url && !urls[e.eid]) urls[e.eid] = e.url;
  for (const e of state.personalEmojis?.list || []) if (e.url && !urls[e.eid]) urls[e.eid] = e.url; // (personal.js)
  return urls;
};
// the kept lists, before anything has answered (opening Ember while a server is asleep or offline)
function seedEmojis() {
  if (state.emojis) return;
  const kept = readEmojiCache();
  if (kept?.length) set({ emojis: kept, emojiUrls: { ...emojiUrlsOf(kept), ...state.emojiUrls } });
}
let emojiLoad = 0;
export async function loadEmojis() {
  const mine = ++emojiLoad; // an older answer must not replace a newer one (instances connect while the first load is still running)
  seedEmojis();
  const open = [...connections.values()].filter(c => c.session && c.status === 'open').map(c => c.origin);
  const [home, ...more] = await Promise.all([state.signedIn ? apiFetch('/chat/emojis').catch(() => null) : null, ...open.map(o => apiFetch('/chat/emojis', { inst: o }).catch(() => null))]);
  if (mine !== emojiLoad || (!home && !more.some(Boolean))) return;
  // what didn't answer keeps what it had: Nookara's own servers if that call failed, and every instance that isn't open (or failed)
  const answered = new Set(open.filter((o, i) => more[i]));
  const prev = state.emojis || readEmojiCache() || [];
  // (not checked against `connections`: at start-up the instances aren't in it yet. Leaving one drops its lists in instances.js)
  const keep = prev.filter(sv => (isInst(sv.sid) ? !answered.has(instOf(sv.sid)) : !home));
  const lists = [...(home?.servers || []), ...more.flatMap(d => d?.servers || []), ...keep];
  set({ emojis: lists, emojiUrls: emojiUrlsOf(lists) });
  try { localStorage.setItem(EMOJI_CACHE(), JSON.stringify(lists)); } catch { /* full: the next load tries again */ }
}
export async function loadMedia() {
  const d = await apiFetch('/chat/media').catch(() => null);
  if (d) set({ savedMedia: d.items });
}
export async function saveGif(g) {
  const d = await apiFetch('/chat/media/gif', { method: 'POST', body: JSON.stringify({ url: g.url, preview: g.preview, width: g.width, height: g.height, title: g.title || g.name || '' }) });
  set(s => ({ savedMedia: [{ id: d.id, kind: 'gif', url: g.url, preview: g.preview || g.url, width: g.width, height: g.height, name: g.title || g.name || '', saved: true, at: Date.now() }, ...(s.savedMedia || []).filter(m => m.url !== g.url)] }));
  toast('Saved to Saved Media.', true);
}
export async function unsaveGif(url) {
  await apiFetch(`/chat/media?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
  set(s => ({ savedMedia: (s.savedMedia || []).filter(m => m.url !== url) }));
}
export async function deleteMedia(m) {
  await apiFetch(`/chat/media/${m.id}`, { method: 'DELETE' });
  set(s => ({ savedMedia: (s.savedMedia || []).filter(x => x.id !== m.id) }));
}

// ── lists ──
export async function loadServers() {
  const d = await apiFetch('/chat/servers').catch(() => null);
  // a fresh count for a server whose channels aren't loaded already has what came in live
  if (d) set(s => ({ servers: [...d.servers.map(x => ({ ...x, inst: NOOKARA })), ...s.servers.filter(x => x.inst && x.inst !== NOOKARA)], unreadN: Object.fromEntries(Object.entries(s.unreadN).filter(([, u]) => s.detail[u.sid] || !d.servers.some(x => x.sid === u.sid))) }));
  return d?.servers || [];
}
// my communities on one instance (or everywhere): after joining / creating one
export async function loadServersOf(sid) { if (isInst(sid)) await loadInstanceData(instOf(sid)); else await loadServers(); }
// ── each server's channel list (server, categories, channels) kept on this device, so a server opens straight away while it's still
// connecting: greyed out, with a loader where the messages go, until the real one comes in (refreshServer). `cached: true` marks it.
const SERVER_CACHE = () => acctKey('ember_server_cache');
let serverCache = null, serverCacheAt = null;
function readServerCache() {
  const k = SERVER_CACHE();
  if (k !== serverCacheAt) { serverCacheAt = k; try { const v = JSON.parse(localStorage.getItem(k) || '{}'); serverCache = v && typeof v === 'object' ? v : {}; } catch { serverCache = {}; } }
  return serverCache;
}
let serverCacheT = null, serverCacheSeen = null;
function saveServerCache() {
  const all = { ...readServerCache() };
  for (const [sid, d] of Object.entries(state.detail)) if (d && !d.cached && d.server && !d.server.dm) all[sid] = { server: d.server, categories: d.categories || [], channels: d.channels || [], at: Date.now() };
  const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  for (const k of keys.slice(80)) delete all[k];
  serverCache = all;
  try { localStorage.setItem(SERVER_CACHE(), JSON.stringify(all)); } catch { /* full: the next save tries again */ }
}
subscribe(() => {
  if (state.detail === serverCacheSeen) return;
  serverCacheSeen = state.detail;
  clearTimeout(serverCacheT);
  serverCacheT = setTimeout(saveServerCache, 2500);
});
// a server's details: the real ones, else the kept copy (put in the store, marked cached), else null
function detailOrCached(sid) {
  if (state.detail[sid]) return state.detail[sid];
  const c = readServerCache()[sid];
  if (!c?.server || !Array.isArray(c.channels)) return null;
  const d = { server: c.server, categories: c.categories || [], channels: c.channels, cached: true };
  set(s => ({ detail: { ...s.detail, [sid]: d } }));
  return d;
}
// is the socket this server lives on up?
export const serverLive = sid => (isInst(sid) ? connections.get(instOf(sid))?.status === 'open' : !!sock && sock.readyState === 1);
// the channel a server opens on: the last one you had open there (kept on this device), else the top one in the list that you'd
// read in (not a voice or link channel), in the sidebar's order: channels without a category first, then each category in order
const LAST_CHANNEL = () => acctKey('ember_last_channel');
let lastChannels = null, lastChannelsAt = null;
function lastChannelsAll() {
  const k = LAST_CHANNEL();
  if (k !== lastChannelsAt) { lastChannelsAt = k; try { const v = JSON.parse(localStorage.getItem(k) || '{}'); lastChannels = v && typeof v === 'object' ? v : {}; } catch { lastChannels = {}; } }
  return lastChannels;
}
const lastChannelOf = sid => state.lastCid[sid] || lastChannelsAll()[sid] || null;
function rememberChannel(sid, cid) {
  const all = lastChannelsAll();
  if (all[sid] === cid) return;
  lastChannels = { ...all, [sid]: cid };
  try { localStorage.setItem(LAST_CHANNEL(), JSON.stringify(lastChannels)); } catch { /* fine */ }
}
export function topChannel(d) {
  const cats = d?.categories || [];
  const rank = c => { const i = cats.indexOf(c.category || ''); return c.category && i >= 0 ? i + 1 : 0; };
  const ordered = (d?.channels || []).map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);
  return ordered.find(c => !['voice', 'link'].includes(c.type)) || ordered[0] || null;
}
// ── a small page of each server channel's messages kept in this browser (msgCache.js), shown greyed while that server connects ──
const savedSig = new Map(); // key -> what was last written (so a socket event that changes nothing writes nothing)
let keepingMessages = true;
// signing out: nothing more is written, and what's waiting to be is dropped (session.js then deletes what's kept)
export function stopKeepingMessages() { keepingMessages = false; clearTimeout(msgCacheT); }
let msgCacheT = null, msgCacheSeen = null;
subscribe(() => {
  if (state.msgs === msgCacheSeen) return;
  msgCacheSeen = state.msgs;
  clearTimeout(msgCacheT);
  msgCacheT = setTimeout(() => {
    const account = acctKey('a');
    for (const [key, b] of Object.entries(state.msgs)) {
      if (!key.startsWith('c:') || !b?.loaded || b.error || !state.detail[serverOfChannel(key.slice(2))]) continue;
      const done = b.list.filter(m => !m.pending);
      const sig = done.slice(-30).map(m => `${m.id}:${m.edited_at || ''}:${(m.reactions || []).length}`).join(',');
      if (!sig || savedSig.get(key) === sig) continue;
      savedSig.set(key, sig);
      if (!keepingMessages) return;
      writeMsgCache(account, `${account}|${key}`, done).catch(() => {});
    }
  }, 4000);
});
const serverOfChannel = cid => Object.keys(state.detail).find(sid => state.detail[sid]?.channels?.some(c => c.cid === cid));
export const cachedMessages = view => (view?.kind === 'channel' ? readMsgCache(`${acctKey('a')}|${keyOf(view)}`) : Promise.resolve(null));
// a server's kept copy is no good any more (left / kicked / deleted): off this device and out of the store
export function forgetServerCache(sid) {
  const all = { ...readServerCache() };
  const cids = (all[sid]?.channels || state.detail[sid]?.channels || []).map(c => c.cid);
  if (cids.length) { const a = acctKey('a'); dropMsgCache(a, cids.map(cid => `${a}|c:${cid}`)).catch(() => {}); }
  if (all[sid]) { delete all[sid]; serverCache = all; try { localStorage.setItem(SERVER_CACHE(), JSON.stringify(all)); } catch { /* fine */ } }
  if (state.detail[sid]?.cached) set(s => { const detail = { ...s.detail }; delete detail[sid]; return { detail }; });
}
const refreshFail = new Map(); // sid -> the HTTP status of its last failed refreshServer (0 = no answer)
// the real details for a server showing its kept copy: in, gone (403 / 404: not in it any more, or deleted -> home), or a blip (again soon)
async function wakeServer(sid, tries = 0) {
  const d = await refreshServer(sid);
  if (d) return d;
  const st = refreshFail.get(sid) || 0;
  if (st === 403 || st === 404) {
    forgetServerCache(sid);
    if (state.view.sid === sid) { go({ kind: 'home' }, { replace: true }); toast("You're not in that server any more."); }
    return null;
  }
  setTimeout(() => { if (state.detail[sid]?.cached && serverLive(sid)) wakeServer(sid, tries + 1).then(x => { if (x && state.view.sid === sid) open(state.view); }); }, Math.min(30000, 3000 * (tries + 1)));
  return null;
}
export async function refreshServer(sid) {
  if (state.detail[sid]?.server?.dm) return state.detail[sid]; // a DM: what the DM list says is all there is (seedDm)
  const d = await apiFetch(`/chat/servers/${sid}`).catch(e => { refreshFail.set(sid, e?.status || 0); return null; });
  if (d) set(s => ({ detail: { ...s.detail, [sid]: d }, voiceStates: { ...s.voiceStates, ...(d.voice || {}) }, unreadN: Object.fromEntries(Object.entries(s.unreadN).filter(([, u]) => u.sid !== sid)) }));
  return d;
}
export async function loadMembers(sid) {
  if (state.detail[sid]?.server?.dm) return;
  const d = await apiFetch(`/chat/servers/${sid}/members`).catch(() => null);
  if (!d) return;
  if (isInst(sid)) { // instances don't relay presence: Nookara accounts' status comes from the home socket, the rest has none
    d.members = d.members.map(m => ({ ...m, inst: instOf(sid) }));
    set(s => ({ members: { ...s.members, [sid]: d.members } }));
    wantNookaraFaces(d.members);
    if (!state.signedIn) return;
    const ids = [...new Set(d.members.filter(m => isNookara(m.kind) && /^[1-9]\d*$/.test(String(nookaraId(m)))).map(m => String(nookaraId(m))))].slice(0, 200);
    const names = await apiFetch(`/chat/identities?ids=${ids.join(',')}`).then(r => Object.fromEntries(r.users.map(u => [String(u.id), u.username]))).catch(() => ({})); // their name now (the instance knows the one from their last login)
    if (Object.keys(names).length) set(s => ({ nookaraNames: { ...s.nookaraNames, ...names } }));
    watchPresence(d.members.filter(m => isNookara(m.kind)).slice(0, 400).map(m => names[nookaraId(m)] || m.username));
    return;
  }
  remember(d.members);
  const pres = Object.fromEntries(d.members.map(m => [m.username, localizePresence(m.presence)]));
  set(s => ({ members: { ...s.members, [sid]: d.members }, presence: { ...s.presence, ...pres }, membersMore: pagedMore(s.membersMore, sid, d) }));
  if (d.next_offset != null) watchPresence(d.members.map(m => m.username)); // a big server: its members' presence isn't pushed to everyone
}
const pagedMore = (all, sid, d) => { const next = { ...all }; if (d.next_offset != null) next[sid] = d.next_offset; else delete next[sid]; return next; };
// a big Nookara-hosted server answers its member list in pages (Nookara chat.js memberList): the next one, as you scroll
const loadingMore = new Set();
export async function loadMoreMembers(sid) {
  const from = state.membersMore[sid];
  if (from == null || loadingMore.has(sid) || isInst(sid)) return;
  loadingMore.add(sid);
  try {
    const d = await apiFetch(`/chat/servers/${sid}/members?offset=${from}&limit=200`).catch(() => null);
    if (!d || state.membersMore[sid] !== from) return;
    remember(d.members);
    const pres = Object.fromEntries(d.members.map(m => [m.username, localizePresence(m.presence)]));
    set(s => {
      const have = new Set((s.members[sid] || []).map(m => m.username));
      return { members: { ...s.members, [sid]: [...(s.members[sid] || []), ...d.members.filter(m => !have.has(m.username))] }, presence: { ...s.presence, ...pres }, membersMore: pagedMore(s.membersMore, sid, d) };
    });
    watchPresence(d.members.map(m => m.username));
  } finally { loadingMore.delete(sid); }
}
// a server's bot slash commands. Kept on this device too, so the / menu is there while the server is asleep or still connecting;
// catchUp() loads them again once its socket is up (they used to load only when the channel opened, and a server that was
// asleep then never got them)
const CMD_CACHE = () => acctKey('ember_cmd_cache');
const readCmdCache = () => { try { const v = JSON.parse(localStorage.getItem(CMD_CACHE()) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
export async function loadCommands(sid, cid) {
  if (!isInst(sid)) return;
  const want = cid || state.commands[sid]?.cid || null;
  if (!state.commands[sid]) { const kept = readCmdCache()[sid]; if (kept?.commands) set(s => (s.commands[sid] ? null : { commands: { ...s.commands, [sid]: { ...kept, cached: true } } })); }
  const d = await apiFetch(`/chat/servers/${sid}/commands${want ? `?channel=${encodeURIComponent(bare(want))}` : ''}`).catch(() => null);
  if (!d) return;
  set(s => ({ commands: { ...s.commands, [sid]: { ...d, cid: want } } }));
  const all = readCmdCache();
  all[sid] = { bots: d.bots || [], commands: d.commands || [], cid: want, at: Date.now() };
  for (const k of Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0)).slice(60)) delete all[k];
  try { localStorage.setItem(CMD_CACHE(), JSON.stringify(all)); } catch { /* full: fine */ }
}
export const sendInteraction = (sid, body) => {
  return apiFetch(`/chat/servers/${sid}/interactions`, { method: 'POST', body: JSON.stringify({ ...body, channel: bare(body.channel) }) });
};
export function dismissEphemeral(view, m) {
  set(s => ({ msgs: upd(s.msgs, keyOf(view), b => b && { ...b, list: b.list.filter(x => x.id !== m.id) }) }));
  apiFetch(`/chat/servers/${view.sid}/interactions/messages/${m.id}`, { method: 'DELETE' }).catch(() => {});
}
export const closeInteractionModal = () => set({ interactionModal: null });
// online / idle / dnd / offline for a member list row; null = this account has no presence (an instance's own accounts and bots, or signed out of Nookara)
// an instance bot's presence ('online' | 'offline', set by the instance from its bot gateway connections); null when the instance doesn't say
export const botPresenceOf = m => (m?.kind === 'bot' && (m.presence === 'online' || m.presence === 'offline') ? m.presence : null);
// on an Ember server that says who is connected to it (member `presence` 'online' / 'offline' for people, features.member_presence):
// online only while they're connected there. A Nookara account then shows its Nookara status (idle, dnd, invisible = offline)
const hereConnected = m => (m.presence === 'online' ? true : m.presence === 'offline' ? false : null);
export function statusOf(sid, m, s = state) {
  if (!isInst(sid)) return s.presence[m.username]?.status || m.presence?.status || 'offline';
  if (m.kind === 'bot') return botPresenceOf(m);
  const here = hereConnected(m);
  if (here === false) return 'offline';
  // me: I'm here, whatever the server says (it may not list my own presence, e.g. in a homeserver DM)
  const mine = connections.get(instOf(sid))?.user;
  if (here === null && mine && String(mine.id) === String(m.id)) { const p = s.presence[s.me?.username]?.status; return p && p !== 'invisible' ? p : p === 'invisible' ? 'offline' : 'online'; }
  if (!isNookara(m.kind) || !s.signedIn) return here ? 'online' : null;
  const p = s.presence[s.nookaraNames[nookaraId(m)] || m.username];
  if (here) return p && p.status !== 'offline' ? p.status : p ? 'offline' : 'online'; // (offline on Nookara while connected here = invisible)
  return p?.status || 'offline';
}
export const presenceFor = (sid, m, s = state) => {
  if (!isInst(sid)) return s.presence[m.username] || m.presence;
  if (m.kind === 'bot') return botPresenceOf(m) ? { status: botPresenceOf(m) } : null;
  const here = hereConnected(m);
  if (here === false) return { status: 'offline' };
  const mine = connections.get(instOf(sid))?.user;
  if (here === null && mine && String(mine.id) === String(m.id)) return s.presence[s.me?.username] || { status: 'online' }; // (me)
  const p = isNookara(m.kind) && s.signedIn ? s.presence[s.nookaraNames[nookaraId(m)] || m.username] : null;
  if (here && (!p || p.status === 'offline')) return p ? { status: 'offline' } : { status: 'online' };
  return p || null;
};
function loadMembersOf(inst) { Object.keys(state.members).filter(k => instOf(k) === inst).forEach(loadMembers); }
// the id a member route wants: an instance names people by their principal (v:2), Nookara by username
export function memberRef(sid, username) {
  if (!isInst(sid)) return encodeURIComponent(username);
  const m = state.members[sid]?.find(x => x.username === username);
  return encodeURIComponent(m?.id || username);
}
// the DM you're looking at: read on the server too, so leaving it doesn't show what you already saw as new
let dmReadTimer = null;
function markDmRead(username) {
  if (!username) return;
  set(s => ({ dms: s.dms.map(c => (c.username.toLowerCase() === username.toLowerCase() ? { ...c, unread: 0 } : c)), unread: { ...s.unread, [`d:${username.toLowerCase()}`]: false } }));
  clearTimeout(dmReadTimer);
  dmReadTimer = setTimeout(() => apiFetch(`/im/with/${encodeURIComponent(username)}/read`, { method: 'POST' }).catch(() => {}), 400);
}
const viewingDm = () => (state.view.kind === 'dm' && document.visibilityState === 'visible' ? state.view.username : null);
export async function loadDMs() {
  const d = await apiFetch('/im/conversations').catch(() => null);
  if (!d) return;
  d.conversations = await Promise.all(d.conversations.map(async c => {
    if (!c.last_message?.enc) return c;
    const o = await E2EE.openMessage(c.last_message);
    return { ...c, last_message: { ...o, body: o.sealed?.state === 'open' ? (o.body || (o.sealed.files?.length ? 'Sent a file' : '')) : 'Encrypted message' } };
  }));
  const here = viewingDm();
  if (here) d.conversations = d.conversations.map(c => (c.username.toLowerCase() === here.toLowerCase() && c.unread ? (markDmRead(here), { ...c, unread: 0 }) : c));
  remember(d.conversations.filter(c => c.username !== 'System').map(c => ({ username: c.username, pfp: c.pfp || undefined })));
  d.conversations.forEach(c => { if (c.bot) markBotPeer(c.username); });
  set(s => {
    const unread = { ...s.unread };
    d.conversations.forEach(c => { const k = `d:${c.username.toLowerCase()}`; if (c.unread && keyOf(s.view) !== k) unread[k] = true; });
    return { dms: d.conversations, unread };
  });
}
export async function loadGroups() {
  const d = await apiFetch('/groups').catch(() => null);
  if (d) set({ groups: d.groups });
}
// friend requests + message requests waiting for me: the count on the Home button in the server rail. Home's own lists
// report what they load (setHomeRequests) so the count is right the moment you answer one there.
const homeReq = { friends: 0, dms: 0, social: 0 }; // (social: friend requests from people on other homeservers)
export function setHomeRequests(part) {
  Object.assign(homeReq, part);
  const n = (homeReq.friends || 0) + (homeReq.dms || 0) + (homeReq.social || 0);
  if (state.homeRequests !== n) set({ homeRequests: n });
}
export async function loadHomeRequests() {
  const [f, d] = await Promise.all([apiFetch('/friends/requests').catch(() => null), apiFetch('/account/dm-requests').catch(() => null)]);
  setHomeRequests({ ...(f ? { friends: f.incoming?.length || 0 } : {}), ...(d ? { dms: d.requests?.length || 0 } : {}) });
}
export async function loadFriends() {
  const d = await apiFetch('/friends').catch(() => null);
  if (!d) return;
  remember(d.friends.map(f => ({ username: f.friend_username, pfp: f.pfp_url, color: f.color, rank: f.rank })));
  set({ friends: d.friends, friendsLoaded: true });
  watchPresence(d.friends.map(f => f.friend_username));
}
export async function loadBlocks() {
  const d = await apiFetch('/account/blocks').catch(() => null);
  if (d?.blocks) set({ blocks: d.blocks });
}
// the people I blocked as { ids, names } (names lowercased), built once per loaded list. Nookara gives their ids (older servers only names).
const blockSetCache = new WeakMap();
function blockSets(list) {
  let b = blockSetCache.get(list);
  if (!b) {
    b = { ids: new Set(list.filter(x => x.id != null).map(x => String(x.id))), names: new Set(list.map(x => String(x.username || '').toLowerCase())) };
    blockSetCache.set(list, b);
  }
  return b;
}
// Is this person (a message / reply author, a member) somebody I blocked? Only for people I blocked, never the other way round.
// inst: the instance the person is shown on (falsy / NOOKARA = Nookara's own servers). On an instance only its Nookara people count,
// by their Nookara id (a local account or bot there with the same name is somebody else). Webhooks / bridged names never count.
export function isBlockedPerson(u, inst, s = state) {
  if (!u || !s.blocks?.length || u.webhook || u.bridge) return false;
  const b = blockSets(s.blocks);
  if (inst && inst !== NOOKARA) {
    if (!isNookara(u.kind) || !nookaraId(u)) return false;
    const vid = String(nookaraId(u));
    return b.ids.has(vid) || b.names.has(String(s.nookaraNames[vid] || '').toLowerCase());
  }
  if (u.id != null && b.ids.size) return b.ids.has(String(u.id));
  return b.names.has(String(u.username || '').toLowerCase());
}
// the same for a bare name in a server (typing, @mentions): looked up among that server's members, so an instance's names work
export function isBlockedName(sid, username, s = state) {
  if (!username || !s.blocks?.length) return false;
  const inst = sid && isInst(sid) ? instOf(sid) : NOOKARA;
  const m = sid ? s.members[sid]?.find(x => x.username === username) : null;
  if (m) return isBlockedPerson(m, inst, s);
  return inst === NOOKARA && blockSets(s.blocks).names.has(String(username).toLowerCase());
}
export const useBlocked = (u, inst) => useChat(s => isBlockedPerson(u, inst, s));
// how somebody I blocked is shown in a server: no name, no picture (the default letter one), no colour
export const BLOCKED_NAME = 'Blocked User';
export const blockedFace = u => ({ ...u, username: BLOCKED_NAME, pfp: null, pfp_url: null, color: null });
// Block / unblock a Nookara account, asking first; returns true when it went through
export async function toggleBlock(username, blocked) {
  const ok = await ask(blocked
    ? { title: `Unblock ${username}?`, text: 'They will be able to message you, send you credits and send friend requests again.', confirm: 'Unblock' }
    : { title: `Block ${username}?`, text: "They won't be able to message you, call you, send you credits or friend requests, and your profile will look missing to them. They aren't told.", confirm: 'Block', danger: true });
  if (!ok) return false;
  try {
    await apiFetch(blocked ? `/account/blocks/${encodeURIComponent(username)}` : '/account/blocks', blocked ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ username }) });
    await loadBlocks();
    if (!blocked) loadFriends();
    toast(blocked ? `Unblocked ${username}.` : `Blocked ${username}.`, true);
    return true;
  } catch (e) { toast(errorText(e.message)); return false; }
}

// ── where you are (also in the address: /chat#/s/<sid>/<cid>, #/dm/<name>, #/g/<room>) ──
// #/s/<sid>/<cid> for Nookara's own servers, #/i/<instance>/s/<sid>/<cid> and #/i/<instance>/invite/<code> for instances
// a server on a homeserver with many, by its address (slug@domain): its routes use that, not the homeserver's origin
const addressOfSid = sid => { const a = state.servers.find(x => x.sid === sid)?.address || state.detail[sid]?.server?.address || readServerCache()[sid]?.server?.address; const p = a ? parseAddress(a) : null; return p && !p.code ? p.address : null; };
// the other way, instantly from what this device knows (the server list, details, the kept copies): -> its sid | null
function sidOfAddress(address) {
  const a = String(address || '').toLowerCase(), same = x => String(x || '').toLowerCase() === a;
  const s = state.servers.find(x => same(x.address));
  if (s) return s.sid;
  for (const [sid, d] of Object.entries(state.detail)) if (same(d?.server?.address)) return sid;
  for (const [sid, c] of Object.entries(readServerCache())) if (same(c?.server?.address)) return sid;
  return null;
}
export function hashFor(v) {
  const at = k => { const p = parseK(k); return p.inst === NOOKARA ? '' : `#/i/${encodeURIComponent(p.inst)}`; };
  const mid = v.kind === 'channel' && v.mid ? `/${v.mid}` : ''; // a message link: #/s/<sid>/<cid>/<message id>
  if (v.kind === 'sdm' || (v.kind === 'channel' && v.dm)) return `#/dm/${encodeURIComponent(v.kind === 'sdm' ? v.id : v.dm)}`; // a DM on a homeserver, by its id
  // a server with an address: #/s/<slug@domain>/<channel>/<message> (#/i/<origin>/s/... still opens, and becomes this)
  const addr = (v.kind === 'channel' || v.kind === 'server') && at(v.sid) ? addressOfSid(v.sid) : null;
  if (addr) return addressRoute(addr, v.kind === 'channel' ? bare(v.cid) : null, v.kind === 'channel' ? v.mid : null);
  if (v.kind === 'channel') return at(v.sid) ? `${at(v.sid)}/s/${bare(v.sid)}/${bare(v.cid)}${mid}` : `#/s/${v.sid}/${v.cid}${mid}`;
  if (v.kind === 'server') return at(v.sid) ? `${at(v.sid)}/s/${bare(v.sid)}` : `#/s/${v.sid}`;
  if (v.kind === 'instance') return `#/i/${encodeURIComponent(v.inst)}`;
  if (v.kind === 'address') return addressHash(v);
  if (v.kind === 'invite') return v.inst && v.inst !== NOOKARA ? `#/i/${encodeURIComponent(v.inst)}/invite/${v.code}` : `#/invite/${v.code}`;
  if (v.kind === 'dm') return `#/dm/${encodeURIComponent(v.username)}`;
  if (v.kind === 'group') return `#/g/${v.room}`;
  if (v.kind === 'notes') return '#/notes';
  if (v.kind === 'modmail') return `#/modmail${v.username ? `/${encodeURIComponent(v.username)}` : ''}`;
  return '#/home';
}
// invites and Ember servers get the short form (shortLinks.js) on the real Ember host; everything else the #/ link
export const linkFor = v => { const long = shareLink(hashFor(v)); return (long.startsWith(EMBER_ORIGIN + '/') && shortLinkFor(v)) || long; };
// the link to share for an invite to a server: one with an address (slug@domain) gets its homeserver's invite link, which any
// app can open (https://<domain>/i/<slug>/<code>, or where its discovery doc says they start); others the Ember link as before
export function inviteLinkFor(sid, code) {
  if (!code) return '';
  const io = instOf(sid);
  const srv = state.servers.find(x => x.sid === sid);
  const a = io && io !== NOOKARA ? parseAddress(srv?.address || state.detail[sid]?.server?.address || '') : null;
  if (!a) return linkFor({ kind: 'invite', code, inst: io });
  return inviteUrl({ ...a, code }, state.instances.find(i => i.origin === io)?.invites);
}
export function go(v, { replace = false } = {}) {
  const hash = hashFor(v);
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', clientUrl(hash));
  open(v);
}
export function readHash() {
  // #/open?u=web+ember:invite?address=slug@domain&code=X: a link the browser handed over (Settings > Advanced registers Ember for them)
  if (location.hash.startsWith('#/open?')) { const a = parseProtocolLink(openRouteLink(location.hash)); return a ? { kind: 'address', slug: a.slug, domain: a.domain, code: a.code } : { kind: 'home' }; }
  const parts = location.hash.split('/');
  if (parts[1] === 'i' && parts[2]) {
    let inst = null;
    try { inst = decodeURIComponent(parts[2]); } catch { /* bad */ }
    // #/i/<slug>@<domain>/<code>: a server by its address (addresses.js), not an instance origin
    if (inst && inst.includes('@') && !/^https?:/i.test(inst)) { const a = parts.length <= 5 ? parseAddress(location.hash) : null; return a ? { kind: 'address', slug: a.slug, domain: a.domain, code: a.code } : { kind: 'home' }; }
    const [, , , a, b, c, d] = parts;
    inst = normOrigin(inst); // only a proper, normalised origin is an instance
    if (!inst || inst.includes('|')) return { kind: 'home' };
    // a server Nookara used to host (e-<slug>.nookara.cc) that isn't one of mine: it may live on a homeserver now (moved.js)
    if (hostedSlug(inst) && !state.instances?.some(i => i.origin === inst)) return { kind: 'moved', old: inst, slug: hostedSlug(inst), ...(a === 'invite' && b ? { code: b } : {}) };
    if (a === 's' && b) return { kind: c ? 'channel' : 'server', sid: K(inst, b), cid: c ? K(inst, c) : undefined, ...(c && /^\d{1,20}$/.test(d || '') ? { mid: d } : {}) };
    if (a === 'invite' && b) return { kind: 'invite', code: b, inst };
    return a ? { kind: 'home' } : { kind: 'instance', inst };
  }
  const [, a, b, c, d] = parts;
  const addr = a === 's' && b ? routeAddress(b) : null;
  if (addr) { // #/s/<slug@domain>/<channel>/<message>: a server on a homeserver with many, by its address
    const sid = sidOfAddress(addr), mid = c && /^\d{1,20}$/.test(d || '') ? { mid: d } : {};
    if (!sid) return { kind: 'server-address', address: addr, cid: c || null, ...mid }; // (not known here yet: open() looks it up)
    return { kind: c ? 'channel' : 'server', sid, cid: c ? K(instOf(sid), c) : undefined, ...mid };
  }
  if (a === 's' && b) return { kind: c ? 'channel' : 'server', sid: b, cid: c, ...(c && /^\d{1,20}$/.test(d || '') ? { mid: d } : {}) };
  if (a === 'dm' && b) {
    let who; try { who = decodeURIComponent(b); } catch { return { kind: 'home' }; }
    // <dm id>@<host> (PROTOCOL 4c): a DM on a homeserver. With the Nookara sign-in those have an @, a Nookara name never does
    return state.home || who.includes('@') ? { kind: 'sdm', id: who } : { kind: 'dm', username: who };
  }
  if (a === 'g' && b) return { kind: 'group', room: b };
  if (a === 'invite' && b) return { kind: 'invite', code: b };
  if (a === 'notes') return { kind: 'notes' };
  if (a === 'modmail') return b ? { kind: 'modmail', username: decodeURIComponent(b) } : { kind: 'modmail' };
  return { kind: 'home' };
}
// where "new messages" start when a conversation opens with unread in it (MessageList scrolls there once)
const jumpPoints = new Map(); // key -> { after: message id } | { count: n }
// go to a message anywhere (search results): open its conversation, load older pages until it's there, flash it
export async function jumpToMessage(v, id) {
  const key = keyOf(v);
  if (keyOf(state.view) !== key) go(v);
  const settle = async () => { for (let i = 0; i < 50 && !(state.msgs[key]?.loaded && !state.msgs[key]?.loading); i++) await new Promise(r => setTimeout(r, 100)); };
  await settle();
  for (let i = 0; i < 20; i++) {
    const b = state.msgs[key];
    if (!b || b.list.some(m => String(m.id) === String(id)) || !b.hasMore) break;
    await loadMessages(v, { older: true });
    await settle();
  }
  setTimeout(() => {
    const el = document.querySelector(`.vc-msg[data-id="${id}"]`);
    if (!el) { toast('That message is gone - it may have been deleted.'); return; }
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
  }, 120);
}
export function takeJump(key) { const j = jumpPoints.get(key); jumpPoints.delete(key); return j || null; }
// the community of an instance I'm in, once its list is loaded: leave the "connecting" box for it
export function resumeInstanceView(origin) {
  const v = state.view;
  if (v.kind !== 'instance' || v.inst !== origin) return;
  const srv = serverOfInst(state.servers, origin, { communitySid: connections.get(origin)?.info?.community?.sid }); // (its default server, on a homeserver with several)
  if (srv && connections.get(origin)?.status === 'open') open(v.then && instOf(v.then.sid || '') === origin ? v.then : { kind: 'server', sid: srv.sid });
}
// the Home button in the rail goes back to what was last open under Home (a DM, a group, Personal Notes or Home itself), until a reload
const HOME_KINDS = new Set(['home', 'dm', 'group', 'notes', 'modmail']);
const isHomeView = v => HOME_KINDS.has(v.kind) || (v.kind === 'channel' && !!v.dm);
let lastHome = { kind: 'home' };
export const lastHomeView = () => lastHome;
export async function open(v) {
  if (state.signedIn || connections.size) restoreOutbox(); // (unsent messages from before a reload, even while nothing is connected)
  // a message link: open its channel and scroll to the message
  if (v.kind === 'channel' && v.mid) { const { mid, ...at } = v; return jumpToMessage(at, mid); }
  if (v.kind === 'sdm') return openSocialDm(v.id);
  // Nookara-only places (DMs, groups, modmail, Nookara's own servers) need the Nookara sign-in
  if (!state.signedIn && (['dm', 'group', 'modmail', 'notes'].includes(v.kind) || ((v.kind === 'server' || v.kind === 'channel') && !isInst(v.sid)))) { set({ view: { kind: 'home' } }); return; }
  const io = (v.kind === 'server' || v.kind === 'channel') && isInst(v.sid) ? instOf(v.sid) : v.kind === 'instance' ? v.inst : null;
  if (io) {
    const c = connections.get(io);
    if (c && (c.sleep || c.peeking)) wakeInstance(io); // asleep / disconnected by hand: opening it is waking it
    else if (c) retryInstances(io); // opening a server that isn't connected tries again right away
    if (!c) { // not in my list: an address of one opens the add-a-server box, anything else goes home
      set({ view: { kind: 'home' } });
      if (v.kind === 'instance') dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url: io } }));
      return;
    }
    // still connecting (or reconnecting) and its channel list is kept on this device: open that, greyed, until it's up
    const passing = ['connecting', 'closed'].includes(c.status) && !['insufficient_scope', 'unauthorized', 'invalid_session'].includes(c.error); // (not signed out / banned / refused)
    if (v.kind === 'instance' && !v.then && passing) {
      const sid = Object.keys(readServerCache()).find(k => isInst(k) && instOf(k) === io);
      if (sid && detailOrCached(sid)) { go({ kind: 'server', sid }, { replace: true }); return; }
    }
    // not connected (yet): the sidebar and channels stay out of it until the instance's socket is up and signed in
    if (v.kind === 'instance' || (c.status !== 'open' && !(passing && detailOrCached(v.sid)))) {
      set({ view: v.kind === 'instance' ? v : { kind: 'instance', inst: io, then: v } });
      try { localStorage.setItem('nookara_chat_last', location.hash); } catch { /* fine */ }
      resumeInstanceView(io);
      return;
    }
  }
  if (v.kind === 'server-address') { // #/s/<slug@domain>/... this device doesn't know yet: find it, then open it (or the way in)
    const a = parseAddress(v.address);
    if (!a) { go({ kind: 'home' }, { replace: true }); return; }
    if (!state.view.kind) set({ view: { kind: 'home' } });
    resolveAddress(a).then(r => {
      const sid = K(r.origin, r.sid);
      if (state.servers.some(x => x.sid === sid)) go(v.cid ? { kind: 'channel', sid, cid: K(r.origin, v.cid), ...(v.mid ? { mid: v.mid } : {}) } : { kind: 'server', sid }, { replace: true });
      else { history.replaceState(null, '', clientUrl('#/home')); joinByAddress(a); } // (not in it: the usual way in)
    }, e => { history.replaceState(null, '', clientUrl('#/home')); set({ view: { kind: 'home' } }); toast(createErrorText(e)); });
    return;
  }
  if (v.kind === 'moved') {
    // find the homeserver that lists the old origin, then open the server by its address (the slug and main invite code came along)
    history.replaceState(null, '', clientUrl('#/home'));
    if (!state.view.kind) set({ view: { kind: 'home' } });
    const known = [
      ...(state.instances || []).map(i => ({ origin: i.origin, domain: i.homeserver?.domain, previousUrls: i.previousUrls })),
      ...Object.values(homeSessions()).filter(x => x?.origin && !(state.instances || []).some(i => i.origin === x.origin)).map(x => ({ origin: x.origin, domain: x.domain })),
      ...((state.instances || []).some(i => i.homeserver?.domain === DEFAULT_HOMESERVER) ? [] : [{ origin: `https://${DEFAULT_HOMESERVER}`, domain: DEFAULT_HOMESERVER }]),
    ];
    movedHome(v.old, known).then(h => {
      if (h) open({ kind: 'address', slug: v.slug, domain: h.domain, ...(v.code ? { code: v.code } : {}) });
      else open(v.code ? { kind: 'invite', code: v.code, inst: v.old } : { kind: 'instance', inst: v.old }); // (the old address itself: Nookara says where it went when it knows)
    });
    return;
  }
  if (v.kind === 'address') {
    // stay where you were while the address is looked up; then the usual join (instances.js joinByAddress)
    const back = ['channel', 'dm', 'group'].includes(state.view.kind) ? hashFor(state.view) : '#/home';
    history.replaceState(null, '', clientUrl(back));
    if (!state.view.kind || state.view.kind === 'home') set(s => ({ view: s.view }));
    // an invite (with its code): what server it is first, with a Join button (AddressInvite.jsx); just an address: straight in
    if (v.code) dispatchEvent(new CustomEvent('vc-invite', { detail: { address: { slug: v.slug, domain: v.domain, code: v.code } } }));
    else joinByAddress(v);
    return;
  }
  if (v.kind === 'invite') {
    // stay where you were; the invite shows as a pop-up
    const back = ['channel', 'dm', 'group'].includes(state.view.kind) ? hashFor(state.view) : '#/home';
    history.replaceState(null, '', clientUrl(back));
    dispatchEvent(new CustomEvent('vc-invite', { detail: { code: v.code, inst: v.inst } }));
    if (!state.view.kind || state.view.kind === 'home') set(s => ({ view: s.view }));
    return;
  }
  if (v.kind === 'server') {
    let d = detailOrCached(v.sid) || await refreshServer(v.sid);
    if (!d) { go({ kind: 'home' }, { replace: true }); return; }
    const last = lastChannelOf(v.sid);
    const cid = last && d.channels.some(c => c.cid === last) ? last : topChannel(d)?.cid;
    if (cid) go({ kind: 'channel', sid: v.sid, cid }, { replace: true });
    return;
  }
  if (isHomeView(v)) lastHome = v;
  set(s => ({ view: v, unread: { ...s.unread, [keyOf(v)]: false }, lastCid: v.kind === 'channel' ? { ...s.lastCid, [v.sid]: v.cid } : s.lastCid }));
  if (v.kind === 'channel') rememberChannel(v.sid, v.cid);
  // opened by the old #/i/<origin>/s/<sid>/<cid> form: the address bar gets the #/s/<slug@domain>/<channel> one
  if (v.kind === 'channel' && location.hash.startsWith('#/i/')) { const h = hashFor(v); if (h.startsWith('#/s/') && h !== location.hash) history.replaceState(history.state, '', clientUrl(h)); }
  try { localStorage.setItem('nookara_chat_last', location.hash); } catch { /* fine */ }
  if (v.kind === 'channel') {
    const have = detailOrCached(v.sid);
    if (!have) await refreshServer(v.sid);
    else if (have.cached && serverLive(v.sid) && !(await wakeServer(v.sid))) return;
    if (state.detail[v.sid]?.cached) return; // not connected yet: the kept list shows, catchUp() loads the rest once it is
    const ch = state.detail[v.sid]?.channels.find(c => c.cid === v.cid);
    if (ch && (ch.unread || ch.mentions) && ch.last_read_id) jumpPoints.set(keyOf(v), { after: ch.last_read_id });
    clearMentions(v.sid, [v.cid]);
    if (!state.members[v.sid]) loadMembers(v.sid);
    await loadMessages(v);
    const b = state.msgs[keyOf(v)];
    const last = b?.list.filter(x => !x.pending && !x.ephemeral).pop();
    if (last) readChannel(v.cid, last.id);
    // still here? (clicking through channels quickly: a later one is open now, and this one's read is done above)
    if (keyOf(state.view) === keyOf(v)) clearMentions(v.sid, [v.cid]); // pings that came in while the messages loaded
    channelSeen(v.sid, v.cid, last?.id);
    if (v.dm) readSocialDm(v.dm);
  } else if (v.kind === 'dm') {
    if (v.username !== 'System') { wantPresence(v.username); lookup(v.username).catch(() => {}); }
    const n = state.dms.find(c => c.username.toLowerCase() === v.username.toLowerCase())?.unread || 0;
    if (n > 0) jumpPoints.set(keyOf(v), { count: n });
    await loadMessages(v);
    apiFetch(`/im/with/${encodeURIComponent(v.username)}/read`, { method: 'POST' }).catch(() => {});
    set(s => ({ dms: s.dms.map(c => (c.username.toLowerCase() === v.username.toLowerCase() ? { ...c, unread: 0 } : c)) }));
  } else if (v.kind === 'group' || v.kind === 'notes') {
    await loadMessages(v);
  } else if (v.kind === 'modmail') {
    await loadMessages(v);
    if (!v.username) { apiFetch('/chat/modmail/read', { method: 'POST' }).catch(() => {}); set(s => ({ modmail: { ...s.modmail, unread: 0 } })); }
  }
}

// ── presence (mine) ──
export async function setStatus(status) {
  send({ type: 'set_status', status, persist: true });
  set(s => ({ presence: { ...s.presence, [s.me.username]: { ...(s.presence[s.me.username] || {}), status } } }));
}
export async function setCustom(text) {
  await apiFetch('/chat/presence/custom', { method: 'POST', body: JSON.stringify({ text }) });
  set(s => ({ presence: { ...s.presence, [s.me.username]: { ...(s.presence[s.me.username] || {}), custom: text.trim() || null } } }));
}

// ── little pop-up notes at the bottom ──
let toastT;
export const SCOPE_TEXT = 'This needs a new permission - log in again to use it.';
export const RESTRICTED_TEXT = 'Ember is switched off for your account.';
export function toast(text, ok = false) {
  if (text === SCOPE_TEXT) return; // the "log in again" prompt (PermissionPrompts) already says it
  if (text === RESTRICTED_TEXT) return; // the server's notice (RestrictedBox / RestrictedBar) already says it
  if (state.locked) return; // (the lockout screen is all there is)
  set({ error: text, toastOk: ok });
  clearTimeout(toastT);
  toastT = setTimeout(() => set({ error: null }), 4200);
}
// reply to someone's custom status: can I (server checks bot / own / no status / their DM privacy) and send it
const srCache = new Map();
export function statusReplyInfo(username, custom) {
  const key = `${String(username).toLowerCase()}
${custom}`;
  const hit = srCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = apiFetch(`/im/status-reply/${encodeURIComponent(username)}`).catch(() => ({ can: false, reason: 'error' }));
  srCache.set(key, { at: Date.now(), p });
  return p;
}
export function forgetStatusReply(username) {
  const pre = `${String(username).toLowerCase()}
`;
  [...srCache.keys()].forEach(k => { if (k.startsWith(pre)) srCache.delete(k); });
}
export function startStatusReply(username, text) {
  set({ statusReplyDraft: { username, text } });
  go({ kind: 'dm', username });
  setTimeout(() => dispatchEvent(new CustomEvent('vc-focus-composer')), 60);
}
export function clearStatusReply() { if (state.statusReplyDraft) set({ statusReplyDraft: null }); }
// a DM that didn't go through because of blocking or the other person's DM privacy: one text for both (the server never says which)
export const DM_FAIL_TEXT = 'Failed to send this message due to the users privacy settings';
export const DM_REQUEST_TEXT = 'Your message request was sent. You can message them once they accept.';
export const dmErrorText = code => (code === 'dm_request_sent' ? DM_REQUEST_TEXT : code === 'user_blocked' || code === 'dm_privacy' ? DM_FAIL_TEXT : errorText(code));
export function errorText(code) {
  if (code === 'plain_files') return "They haven't set up encrypted DMs, so this file can't go encrypted. Remove it and send it again.";
  if (code === 'sender_no_keys') return 'Set up encrypted DMs to send messages.';
  if (code === 'cannot_dm_persona') return "This account doesn't take DMs.";
  if (code === 'e2ee_locked') return 'Unlock your DMs on this device first.';
  if (code === 'dm_members_changed') return 'The people in this conversation changed, so this was not sent.';
  if (code === 'dm_not_found' || code === 'not_a_member') return "This conversation isn't available right now, so this was not sent.";
  if (code === 'bad_key_list') return "Someone's encryption keys didn't check out, so this was not sent.";
  if (code === 'too_many_wraps') return 'Too many devices in this conversation to encrypt for.';
  if (code === 'e2ee_required') return 'This conversation only takes encrypted messages.';
  if (code === 'stale_keys') return "Someone's encryption keys changed - try again.";
  if (code === 'bad_key_list') return "That person's encryption keys don't check out, so nothing was sent. Try again later.";
  if (code === 'server_creation_paused') return `${serverCreationPolicy.title}. ${serverCreationPolicy.notice.join(' ')}`;
  return ({
    operator_terms_required: 'Accept the Ember Server Operator Terms first.', dm_privacy: DM_FAIL_TEXT, user_blocked: "You can't do that with this person - one of you has blocked the other.", cannot_block_self: "You can't block yourself.", cannot_block_staff: "Nookara staff can't be blocked.",
    channel_locked: 'Only admins can post in this channel.', channel_full: 'That voice channel is full.', not_in_server: "They're not in this server.", voice_not_connected: 'Voice is not connected.', need_a_category: 'Every channel has to be in a category.', category_required: 'Pick a category for the channel.', insufficient_balance: "You don't have enough credits for that.", price_changed: 'The price just changed - have another look.', shop_admin_role: "Roles with Administrator can't go in a shop.", bad_link: "That link doesn't look right (it needs https://).", no_webhooks_here: 'Webhooks only work in text and logs channels.', too_many_webhooks: 'A server can have up to 30 webhooks.', not_a_shop: "That channel isn't a roles shop.", purchase_failed: "That didn't go through - you weren't charged.", webhook_not_found: "That webhook doesn't exist any more.", rate_limited: 'Slow down a little!', not_a_member: "You're not in that server.",
    too_many_servers: "You've made as many servers as you can.", too_many_joined: "You're in too many servers.", invalid_invite: "That invite doesn't work.",
    invite_required: 'That server needs an invite.', banned_from_server: "You're banned from that server.", owner_cannot_leave: "You own this server - delete it instead of leaving.",
    storage_limit_exceeded: 'Your Nookara storage is full.', images_only: 'Only pictures (PNG, JPG, GIF, WebP) can be attached.', upload_suspended: 'Uploads are suspended on your account.',
    media_import_failed: "Couldn't download that media. Try downloading it and attaching the file.", invalid_media_url: 'Media links must use HTTPS without login credentials.', upload_failed: "Couldn't upload that file. Please try again.", external_upload_failed: "The file host didn't take that file. Please try again.", file_type_blocked: "That kind of file can't be uploaded.", temp_daily_quota: "You've sent as much to temporary storage as you can today - try again tomorrow, or use your account storage.", temp_storage_full: "Nookara's temporary storage is full right now - try again later, or use your account storage.", pro_required: 'Picking when a temporary file expires comes with Nookara Pro.', invalid_expiry: "That expiry doesn't work - pick another one.", uploads_disabled: 'File uploads are disabled in this server.',
    file_too_large: 'That file exceeds the upload size limit.', dms_friends_only: 'They only take messages from friends.', status_changed: 'Their status changed - take another look.', cannot_reply_own_status: "That's your own status.", cannot_dm_bot: "Bots can't be messaged.", unsupported_file: 'Only pictures, videos (MP4, WebM, MOV) and audio files can be saved.', gifs_not_configured: "GIF search isn't set up yet.", too_many_saved: 'Saved Media is full (500 GIFs).', too_many_emojis: 'This server has as many emojis as it can have (50).', bad_gif: "That GIF can't be saved.", no_send_permission: "You don't have permission to send messages here.", no_attach_permission: "You can't attach files here.", role_too_high: "That role is above your own highest role.", role_not_found: "That role doesn't exist any more.", too_many_roles: 'A server can have up to 100 roles.', user_not_found: "That person doesn't exist.", mailbox_full: 'Their inbox is full.', message_too_long: 'That message is too long.',
    last_channel: "A server needs at least one channel.", not_allowed: "You can't do that here.", owner_only: 'Only the owner can do that.', offline: "Couldn't send it - you were offline.",
    scope_disabled: 'An admin has turned this off for your account.', account_restricted: RESTRICTED_TEXT, insufficient_scope: SCOPE_TEXT, name_required: 'It needs a name.',
    instance_not_linked: "That Minecraft server isn't linked to this Ember server.", already_linked: 'That Minecraft server is already linked.', too_many_instances: 'An Ember server can link up to 10 Minecraft servers.',
    cl_bad_url: 'That CloudLink address needs to start with wss:// (or ws://).', cl_bad_port: 'CloudLink bridges can only use the normal ports (80 / 443).', cl_private_address: "That address is on a private network - Ember can't connect to it.", too_many_cloudlink_bridges: 'A server can have up to 3 CloudLink bridges.', not_a_cloudlink_bridge: "That channel isn't a CloudLink bridge.",
    sign_failed: "Not sent - it couldn't be signed.", bad_signature: "This server turned down the message's signature.",
    voice_unavailable: "Voice isn't set up on this server yet - ask its admins.", voice_cap_reached: 'This server used up its free voice minutes for the month - ask its admins.', sound_too_long: 'Sounds can be up to 5 seconds long.', not_in_voice: 'Join a voice channel first.', too_fast: 'Slow down a little!',
    nookara_required: 'Paid roles need a Nookara account - this account only exists on this server.', payment_unavailable: "This server can't take credit payments right now.", not_subscribed: 'Add this server to your Ember list (signed in with Nookara) to pay for roles.', payee_unavailable: "The server owner can't receive credits right now.", too_many_requests: 'You have too many payments waiting - finish or cancel one first.',
    youtube_unavailable: "This server can't play YouTube videos.", invalid_token: "That bot token didn't work.", platform_unreachable: "Couldn't reach that platform - try again in a bit.", owner_not_nookara: 'The owner has to be a Nookara account for that.', not_owner: "Nookara says you aren't this server's owner.", not_registered: "This server isn't registered with Nookara yet.", invalid_attestation: "That proof didn't check out - try again.", unknown_instance: "Nookara doesn't know this server yet - register it first.", instance_banned: 'Nookara has blocked this server.', not_connected: "That game server isn't connected any more.", bad_signature: "Your message's signature didn't check out - try again.", signing_unavailable: "Signing isn't available on this instance.", uploads_disabled: 'Uploads are turned off in this server.',
    inst_scope: "This sign-in is missing a permission (uploads, voice or signing). Log in to Ember again to approve it.", instance_unreachable: "Couldn't reach that homeserver.", instance_not_connected: "You're not connected to that homeserver.", not_an_instance: "That address isn't an Ember homeserver.", bad_instance_url: "That doesn't look like an address.", invalid_code: "That setup code isn't right.", already_claimed: 'This homeserver already has an owner.',
    invalid_credentials: 'Wrong username or password.', invalid_username: 'Usernames are 2-32 letters, numbers, _ or .', invalid_password: 'Passwords are 8-200 characters.', username_taken: 'That username is taken.', registration_closed: 'This homeserver is closed for new accounts.', nookara_unreachable: "The homeserver couldn't reach Nookara.", wrong_accounts_mode: "That doesn't work in this homeserver's account mode.", request_not_found: 'That request is gone.', server_full: 'That server is full.', invalid_join_policy: "That isn't a join setting.", invalid_upload_max_mb: 'Upload size must be 1-500 MB.', cannot_remove_owner: "The owner can't be removed.", mixed_instances: "That mixes two homeservers' servers.", not_on_instances: "That isn't something homeservers do.", invalid_export: "That isn't an Ember export.", payload_too_large: 'That is too big.', server_not_found: 'That server is gone.', banned: "You're banned from this homeserver.",
    console_needs_ember: 'Commands can only be run from Ember itself.', bad_purpose: 'Pick what the channel is for.', not_linked: "That server isn't linked any more.", claim_not_found: 'That code is gone - get a new one.',
    plan_feature: "Not included in this server's plan.", plan_limit: "This server's plan limit is reached.", member_cap_reached: "This server is full for its plan.", read_only: 'This server is read-only right now.',
    password_required: 'This server needs a password to join.', wrong_password: "That password isn't right.", invite_only: 'This server only lets people in with an invite link.', not_on_allowlist: "You're not on this server's list of people who can join.", server_full: 'This server is full.',
    bot_offline: "That bot isn't online right now.", unknown_command: "That command isn't available here (any more).", unknown_component: "That button doesn't work any more.", unknown_interaction: 'That form expired - run the command again.',
    timed_out: "You're timed out here for now - try again later.", automod_blocked: "AutoMod blocked that message: it has a word this server doesn't allow.", slow_down: "You're sending messages too fast - wait a moment.",
    upload_rate_limited: "You're uploading too fast - wait a minute.", upload_quota: "You've stored as many files as this server lets each member keep. Delete some first.", file_type_not_allowed: "This server doesn't take that kind of file.", storage_full: "This server's storage is full.", image_too_large: 'That picture is too big to process.',
    instance_admin_only: 'Only the homeserver admins can change that setting.', join_password_required: 'Set a password first.', invalid_join_password: 'Passwords are 4-200 characters.', cannot_report_yourself: "You can't report yourself.", nothing_to_report: 'Pick a message or a member to report.', report_not_found: "That report doesn't exist any more.",
    invalid_allowlist: 'Allowlist names are up to 64 letters, numbers, _ . : or -.', invalid_remote_accounts: "The list of homeservers has something that isn't a domain. Use example.org, or *.example.org for every name under it.", invalid_remote_min_age_days: 'New homeservers can be made to wait 0 to 365 days.', invalid_remote_invite_bypass: "The server didn't understand the invite setting.", invalid_max_members: 'Pick a member limit from 1 up.', invalid_roles: "One of those roles doesn't exist any more.", invalid_max_length: 'Pick a message length from 1 to 4000.', invalid_search_results: 'Pick 1 to 100 search results.', invalid_max_reactions: 'Pick 1 to 50 reactions.',
    invalid_preview_proxy: 'The preview proxy needs an http:// or https:// address.', invalid_words: 'Blocked words are up to 64 characters (1000 at most).', invalid_word_file: 'The word list file has to be inside the server\'s data folder.', invalid_timeout: 'Timeouts are 0 seconds to 28 days.', invalid_spam_limits: "Those spam limits don't look right.",
    invalid_retention: 'Keep entries for 1 to 3650 days.', invalid_uploads_per_minute: 'Pick 1 to 600 uploads a minute.', invalid_files_per_member: 'Pick how many files each member can keep (1 up).', invalid_file_types: 'Pick at least one kind of file.', invalid_expire_days: 'Files expire after 1 to 3650 days.', invalid_plans: 'Plan names are letters, numbers, _ or -.', invalid_storage_mb: 'Pick a storage limit from 1 MB up.', invalid_image_size: "Those picture sizes don't look right.", invalid_jpeg_quality: 'JPEG quality is 1 to 100.', local_admin_required: 'Make a local admin account first, or you could lock yourself out.',
  })[legacyToNew(code)] || 'Something went wrong.';
}

export async function loadSettings() {
  const d = await apiFetch('/chat/settings').catch(() => null);
  if (!d) return;
  // the account's upload destination is the real one; this device's copy follows it (it only counts while the account
  // can't say, e.g. before the settings load or on a Nookara that doesn't have the setting)
  const dest = d.settings?.dm_upload_dest;
  if (dest !== undefined) { try { if (dest === 'account' || dest === 'temp') localStorage.setItem(DEST_KEY, dest); else localStorage.removeItem(DEST_KEY); } catch { /* private mode */ } }
  set({ settings: d.settings, settingsFromServer: dest !== undefined });
}
export async function saveSettings(patch) {
  set(s => ({ settings: { ...s.settings, ...patch } }));
  if (patch.dm_upload_dest !== undefined) { try { if (patch.dm_upload_dest === 'account' || patch.dm_upload_dest === 'temp') localStorage.setItem(DEST_KEY, patch.dm_upload_dest); else localStorage.removeItem(DEST_KEY); } catch { /* private mode */ } }
  const d = await apiFetch('/chat/settings', { method: 'PATCH', body: JSON.stringify(patch) });
  set({ settings: d.settings });
  return d.settings;
}
// "Remove tracking from links": asked the first time a link with tracking junk is pasted / sent. Resolves true / false
// (the answer is saved as chat setting strip_tracking, so it is only ever asked once); closing the box counts as No.
let stripAsking = null;
export function askStripTracking() {
  const cur = state.settings.strip_tracking;
  if (cur === true || cur === false) return Promise.resolve(cur);
  if (stripAsking) return stripAsking;
  stripAsking = ask({
    title: 'Remove tracking from links?',
    text: 'This link has tracking junk in it (like ?si=). Want Ember to automatically remove tracking from links you paste? You can change this later in Settings.',
    confirm: 'Yes', cancel: 'No',
  }).then(yes => {
    stripAsking = null;
    saveSettings({ strip_tracking: !!yes }).catch(() => {});
    return !!yes;
  });
  return stripAsking;
}
// a link to somewhere in Ember: go there (or open the invite) without leaving the page
export function openLink(hash) {
  history.pushState(null, '', clientUrl(hash));
  open(readHash());
}

// ── Nookara notifications (the bell next to your name; they replaced the DMs from "System") ──
// GET /account/notifications(?unread=1) + /unread-count, POST /account/notifications/read; live over the home socket as
// notification_new / notifications_updated. The popup only ever lists unread ones: the full history is /me#notifications.
const notifKey = id => String(id);
const byNewest = (a, b) => (Number(b.id) - Number(a.id)) || (new Date(b.created_at) - new Date(a.created_at));
export const notifPlain = t => String(t || '').replace(/\*\*/g, '');
export async function loadNotifCount() {
  const d = await apiFetch('/account/notifications/unread-count').catch(() => null);
  if (typeof d?.unread === 'number') set({ notifUnread: d.unread });
}
// the popup opened (more = "Load more" with the cursor); anything that arrived live while loading is kept
export async function loadNotifs({ more = false } = {}) {
  const cur = state.notifs;
  if (cur?.loading || (more && !cur?.cursor)) return;
  set(s => ({ notifs: { list: [], cursor: null, ...(s.notifs || {}), loading: true, error: false } }));
  try {
    const d = await apiFetch(`/account/notifications?unread=1&limit=20${more ? `&cursor=${encodeURIComponent(cur.cursor)}` : ''}`);
    set(s => {
      if (!s.notifs) return {}; // closed meanwhile
      const seen = new Set(s.notifs.list.map(n => notifKey(n.id)));
      const list = [...s.notifs.list, ...(d.notifications || []).filter(n => !n.read && !seen.has(notifKey(n.id)))].sort(byNewest);
      return { notifs: { list, cursor: d.next_cursor ?? null, loading: false, error: false }, notifUnread: typeof d.unread === 'number' ? d.unread : s.notifUnread };
    });
  } catch { set(s => (s.notifs ? { notifs: { ...s.notifs, loading: false, error: true } } : {})); }
}
export const closeNotifs = () => { flushSeen(); set({ notifs: null }); };
// Seen in the open list (Ikelene 2026-11-14: no need to click Mark all read): the ones actually on screen get read on
// Nookara and come off the badge right away, but stay in the list (dimmed, .seen) until it closes, so nothing jumps
// around under you. Batched: one request for everything seen within ~0.4 s.
const seenQueue = new Map(); // key -> the id as Nookara gave it
let seenTimer = null;
export function seeNotifs(keys) {
  const list = state.notifs?.list || [];
  const fresh = list.filter(n => keys.includes(notifKey(n.id)) && !n.seen && !seenQueue.has(notifKey(n.id)));
  if (!fresh.length) return;
  const f = new Set(fresh.map(n => notifKey(n.id)));
  for (const n of fresh) seenQueue.set(notifKey(n.id), n.id);
  set(s => ({ notifs: s.notifs && { ...s.notifs, list: s.notifs.list.map(n => (f.has(notifKey(n.id)) ? { ...n, seen: true } : n)) }, notifUnread: Math.max(0, s.notifUnread - f.size) }));
  clearTimeout(seenTimer);
  seenTimer = setTimeout(flushSeen, 400);
}
async function flushSeen() {
  clearTimeout(seenTimer);
  const ids = [...seenQueue.values()];
  seenQueue.clear();
  if (!ids.length) return;
  try {
    const d = await apiFetch('/account/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
    if (typeof d?.unread === 'number') set({ notifUnread: d.unread });
  } catch { loadNotifCount(); }
}
// ids = [id, ...] or 'all': gone from the popup straight away, the server's count wins after
export async function readNotifs(ids) {
  const all = ids === 'all';
  const drop = new Set(all ? [] : ids.map(notifKey));
  set(s => ({ notifs: s.notifs && { ...s.notifs, list: all ? [] : s.notifs.list.filter(n => !drop.has(notifKey(n.id))) }, notifUnread: all ? 0 : Math.max(0, s.notifUnread - (drop.size - (s.notifs?.list || []).filter(n => n.seen && drop.has(notifKey(n.id))).length)) }));
  try {
    const d = await apiFetch('/account/notifications/read', { method: 'POST', body: JSON.stringify(all ? { all: true } : { ids }) });
    if (typeof d?.unread === 'number') set({ notifUnread: d.unread });
  } catch { loadNotifCount(); }
}
// a notification's link: /chat#... stays in Ember, anything else opens in the browser
export function followNotifLink(link) {
  const l = typeof link === 'string' ? link.trim() : '';
  if (!l) return;
  if (l.startsWith('/chat#')) { openLink(l.slice(5)); return; }
  const url = notifLinkUrl(l);
  if (!url) return;
  const d = desktopBridge();
  if (d?.openExternal) Promise.resolve(d.openExternal(url)).catch(() => {});
  else window.open(url, '_blank', 'noopener,noreferrer');
}
function notificationNew(m) {
  const n = m.notification;
  if (!n || n.id == null) return;
  set(s => ({
    notifUnread: typeof m.unread === 'number' ? m.unread : s.notifUnread + (n.read ? 0 : 1),
    notifs: s.notifs && !n.read && !s.notifs.list.some(x => notifKey(x.id) === notifKey(n.id)) ? { ...s.notifs, list: [n, ...s.notifs.list].sort(byNewest) } : s.notifs,
  }));
  if (!n.read) notifPing(n);
}
function notificationsUpdated(m) {
  const read = m.read === 'all' ? 'all' : new Set((m.read || []).map(notifKey));
  const gone = new Set((m.deleted || []).map(notifKey));
  const stillUnread = new Set((m.unread_ids || []).map(notifKey));
  set(s => {
    const patch = typeof m.unread === 'number' ? { notifUnread: m.unread } : {};
    if (!s.notifs) return patch;
    const list = s.notifs.list.filter(n => { const k = notifKey(n.id); return !gone.has(k) && (stillUnread.has(k) || (read === 'all' ? false : !read.has(k))); });
    return { ...patch, notifs: { ...s.notifs, list } };
  });
  // something became unread again that the open popup doesn't have: fetch the list again
  if (state.notifs && [...stillUnread].some(k => !state.notifs.list.some(n => notifKey(n.id) === k))) { set(s => ({ notifs: s.notifs && { ...s.notifs, list: [], cursor: null } })); loadNotifs(); }
}
// a new one: the DM sound (not in Do Not Disturb). No desktop / browser pop-up: it waits in the bell.
function notifPing() {
  if (state.presence[state.me?.username]?.status === 'dnd') return;
  if (packActive()) { if (state.settings.sounds) playPackSound('receive'); } else playSound('message');
}

// Nookara's token is no good any more (web Ember): start over signed out, with a note about it
export function authLost() {
  if (!isWebEmber() || authLost.done) return;
  authLost.done = true;
  endSession('ended');
}
onAuthLost(authLost);
// what the signed-in account holds (on start, and again when a lockout is lifted)
function loadAccount() { loadServers(); loadDMs(); loadGroups(); loadFriends(); loadBlocks(); loadModmail(); loadMedia(); loadNotifCount(); loadHomeRequests(); if (state.nkHome) loadSocial(); else startNookaraSocial(); }

// ── lockout: staff switched Ember and DMs off for the account (users.disabled_scopes), or Nookara's birthday gate did ──
// (no birthday set yet, or under the minimum age for their region: the same bits, told apart by restriction_reason, so the
// notice can say "set your birthday" with a link to the account settings instead of "switched off by staff")
// The "Ember and DMs" switch sets 2048 (Ember and group chat) with 64 | 128 (DMs); any of them locks, so it works before and
// after Nookara merged the two switches. Locked, the app is one calm notice (Gate.jsx LockedScreen): the instances are held
// (no connects, no retries), events are dropped and nothing toasts. The Nookara socket stays up - its `restrictions` push
// (or an instance's account_restored) is how it comes back, without a reload. Nookara's own word (/bonfire/session,
// auth_success, `restrictions`, a 403 scope_disabled) settles it; an instance's account_restricted locks at once and is
// then checked with Nookara - if Nookara says it's on, only that server keeps its per-server notice (InstanceGate).
export const LOCK_BITS = 64 | 128 | 2048;
const LOCK_KEY = () => acctKey('ember_locked');
function lockAccount() {
  if (state.locked) return;
  set({ locked: true, error: null, scopePrompt: null, permUpdate: null });
  clearTimeout(toastT);
  try { localStorage.setItem(LOCK_KEY(), state.lockReason || '1'); } catch { /* fine */ }
  voiceHook?.({ type: 'voice_closed' }); // (a DM call or voice channel is over)
  holdInstances(true);
}
function unlockAccount() {
  if (!state.locked) return;
  set({ locked: false });
  try { localStorage.removeItem(LOCK_KEY()); } catch { /* fine */ }
  holdInstances(false);
  if (!state.signedIn) return;
  if (sock && sock.readyState === 1) send({ type: 'chat_hello' }); else { retry = 0; connect(); } // (chat_ready catches up on what was dropped)
  loadAccount();
}
const LOCK_REASONS = ['staff', 'birthday_required', 'under_minimum_age'];
export function applyDisabled(disabled, reason) {
  const locked = !!((Number(disabled) || 0) & LOCK_BITS);
  const why = locked ? (LOCK_REASONS.includes(reason) ? reason : 'staff') : null; // (older Nookara: no reason = staff)
  if (state.lockReason !== why) {
    set({ lockReason: why });
    if (locked && state.locked) { try { localStorage.setItem(LOCK_KEY(), why); } catch { /* fine */ } } // (already locked: the reason changed)
  }
  if (locked) lockAccount(); else unlockAccount();
}
// an instance said account_restricted / account_restored: lock now (restriction is account-wide), and ask Nookara
let lockCheck = null;
const askNookara = () => (lockCheck ||= apiFetch(`${EMBER_API}/session`).then(d => { if (d?.disabled !== undefined) applyDisabled(d.disabled, d.restriction_reason); }).catch(() => {}).finally(() => { lockCheck = null; }));
export function instanceRestricted() {
  if (!state.signedIn) return; // (signed out: only that server's own notice)
  lockAccount();
  askNookara();
}
export function instanceRestored() { if (state.locked) askNookara(); }

// ── a v2 homeserver session runs the app (PROTOCOL 4a-4c): my account, friends and DMs are on my homeserver ──
// (only without a Nookara sign-in: with one, everything above stays as it is)
const absUrl = (origin, u) => (typeof u === 'string' && u ? (u.startsWith('/') && !u.startsWith('//') ? origin + u : /^https?:\/\//i.test(u) ? u : null) : null);
export const meFromHome = a => ({ id: a.id != null ? String(a.id) : undefined, username: a.username, display_name: a.display_name || a.username, pfp: a.avatar_url || null, color: null, rank: null, handle: a.handle, domain: a.domain, home: true });
export const homeFrom = sess => (sess?.account ? { origin: normOrigin(sess.origin), domain: sess.domain, id: stableId(sess.account.id, sess.domain), account: sess.account } : null);
// whose friends and DMs state.social holds: the v2 home session's account, or (signed in with Nookara) my Nookara account
const soc = () => state.home || state.nkHome;
export const socialAccount = s => s.home || s.nkHome;
const socialCtx = extra => { const h = soc(); return { home: h?.origin, me: h?.id, domain: h?.domain, open: state.view?.dm && pageFocused() ? state.view.dm : null, now: Date.now(), ...extra }; };
// ── signed in with Nookara: its /api/v2/social has the friends and DMs on other homeservers (routes/ember-social.js) ──
// Nookara's own friends, DMs and groups are untouched (their API, their views, end-to-end encrypted): only people who are
// not Nookara accounts and DMs hosted elsewhere (pointers) go into state.social.
const nkHomeOf = (me, domain = DEFAULT_HOMESERVER) => ({ origin: normOrigin(NOOKARA_ORIGIN), domain, id: me?.id != null ? `v:${me.id}@${domain}` : null, nookara: true });
function startNookaraSocial() {
  setNookaraSocial({
    fetch: (path, { method = 'GET', body } = {}) => apiFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    // a DM with someone elsewhere is made on nookara.cc's homeserver: with my session THERE (the instance connection)
    async postAt(url, body) {
      const at = dmHostUrl(url), host = at && normOrigin(at.origin);
      if (!host || !(await ensureHost(host))) throw Object.assign(new Error('homeserver_unreachable'), { status: 0, error: 'homeserver_unreachable' });
      return { ...(await apiFetch(at.path, { inst: host, method: 'POST', body: JSON.stringify(body) })), from: host };
    },
  });
  set({ nkHome: nkHomeOf(state.me) });
  loadSocial();
  // my id and domain as Nookara says them (not assumed: another Nookara, or a test one, has its own domain)
  if (state.me?.username) socialApi.lookup(state.me.username).then(d => {
    const { name, domain } = splitHandle(d?.id);
    if (!state.nkHome || !/^v:\d+$/.test(name) || !domain || state.nkHome.id === `${name}@${domain}`) return;
    set({ nkHome: { ...state.nkHome, domain, id: `${name}@${domain}` } });
    loadSocial();
  }).catch(() => {});
}
// my keys, their backups and device links are at my home: <social.api_url>/social/e2ee (a Nookara account signed in through
// a homeserver is sent on to Nookara, which has the same routes); other people's key documents come through it too
function startHomeKeys() {
  const body = b => (typeof b === 'string' ? JSON.parse(b) : b);
  E2EE.setHome({
    name: state.home?.domain || 'your homeserver',
    req: (path, { method = 'GET', body: b } = {}) => socialFetch(`/social/e2ee${path}`, { method, ...(b !== undefined ? { body: body(b) } : {}) }),
    keys: (id, { fresh = false } = {}) => socialFetch(`/social/keys/${encodeURIComponent(id)}${fresh ? '?fresh=1' : ''}`),
    sid: () => state.home?.id || null,
    username: () => state.me?.username || '',
  });
  E2EE.init().catch(() => {});
}
function startHome() {
  refreshHomeMe(); loadSocial(); startHomeKeys();
  onSignedOut(() => { // the homeserver ended the session (or Sign out): back to signed out
    if (!state.home) return;
    if (currentSession() && normOrigin(currentSession().origin) === state.home.origin) return;
    set({ me: null, home: null, social: emptySocial(), homeRequests: 0 });
    E2EE.setHome(null);
    if (isHomeView(state.view) && state.view.kind !== 'home') go({ kind: 'home' }, { replace: true });
  });
}
// who I am, as my homeserver has it now (GET /api/v1/me): the name and picture may have changed on another device
async function refreshHomeMe() {
  const h = state.home;
  if (!h) return;
  try {
    const r = await homeFetch('/api/v1/me', { credentials: 'omit', headers: { Accept: 'application/json' } });
    const u = r.ok ? (await r.json().catch(() => null))?.user : null;
    if (u && state.home) set(st => ({ me: { ...st.me, username: u.username || st.me.username, display_name: u.display_name || st.me.display_name, pfp: absUrl(h.origin, u.pfp) ?? st.me.pfp } }));
  } catch { /* offline: what the sign-in said stays */ }
}
// my profile on a server with its own accounts was saved (accountProfile.js): on my homeserver that is the one I go by
export function accountProfileSaved(origin) { if (state.home?.origin === origin) refreshHomeMe(); }
// the home homeserver's socket is up (instances.js): what changed while it was down
export function homeConnected(origin) { if (state.home?.origin === origin) { refreshHomeMe(); loadSocial(); if (state.e2eeStatus === 'loading') E2EE.init().catch(() => {}); else E2EE.flushOutbox(); } }
// the four lists as state.social keeps them (signed in with Nookara: without the Nookara accounts, which Home lists itself)
function setSocialLists(d, h) {
  const lists = h.nookara ? remoteFriendLists(d, h.domain) : friendLists(d, h.domain);
  const seen = listPresence(lists.friends); // (seeded from the list; social_presence events keep it current after)
  set(st => ({ social: { ...st.social, ...lists, presence: { ...st.social.presence, ...seen }, loaded: true }, ...(h.nookara ? {} : { homeRequests: lists.incoming.length }) }));
  if (h.nookara) setHomeRequests({ social: lists.incoming.length });
}
export async function loadSocialFriends() {
  const h = soc();
  if (!h) return;
  const d = await socialApi.friends().catch(() => null);
  if (!d || !soc()) return;
  setSocialLists(d, soc());
}
export async function loadSocialDms() {
  const h = soc();
  if (!h) return;
  const d = await socialApi.dms().catch(() => null);
  if (!d || !soc()) return;
  let from = h.origin;
  if (!h.nookara) try { from = new URL(await socialBase()).origin; } catch { /* the homeserver itself */ }
  // signed in with Nookara: its own DMs and groups (hosted_here, `nookara`) are already in the sidebar: only the pointers are kept
  const dms = mergeDms([{ origin: from === h.origin ? h.origin : from, dms: h.nookara ? splitNookaraDms(d).pointers : d.dms }], socialCtx());
  const open = state.view?.dm;
  set(st => ({ social: { ...st.social, dms: dms.map(x => (x.id === open ? { ...x, unread: 0, mention: false } : x)) } }));
}
export function loadSocial() { return Promise.all([loadSocialFriends(), loadSocialDms()]); }
// a social_* frame from a homeserver's gateway (not a server's event: it comes as sent)
export function socialEvent(origin, m) {
  const h = soc();
  if (!h) return;
  const fromHome = origin === h.origin;
  if (h.nookara) {
    const id = typeof m.dm === 'string' ? m.dm : m.dm?.id || m.id;
    if (m.dm && typeof m.dm === 'object' && nookaraDmView(m.dm)?.kind !== 'sdm') return; // (one of Nookara's own: its DM view has it)
    // another homeserver's gateway only speaks for a DM it hosts, and the pointer (Nookara's) does the counting
    if (!fromHome && (!['social_dm_update', 'social_dm_remove'].includes(m.type) || dmHostOf(state.social.dms.find(x => x.id === id)) !== origin)) return;
  }
  if (socialRefetch(m) === 'friends') { if (fromHome) loadSocialFriends(); return; }
  if (m.type === 'social_presence' && !fromHome) return;
  const before = state.social;
  const next = socialReduce(before, m, socialCtx({ from: origin }));
  if (next === before) return;
  set({ social: next });
  const id = typeof m.dm === 'string' ? m.dm : m.dm?.id || m.id;
  if (m.type === 'social_dm_remove' && state.view.dm === id) { go({ kind: 'home' }, { replace: true }); if (!leavingDms.has(id)) toast("You're not in that conversation any more."); }
  if (m.type === 'social_dm_update' && state.view.dm === id) { const dm = next.dms.find(x => x.id === id); if (dm?.sid && dm.channel && dm.host_origin) seedDm(dm); }
  if (m.type === 'social_dm_activity') {
    if (state.view.dm === id && pageFocused()) readSocialDm(id);
    else if (state.settings?.sounds && state.presence[state.me?.username]?.status !== 'dnd') { try { playSound('message'); } catch { /* no sound */ } }
  }
}
const dmHostOf = dm => normOrigin(dm?.host_origin);
// the DM a channel belongs to (a message came in on it), or null
function dmOfChannel(cid) {
  for (const dm of state.social.dms) if (dm.channel && dm.host_origin && K(dmHostOf(dm), dm.channel) === cid) return dm;
  return null;
}
// a message in a DM's channel: the list follows (a DM my homeserver hosts counts its own unread; one hosted elsewhere is
// counted by the pointer, which the homeserver reports with social_dm_activity)
function dmMessage(dm, msg, mine, open) {
  set(st => ({ social: { ...st.social, dms: mergeLocal(st.social.dms, { ...dm, updated_at: Date.now(), last_message_id: msg.id != null ? String(msg.id) : dm.last_message_id, unread: open || mine ? (open ? 0 : dm.unread) : dm.hosted_here ? dm.unread + 1 : dm.unread }) } }));
  if (open && !mine) readSocialDm(dm.id);
}
const mergeLocal = (list, dm) => [dm, ...list.filter(x => x.id !== dm.id)].sort((a, b) => (b.updated_at - a.updated_at) || (a.id < b.id ? -1 : 1));
// a DM as the channel view wants it: a server with one channel and its members (nothing is asked of the host: DMs are in no server list)
function seedDm(dm) {
  const host = dmHostOf(dm), sid = K(host, dm.sid), cid = K(host, dm.channel), title = dmTitle(dm, soc()?.domain);
  const members = dm.members.map(m => {
    const { name, domain } = splitHandle(m.id);
    const local = domain === dm.host; // on the host its own accounts go by the short id, everyone else by the whole one
    return { id: local ? name : m.id, username: local ? splitHandle(m.handle || '').name || name : m.handle || m.id, display_name: m.display_name || '', pfp: m.avatar_url || null, kind: local ? 'local' : 'remote', handle: m.handle || null, account: m.id, inst: host };
  });
  const old = state.detail[sid];
  const server = { ...(old?.server || {}), sid, inst: host, name: title, dm: dm.id, group: dm.group, owner_account: dm.owner, perms: 0, icon: null };
  const channel = { ...(old?.channels?.[0] || {}), cid, server: sid, inst: host, name: title, type: 'text', topic: '', can_post: true };
  set(st => ({ detail: { ...st.detail, [sid]: { server, categories: [], channels: [channel] } }, members: { ...st.members, [sid]: members } }));
  return { sid, cid };
}
async function openSocialDm(id) {
  const h = soc();
  if (!h) { set({ view: { kind: 'home' } }); return; }
  let dm = state.social.dms.find(x => x.id === id);
  if (!dm) {
    try {
      const raw = (await socialApi.dm(id)).dm, own = h.nookara ? nookaraDmView(raw) : null;
      if (own && own.kind !== 'sdm') { go(own, { replace: true }); return; } // (one of Nookara's own DMs: its own view, end-to-end encrypted)
      dm = cleanDm(raw, socialCtx({ from: h.origin }));
    } catch { dm = null; }
    if (!dm) { toast("That conversation isn't there any more."); go({ kind: 'home' }, { replace: true }); return; }
    set(st => ({ social: { ...st.social, dms: mergeLocal(st.social.dms, dm) } }));
  }
  const host = dmHostOf(dm);
  if (!host || !(await ensureHost(host))) { toast(`Couldn't connect to ${dm.host || 'the homeserver this conversation is on'}.`); if (state.view.kind !== 'home' && !state.view.sid) go({ kind: 'home' }, { replace: true }); return; }
  if (!dm.sid || !dm.channel) { // (a pointer that never said where: the host knows)
    try { const full = cleanDm((await apiFetch(`/api/v2/social/dms/${encodeURIComponent(id)}`, { inst: host })).dm, socialCtx({ from: host })); if (full) dm = { ...dm, sid: full.sid, channel: full.channel, members: full.members.length ? full.members : dm.members }; } catch { /* below */ }
    if (!dm.sid || !dm.channel) { toast("Couldn't open that conversation."); return; }
    set(st => ({ social: { ...st.social, dms: mergeLocal(st.social.dms.filter(x => x.id !== dm.id), dm) } }));
  }
  const at = seedDm(dm);
  return open({ kind: 'channel', sid: at.sid, cid: at.cid, dm: dm.id });
}
const readAt = new Map();
function readSocialDm(id) {
  const dm = state.social.dms.find(x => x.id === id);
  if (dm && (dm.unread || dm.mention)) set(st => ({ social: { ...st.social, dms: st.social.dms.map(x => (x.id === id ? { ...x, unread: 0, mention: false } : x)) } }));
  if (Date.now() - (readAt.get(id) || 0) < 2000) return;
  readAt.set(id, Date.now());
  socialApi.readDm(id).catch(() => {});
}
// ── profiles (4c.5): what a person's own homeserver says about them, asked through mine and kept a few minutes ──
const profiles = new Map(); // stable id -> { at, p }
export function socialProfileById(id) {
  const h = soc();
  if (!h || !id) return Promise.resolve(null);
  const key = stableId(id, h.domain), had = profiles.get(key);
  if (had && Date.now() - had.at < 5 * 60 * 1000) return had.p;
  const p = socialApi.profile(key).then(d => (d?.profile ? { ...d.profile, ...(d.stale ? { stale: true } : {}) } : null));
  profiles.set(key, { at: Date.now(), p });
  p.catch(() => profiles.delete(key));
  return p;
}
// someone clicked on a server (who = the member / author object): their account's profile, when they have one a homeserver can
// answer for (its own accounts and other homeservers' - not bots, not Nookara accounts). -> the profile | null
export function socialProfileOf(who) {
  if (!soc() || !who?.inst || who.bot || who.id == null || !/^l:|@/.test(String(who.id))) return Promise.resolve(null);
  const inst = state.instances.find(i => i.origin === who.inst);
  let host = ''; try { host = new URL(who.inst).host; } catch { /* odd */ }
  return socialProfileById(String(who.id).includes('@') ? String(who.id) : `${who.id}@${inst?.homeserver?.domain || host}`).catch(() => null);
}
// a name as shown: username@domain, the domain left out for people on my own homeserver
export const shownUser = name => (state.home && String(name || '').includes('@') ? shownHandleOf(name, state.home.domain) : name);
// in DMs a name is always username@domain, my own homeserver's too: a Nookara name is on Nookara's domain (as its lookup
// says), a homeserver's own accounts on that homeserver's. inst: where the name is from
export const nookaraDomain = () => state.nkHome?.domain || DEFAULT_HOMESERVER;
export function fullHandle(name, inst = NOOKARA) {
  if (!inst || inst === NOOKARA) return dmHandle(name, nookaraDomain());
  let host = ''; try { host = new URL(inst).host; } catch { /* odd */ }
  return dmHandle(name, state.instances.find(i => i.origin === inst)?.homeserver?.domain || host);
}
const shownHandleOf = (name, domain) => { const { name: n, domain: d } = splitHandle(name); return !d || d === String(domain).toLowerCase() ? n : `${n}@${d}`; };

const SOCIAL_TEXT = {
  cannot_friend_yourself: "That's you!", user_not_found: "Couldn't find anyone with that name.", wrong_homeserver: "Couldn't find anyone with that name.", blocked: "You can't send them a request.", user_blocked: 'You blocked them - unblock them first.',
  too_many_friends: 'Your friends list is full.', rate_limited: "You're doing that a lot - try again in a bit.", homeserver_rate_limited: 'Their homeserver is busy - try again in a bit.', no_request: 'That request is gone.', not_friends: "You're not friends any more.",
  remote_accounts_off: "Your homeserver doesn't talk to other homeservers.", homeserver_denied: "Your homeserver doesn't talk to that homeserver.", homeserver_not_allowed: "Your homeserver doesn't talk to that homeserver.", homeserver_unreachable: "Couldn't reach their homeserver.",
  dm_not_allowed: "They don't take messages from you.", already_member: "They're in the group already.", group_full: 'A group can have up to 10 people.', not_hosted_here: "That group's homeserver has to do that - try again in a moment.", invalid_members: "That won't work - pick up to 9 other people.", too_many_dms: 'They have too many conversations.', not_a_group: 'Only group chats can do that.', owner_only: 'Only the group owner can do that.',
  dm_not_found: "That conversation isn't there any more.", local_accounts_only: 'Friends and DMs need an account on this homeserver.', unreachable: "Couldn't reach your homeserver.", signed_out: 'Your sign-in ended - sign in again.',
};
// e.member is the id the host knows them by (l:2@b.example): with the handles that were asked for, say it by name
const whoOf = (member, handles = []) => { const d = String(member || '').split('@')[1]; const same = handles.filter(h => String(h).split('@')[1] === d); return same.length === 1 ? same[0] : member; };
export const socialErrorText = (e, handles) => `${e?.member ? `${whoOf(e.member, handles)}: ` : ''}${SOCIAL_TEXT[e?.error || e?.message] || "That didn't work - try again in a bit."}`; // (member: which person it was about)
export async function addSocialFriend(input, message) {
  const h = soc(), handle = cleanHandle(input, h?.domain);
  if (!h) return false;
  if (!handle) { toast('Type a name like alice or alice@example.org.'); return false; }
  try {
    const d = await socialApi.addFriend({ handle }, message);
    toast(d.status === 'friends' ? `You and ${accountName(d.friend, h.domain) || handle} are friends now!` : `Friend request sent to ${handle}.`, true);
    loadSocialFriends();
    return true;
  } catch (e) { toast(socialErrorText(e)); return false; }
}
// accept | remove (unfriend, take a request back, turn one down) | block | unblock
export async function socialFriendAction(what, id) {
  const h = soc();
  if (!h) return false;
  try {
    const d = await (what === 'accept' ? socialApi.accept(id) : what === 'remove' ? socialApi.removeFriend(id) : what === 'block' ? socialApi.block(id) : socialApi.unblock(id));
    if (d && Array.isArray(d.friends)) setSocialLists(d, h); else await loadSocialFriends();
    return true;
  } catch (e) { toast(socialErrorText(e)); loadSocialFriends(); return false; }
}
// start (or find) a DM: handles typed in and / or ids picked from the friends list; more than one other person makes a group
export async function startSocialDm({ handles = [], ids = [], name, group } = {}) {
  const h = soc();
  if (!h) return null;
  const members = handles.map(x => cleanHandle(x, h.domain)).filter(Boolean);
  if (!members.length && !ids.length) { toast('Pick someone to talk to.'); return null; }
  try {
    const d = await createDm({ members, ...(ids.length ? { member_ids: ids } : {}), ...(name ? { name } : {}), ...(group ? { group: true } : {}) });
    // signed in with Nookara and everyone in it is a Nookara account: Nookara's own DM / group (its view, end-to-end encrypted)
    const own = h.nookara ? nookaraDmView(d.dm) : null;
    if (own && own.kind !== 'sdm') { if (own.kind === 'group') loadGroups(); go(own); return d.dm; }
    const dm = cleanDm(d.dm, socialCtx({ from: d.from || h.origin }));
    if (!dm) throw new Error('request_failed');
    set(st => ({ social: { ...st.social, dms: mergeLocal(st.social.dms, { ...(st.social.dms.find(x => x.id === dm.id) || {}), ...dm }) } }));
    go({ kind: 'sdm', id: dm.id });
    return dm;
  } catch (e) { toast(socialErrorText(e, members)); return null; }
}
// "New message" with the Nookara sign-in: a Nookara name opens its DM as ever (alice, alice@nookara.cc); name@another.homeserver
// starts (or finds) the DM with them, which is made on nookara.cc's homeserver
export function messageSomeone(input) {
  const h = soc(), typed = String(input || '').trim().replace(/^@/, '');
  if (!h?.nookara || !typed.includes('@')) { if (typed) go({ kind: 'dm', username: typed }); return null; }
  const handle = cleanHandle(typed, h.domain);
  if (!handle) { toast('Type a name like alice or alice@example.org.'); return null; }
  if (!handle.includes('@')) { go({ kind: 'dm', username: handle }); return null; }
  return startSocialDm({ handles: [handle] });
}
// rename a group, remove someone from it, or leave it: asked of the homeserver the DM is on
const leavingDms = new Set(); // DMs I'm leaving right now
export async function socialDmAction(what, id, arg) {
  const dm = state.social.dms.find(x => x.id === id), host = dmHostOf(dm);
  if (!dm || !soc()) return false;
  const at = `/api/v2/social/dms/${encodeURIComponent(id)}`;
  try {
    const up = host && (await ensureHost(host));
    if (what === 'leave') {
      leavingDms.add(id); setTimeout(() => leavingDms.delete(id), 15000); // (its social_dm_remove is my own doing: no "you're not in it" note)
      if (up) await apiFetch(`${at}/leave`, { method: 'POST', inst: host });
      if (!up || !dm.hosted_here) await socialApi.leaveDm(id).catch(() => {}); // (my homeserver's pointer goes now, not when the host gets round to saying so)
      set(st => ({ social: { ...st.social, dms: st.social.dms.filter(x => x.id !== id) } }));
      if (state.view.dm === id) go({ kind: 'home' }, { replace: true });
      return true;
    }
    if (!up) throw Object.assign(new Error('unreachable'), { error: 'unreachable' });
    const d = what === 'rename' ? await apiFetch(at, { method: 'PATCH', inst: host, body: JSON.stringify({ name: arg }) })
      : what === 'add' ? await apiFetch(`${at}/members`, { method: 'POST', inst: host, body: JSON.stringify({ members: arg }) }) // (arg: [handle])
      : await apiFetch(`${at}/members/${encodeURIComponent(arg)}`, { method: 'DELETE', inst: host });
    if (d?.dm) socialEvent(host, { type: 'social_dm_update', dm: d.dm });
    return true;
  } catch (e) { toast(socialErrorText(e, Array.isArray(arg) ? arg : [])); return false; }
}

// me = null: signed out of Nookara (web Ember without a token) - only local-account instances work then
// home: a v2 homeserver session instead of the Nookara sign-in (homeFrom): `me` is that account, the Nookara-only parts stay off
export function init(me, home = null) {
  const nk = !!me && !home;
  set({ me, signedIn: nk, home });
  if (nk) { try { const was = localStorage.getItem(LOCK_KEY()); if (was) { if (LOCK_REASONS.includes(was)) set({ lockReason: was }); lockAccount(); } } catch { /* fine */ } } // (locked last time: no flash of the app before /bonfire/session answers)
  desktopBridge()?.onSignIn?.(s => set({ reauth: s.state === 'failed' ? { state: 'failed', error: s.error } : { state: 'working' } }));
  if (nk) { checkPermissions(); loadSettings(); loadNotify(); loadEmojis(); loadPersonalEmojis(); connect(); }
  desktopBridge()?.isFocused?.().then(v => { desktopFocused = !!v; }).catch(() => {});
  desktopBridge()?.onWindowFocus?.(v => { desktopFocused = v; if (v) markViewRead(); });
  startInstances(); // (held while locked: nothing connects until it's lifted)
  if (nk) setupSigning();
  if (nk && !state.locked) { loadAccount(); E2EE.init().catch(() => {}); } // (the keys are plain requests to Nookara: no waiting for its socket)
  if (home) startHome();
  window.addEventListener('popstate', () => open(readHash()));
  const markFocusedViewRead = () => {
    if (pageFocused()) markViewRead();
  };
  document.addEventListener('visibilitychange', markFocusedViewRead);
  window.addEventListener('focus', markFocusedViewRead);
  // settings saved from My Account > Chat (or another tab/device) apply live
  window.addEventListener('vc-settings', e => {
    if (!e.detail) return;
    set({ settings: e.detail, ...(e.detail.dm_upload_dest !== undefined ? { settingsFromServer: true } : {}) });
    const dest = e.detail.dm_upload_dest; // (this device's copy of the upload destination follows the account)
    if (dest !== undefined) { try { if (dest === 'account' || dest === 'temp') localStorage.setItem(DEST_KEY, dest); else localStorage.removeItem(DEST_KEY); } catch { /* private mode */ } }
  });
  let settingsAt = Date.now();
  const refreshSettings = () => { if (document.visibilityState !== 'visible' || Date.now() - settingsAt < 30000) return; settingsAt = Date.now(); loadSettings(); };
  document.addEventListener('visibilitychange', refreshSettings);
  window.addEventListener('focus', refreshSettings);
  // Interaction refreshes the ten-minute active period.  The 30-second rate
  // limit in noteEmberActivity makes pointer movement inexpensive.
  const reportEmberActivity = () => {
    if (document.visibilityState === 'visible' && pageFocused()) noteEmberActivity();
  };
  ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart'].forEach(type => window.addEventListener(type, reportEmberActivity, { passive: true, capture: true }));
  reportEmberActivity();
  desktopBridge()?.onNotificationAction?.(action => {
    if (!action || !onceDesktopAction(action)) return;
    if (action?.type === 'dm') {
      const username = String(action.to || '');
      if (!username) return;
      go({ kind: 'dm', username });
      if (action.action === 'reply' && String(action.text || '').trim()) sendMessage({ kind: 'dm', username }, String(action.text).trim());
    } else if (action?.type === 'call') {
      dispatchEvent(new CustomEvent(NOTIFICATION_ACTION_EVENT, { detail: action }));
    }
  });
}

// ── permissions: the apps sign in with a scoped token (Nookara's approve-this-app screen) ──
// /bonfire/scopes.json = what Ember asks for (versioned, one list on the server); /bonfire/session = which of those
// THIS token is missing. Website sessions have everything, so only the apps ever see these prompts.
//  - permUpdate: "New permission updates" dialog (on start / page load, when a required permission is missing)
//  - scopePrompt: a feature was refused for a missing permission ("This needs a new permission - log in again")
let scopeCatalog = null;
const getCatalog = () => (scopeCatalog ||= fetch(`${EMBER_API}/scopes.json`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ scopes: [] })));
let scopeAt = 0;
function markLack(id, how) {
  if (!id || state.scopeLack?.[id] === how) return;
  set(s => ({ scopeLack: { ...(s.scopeLack || {}), [id]: how } }));
}
export async function scopeDenied(info) {
  const bit = Number(info?.required_scope) || 0;
  const byAdmin = !!info?.disabled_by_admin || info?.error === 'scope_disabled';
  // remember it, so the control greys out from now on (the up-front check below normally already did)
  if (bit) getCatalog().then(cat => markLack((cat.scopes || []).find(x => x.bit === bit)?.id, byAdmin ? 'disabled' : 'missing'));
  if (byAdmin && bit & LOCK_BITS) { if (LOCK_REASONS.includes(info?.reason) && state.lockReason !== info.reason) set({ lockReason: info.reason }); lockAccount(); } // Ember or DMs switched off: the whole app locks
  if (byAdmin) return; // an admin switched it off: logging in again won't change that
  if (Date.now() - scopeAt < 6000) return; // one prompt, not one per refused request
  scopeAt = Date.now();
  const cat = await getCatalog();
  const sc = (cat.scopes || []).find(x => x.bit === bit);
  set({ scopePrompt: { name: sc?.name || null, reason: sc?.reason || '' } });
}
// What THIS login can do, known up front: '' = fine (website sessions always), 'missing' = log in again to approve it,
// 'disabled' = an admin turned it off for the account. Both return primitives, so they are stable selectors.
export function useScopeStatus(id) { return useChat(s => s.scopeLack?.[id] || ''); }
export function useScope(id) { return useChat(s => !s.scopeLack?.[id]); }
export function scopeTip(status, what) {
  if (!status) return undefined;
  return status === 'disabled' ? 'An admin turned this off for your account.' : `${what || 'This'} needs a new permission. Click to log in again.`;
}
// click handler for a locked control: shows the "needs a new permission" prompt (no 6 s debounce, the user asked for it)
export async function scopeBlocked(id) {
  const lack = state.scopeLack?.[id];
  if (!lack) return false;
  if (lack === 'disabled') { toast('An admin turned this off for your account.'); return true; }
  const cat = await getCatalog();
  const sc = (cat.scopes || []).find(x => x.id === id);
  scopeAt = Date.now();
  set({ scopePrompt: { name: sc?.name || null, reason: sc?.reason || '' } });
  return true;
}
onScopeError(scopeDenied);
// raw fetch() uploads (avatars, emojis, files...) don't go through apiFetch: watch their answers too
if (typeof window !== 'undefined' && !window.__bfScopeWatch) {
  window.__bfScopeWatch = true;
  const real = window.fetch.bind(window);
  window.fetch = (...a) => real(...a).then(r => {
    if (r.status === 403) r.clone().json().then(d => { if (d?.error === 'insufficient_scope' || d?.error === 'scope_disabled') scopeDenied(d); }).catch(() => {});
    return r;
  });
}
// after "Log in again" the page reloads with the new token: sign the old app token out, and keep the saved-accounts list pointing at the new one
async function afterReauth() {
  let prev = null;
  try { prev = localStorage.getItem('bf_prev_token'); localStorage.removeItem('bf_prev_token'); } catch { /* fine */ }
  const cur = getToken();
  if (!prev || !cur || prev === cur) return;
  try { // the saved-accounts list: the website's velora_saved, or web Ember's own ember_saved
    const key = isWebEmber() ? 'ember_saved' : SITE_SAVED;
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved) && saved.some(a => a && a.token === prev)) localStorage.setItem(key, JSON.stringify(saved.map(a => (a && a.token === prev ? { ...a, token: cur } : a))));
  } catch { /* fine */ }
  await apiFetch(`${EMBER_API}/replace-token`, { method: 'POST', body: JSON.stringify({ old: prev }) }).catch(() => {});
}
export async function checkPermissions() {
  try {
    await afterReauth();
    const d = await apiFetch(`${EMBER_API}/session`);
    if (d?.disabled !== undefined) applyDisabled(d.disabled, d.restriction_reason); // (website sessions too: the lockout is the account's, not the token's)
    if (!d?.app) { set({ permUpdate: null, scopeLack: null }); return; }
    try { // which scopes this token lacks (granted) or an admin switched off (disabled), by id
      const cat = await getCatalog();
      const lack = {};
      for (const sc of cat.scopes || []) {
        if (((Number(d.disabled) || 0) & sc.bit) === sc.bit) lack[sc.id] = 'disabled';
        else if (((Number(d.granted) || 0) & sc.bit) !== sc.bit) lack[sc.id] = 'missing';
      }
      if (JSON.stringify(lack) !== JSON.stringify(state.scopeLack || {})) set({ scopeLack: Object.keys(lack).length ? lack : null });
    } catch { /* fine */ }
    const missing = d.missing || [];
    let later = false;
    try { later = sessionStorage.getItem('bf_perm_later') === `${d.version}:${missing.map(x => x.id).join(',')}`; } catch { /* fine */ }
    set({ permUpdate: missing.length && !later ? { version: d.version, legacy: !!d.legacy, missing } : null });
  } catch { /* offline / old server: nothing to ask */ }
}
export function permLater() {
  const p = state.permUpdate;
  if (p) { try { sessionStorage.setItem('bf_perm_later', `${p.version}:${p.missing.map(x => x.id).join(',')}`); } catch { /* fine */ } }
  set({ permUpdate: null });
}
export function dismissScopePrompt() { set({ scopePrompt: null }); }
// "Log in again": the apps open Nookara's approve-this-app page in the browser; the old login keeps working until the new one is approved
export function loginAgain() {
  try { const t = getToken(); if (t) localStorage.setItem('bf_prev_token', t); } catch { /* fine */ }
  set({ permUpdate: null, scopePrompt: null, reauth: { state: 'waiting' } });
  if (desktopBridge()?.signIn) { desktopBridge().signIn(); return; }
  if (isWebEmber()) { startSignIn(); return; } // the web has its own sign-in (a token of its own, not the website's session)
  location.href = '/login?next=%2Fchat'; // (apps only) the Android app turns this into its own browser sign-in screen
}
export function clearReauth() { set({ reauth: null }); }

// in-app "are you sure?" (instead of the browser's confirm / prompt):
//   await ask({ title, text, confirm: 'Delete', danger: true, match: 'type this to confirm' }) -> true / false
export function ask(opts) {
  if (state.ask) state.ask.resolve(false);
  return new Promise(resolve => set({ ask: { ...opts, resolve } }));
}
export function answerAsk(v) {
  const a = state.ask;
  if (!a) return;
  set({ ask: null });
  a.resolve(v);
}

// ── right-click menus ──
export function setMenu(m) { set({ menu: m }); }

// ── per channel / server notification settings ──
export async function loadNotify() {
  const d = await apiFetch('/chat/notify').catch(() => null);
  if (d) set(s => ({ notify: { ...Object.fromEntries(Object.entries(s.notify).filter(([k]) => isInst(k))), ...d.notify } }));
}
export function notifyOf(target) { return state.notify[target] || { level: null, muted_until: null, push: true }; }
export async function setNotify(target, patch) {
  try {
    const d = await apiFetch(`/chat/notify/${target}`, { method: 'PUT', body: JSON.stringify(patch) });
    set(s => ({ notify: { ...s.notify, [target]: d.notify } }));
    if (patch.mute_minutes !== undefined) toast(patch.mute_minutes === 0 ? 'Unmuted.' : 'Muted.', true);
  } catch (e) { toast(errorText(e.message)); }
}
// the channel's setting, else its server's, else "only @mentions"
export function effectiveNotify(cid, sid) {
  const now = Date.now();
  const ch = state.notify[cid] || {}, sv = state.notify[sid] || {};
  const muted = !!((ch.muted_until && ch.muted_until > now) || (sv.muted_until && sv.muted_until > now));
  const level = ch.level && ch.level !== 'default' ? ch.level : (sv.level && sv.level !== 'default' ? sv.level : 'mentions');
  return { muted, level };
}
export function isMuted(target) { const n = state.notify[target]; return !!(n?.muted_until && n.muted_until > Date.now()); }
export function clearMentions(sid, cids) {
  set(s => {
    const mentions = { ...s.mentions };
    let live = s.srvMentions[sid] || 0, fromServer = 0;
    cids.forEach(cid => { live -= mentions[cid] || 0; delete mentions[cid]; fromServer += s.detail[sid]?.channels.find(c => c.cid === cid)?.mentions || 0; });
    const dd = s.detail[sid];
    const channels = dd ? dd.channels.map(c => (cids.includes(c.cid) ? { ...c, mentions: 0 } : c)) : null;
    // with the server's channels loaded, its badge = what's left on its channels (a stale count can't get stuck)
    if (channels) {
      live = channels.reduce((n, c) => n + (mentions[c.cid] || 0), 0);
      const left = channels.reduce((n, c) => n + (c.mentions || 0), 0);
      return {
        mentions,
        srvMentions: { ...s.srvMentions, [sid]: live },
        servers: s.servers.map(x => (x.sid === sid ? { ...x, mentions: left } : x)),
        detail: { ...s.detail, [sid]: { ...dd, channels } },
      };
    }
    return {
      mentions,
      srvMentions: { ...s.srvMentions, [sid]: Math.max(0, live) },
      servers: s.servers.map(x => (x.sid === sid ? { ...x, mentions: Math.max(0, (x.mentions || 0) - fromServer) } : x)),
    };
  });
}
// a new sidebar layout, drawn straight away (Manage channels drag and drop)
export function setDetailLayout(sid, categories, order) {
  set(s => {
    const d = s.detail[sid];
    if (!d) return {};
    let channels = d.channels;
    if (order) channels = order.map((c, i) => ({ ...(d.channels.find(x => x.cid === c.cid) || c), category: c.category || '', position: i }));
    else channels = channels.map(c => (c.category && !categories.includes(c.category) ? { ...c, category: '' } : c));
    return { detail: { ...s.detail, [sid]: { ...d, categories, channels } } };
  });
}
export async function markChannelRead(cid, sid) {
  clearMentions(sid, [cid]);
  const d = state.detail[sid];
  const c = d?.channels.find(x => x.cid === cid);
  await apiFetch(`/chat/channels/${cid}/read`, { method: 'POST', body: JSON.stringify({ id: c?.last_message_id }) }).catch(() => {});
  channelSeen(sid, cid);
}
export async function markServerRead(sid) {
  const d = state.detail[sid] || await refreshServer(sid);
  if (!d) return;
  clearMentions(sid, d.channels.map(c => c.cid));
  set(s => ({ servers: s.servers.map(x => (x.sid === sid ? { ...x, mentions: 0 } : x)) }));
  await Promise.all(d.channels.filter(c => c.unread || state.unread[`c:${c.cid}`]).map(c => apiFetch(`/chat/channels/${c.cid}/read`, { method: 'POST', body: JSON.stringify({ id: c.last_message_id }) }).catch(() => {})));
  set(s => {
    const unread = { ...s.unread };
    d.channels.forEach(c => { unread[`c:${c.cid}`] = false; });
    const dd = s.detail[sid];
    const unreadN = Object.fromEntries(Object.entries(s.unreadN).filter(([, u]) => u.sid !== sid));
    return { unread, unreadN, servers: s.servers.map(x => (x.sid === sid ? { ...x, unread: false, unread_count: 0 } : x)), detail: dd ? { ...s.detail, [sid]: { ...dd, channels: dd.channels.map(c => ({ ...c, unread: false, unread_count: 0 })) } } : s.detail };
  });
}
