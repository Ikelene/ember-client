// End-to-end encrypted DMs in Ember: holds this device's keys, seals what goes out, opens what comes in. No store imports, store.js calls into it.
// The format is nke1.js, how it all fits together is docs/E2EE.md in the Nookara repo.
import { apiFetch } from '../../api.js';
import * as N from './nke1.js';
import { mimeOf } from './files.js';
import * as KS from './keystore.js';
import { acctKey } from '../ids.js';
import { notifBridge } from '../../compat.js';
import { bundleOfDoc, pinState, normId, splitId, isNookaraId, validSecret, secretKindOf } from './keydoc.js';
import * as HD from './homedm.js';

// ── the key home: where this account's own keys, backups and device links live, and who is asked for other people's keys ──
// A Nookara sign-in: Nookara's /im/keys. A v2 homeserver session: <social.api_url>/social/e2ee on its home (store.js sets
// that with setHome; for a Nookara account signed in through a homeserver it lands on Nookara, which mounts the same routes).
//   req(path, { method, body: JSON text }) -> the answer; path is under the base ('/me', '', '/unlock', '/link/<code>' ...)
//   keys(id, { fresh }) -> someone's key document, from their home through mine (GET /social/keys/<id>)
//   sid() -> my stable id when /me doesn't say (an older Nookara); nookara: false = a homeserver that is not Nookara
const NOOKARA_HOME = {
  nookara: true, name: 'Nookara',
  req: (path, opts) => apiFetch(`/im/keys${path}`, opts),
  keys: (id, { fresh = false } = {}) => apiFetch(`/api/v2/social/keys/${encodeURIComponent(id)}${fresh ? '?fresh=1' : ''}`),
  sid: () => null,
};
let home = NOOKARA_HOME;
export const setNookaraSid = fn => { NOOKARA_HOME.sid = fn; };
export const myKid = () => keys?.kid || null;

// what stretches a DM passcode. 64 MB makes guessing expensive, on a phone it takes a second or two.
const ARGON = { m: 65536, t: 3, p: 1 };
async function stretchPasscode(passcode, saltS, params = ARGON) {
  const { argon2id } = await import('hash-wasm');
  const out = await argon2id({ password: passcode, salt: N.unb64(saltS), parallelism: params.p, iterations: params.t, memorySize: params.m, hashLength: 64, outputType: 'binary' });
  return N.stretched(out);
}
// what locks the keys: Nookara keeps its PIN or password; on any other homeserver it is a passphrase (keydoc.js)
export const secretHome = () => ({ nookara: info?.passcode_rules ? false : home.nookara || isNookaraId(mySid()), name: home.name, min: Number(info?.passcode_rules?.min_length) || 0 });
export const validPasscode = (type, v) => validSecret(secretHome(), type, v);

let me = null; // { id: what my signatures carry (a Nookara user id, or my stable id on a homeserver), username }
let keys = null; // what keystore.js holds for me, when this device is unlocked
let info = null; // GET /im/keys/me
let listeners = new Set();
const status = () => (!me ? 'loading' : keys ? 'ready' : info?.has ? 'locked' : info ? 'none' : 'loading');
export const getStatus = status;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
// has this device unlocked DMs for this account before? Remembered here so that, while the keys are still being read after a reload,
// Ember says it's decrypting instead of asking to unlock again (cleared when the device turns out locked, and on sign-out)
const UNLOCKED = () => acctKey('ember_e2ee_unlocked');
export const unlockedBefore = () => { try { return localStorage.getItem(UNLOCKED()) === '1'; } catch { return false; } };
function rememberUnlocked(st) {
  try { if (st === 'ready') localStorage.setItem(UNLOCKED(), '1'); else if (st === 'locked' || st === 'none') localStorage.removeItem(UNLOCKED()); } catch { /* fine */ }
}
const changed = () => { const st = status(); rememberUnlocked(st); listeners.forEach(f => f(st)); };

// the Android app shows notifications from its own native connection, so it needs the key too (it keeps it in its Keystore-locked storage)
function shareWithNative(enc_priv) {
  try { notifBridge()?.postMessage(JSON.stringify({ type: 'dm_key', kid: keys?.kid, jwk: enc_priv })); } catch { /* an older app: names only */ }
}

// my stable id (v:5@nookara.cc, l:5@a.example): what homeserver DMs know me by
export const mySid = () => { const id = info?.id || home.sid?.() || null; return id ? normId(id) : null; };
// another home (a homeserver session started or ended): everything of the account before goes
export function setHome(h) {
  home = h ? { ...NOOKARA_HOME, nookara: false, ...h } : NOOKARA_HOME;
  me = null; keys = null; info = null;
  forgetAllBundles();
  changed();
}
export async function init() {
  info = await home.req('/me').catch(() => null);
  if (!info) return status();
  me = { id: String(info.user_id ?? info.owner ?? info.id), username: info.username || home.username?.() || '' };
  const local = await KS.getKeys(me.id).catch(() => null);
  // the account has moved on to a new key since this device was unlocked: this one can't read new messages, so it unlocks again
  keys = local && info?.has && local.kid === info.kid ? local : null;
  if (keys) shareOnce();
  changed();
  return status();
}
async function shareOnce() {
  if (!notifBridge()) return;
  shareWithNative((await privateKeys()).enc_priv);
}
export const signOut = async () => { if (me) await KS.dropKeys(me.id).catch(() => {}); keys = null; try { notifBridge()?.postMessage(JSON.stringify({ type: 'dm_key', kid: '', jwk: null })); } catch { /* */ } changed(); };

// ── keeping keys on this device ──
async function holdKeys(secret) {
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const sealed = await N.lockBlob(secret, deviceKey);
  keys = { uid: me.id, kid: secret.kid, enc_pub: secret.enc_pub, sig_pub: secret.sig_pub, encPriv: await N.importEncPriv(secret.enc_priv), sigPriv: await N.importSigPriv(secret.sig_priv), deviceKey, sealed };
  await KS.putKeys(keys);
  shareWithNative(secret.enc_priv);
  info = await home.req('/me').catch(() => info);
  changed();
  flushOutbox();
}
const privateKeys = () => N.openBlob(keys.sealed, keys.deviceKey);

// ── first setup / replacing lost keys ──
// on a homeserver that is not Nookara a PIN never locks the keys (passphrase_required, here and from the home), and each
// half says what it was locked with (secret_kind)
const typeOf = type => (secretHome().nookara ? type : 'password');
function checkSecret(type, passcode) { if (!validPasscode(type, passcode)) throw new Error(secretHome().nookara ? 'weak_passcode' : 'passphrase_required'); }
async function buildBackups(secret, type, passcode, recovery) {
  const pSalt = N.b64(N.random(16)), rSalt = N.b64(N.random(16)), h = secretHome();
  const p = await stretchPasscode(passcode, pSalt), r = await N.stretchRecovery(recovery, rSalt);
  return {
    passcode: { type: typeOf(type), ...secretKindOf(h, 'passcode'), salt: pSalt, params: ARGON, ...(await N.lockBlob(secret, p.wrap)), auth: p.auth },
    recovery: { ...secretKindOf(h, 'recovery'), salt: rSalt, ...(await N.lockBlob(secret, r.wrap)), auth: r.auth },
  };
}
// -> the recovery code, to show once
export async function setup(type, passcode, { replace = false } = {}) {
  checkSecret(type, passcode);
  const secret = await N.newKeys();
  const recovery = N.newRecoveryCode();
  const b = await buildBackups(secret, type, passcode, recovery);
  await home.req('', { method: 'POST', body: JSON.stringify({ enc_pub: secret.enc_pub, sig_pub: secret.sig_pub, ...b, replace }) });
  forgetAllBundles();
  await holdKeys(secret);
  return recovery;
}

// ── unlocking on a device that doesn't have them ──
export const passcodeInfo = () => info?.passcode || null;
export async function unlockPasscode(passcode) {
  const p = info?.passcode;
  if (!p) throw new Error('no_backup');
  const s = await stretchPasscode(passcode, p.salt, p.params);
  try {
    const blob = await home.req('/unlock', { method: 'POST', body: JSON.stringify({ kind: 'passcode', auth: s.auth }) });
    await holdKeys(await N.openBlob(blob, s.wrap));
  } catch (e) { info = await home.req('/me').catch(() => info); changed(); throw e; }
}
export async function unlockRecovery(code) {
  const r = info?.recovery;
  if (!r) throw new Error('no_backup');
  const s = await N.stretchRecovery(code, r.salt);
  const blob = await home.req('/unlock', { method: 'POST', body: JSON.stringify({ kind: 'recovery', auth: s.auth }) });
  await holdKeys(await N.openBlob(blob, s.wrap));
}

// ── changing what locks them ──
const proof = async () => { const ts = Date.now(); return { ts, proof: await N.signProof(`backup|${me.id}|${ts}`, keys.sigPriv) }; };
export async function changePasscode(type, passcode) {
  checkSecret(type, passcode);
  const secret = await privateKeys(), salt = N.b64(N.random(16));
  const s = await stretchPasscode(passcode, salt);
  await home.req('/backup', { method: 'PUT', body: JSON.stringify({ kind: 'passcode', type: typeOf(type), ...secretKindOf(secretHome(), 'passcode'), salt, params: ARGON, ...(await N.lockBlob(secret, s.wrap)), auth: s.auth, ...(await proof()) }) });
  info = await home.req('/me').catch(() => info);
  changed();
}
export async function newRecovery() {
  const secret = await privateKeys(), salt = N.b64(N.random(16)), code = N.newRecoveryCode();
  const s = await N.stretchRecovery(code, salt);
  await home.req('/backup', { method: 'PUT', body: JSON.stringify({ kind: 'recovery', ...secretKindOf(secretHome(), 'recovery'), salt, ...(await N.lockBlob(secret, s.wrap)), auth: s.auth, ...(await proof()) }) });
  return code;
}

// ── linking ──
// This device asks. -> { code, wait(): resolves once a trusted device approved it, rejects if denied or expired, cancel() }
export async function startLink(label) {
  const k = await N.newLinkKey();
  const kid = await N.kidOf(k.enc_pub);
  const r = await home.req('/link', { method: 'POST', body: JSON.stringify({ enc_pub: k.enc_pub, label }) });
  // the code is made from my key on this side too: if Nookara swapped the key, the code wouldn't match
  const code = await N.linkCode(k.enc_pub);
  if (code !== r.code) throw new Error('link_mismatch');
  let stop = false;
  const wait = (async () => {
    while (!stop) {
      await new Promise(ok => setTimeout(ok, 2500));
      if (stop) return false;
      const s = await home.req(`/link/${encodeURIComponent(code)}`).catch(e => { if (e.message === 'link_not_found') throw new Error('link_expired'); return null; });
      if (s?.state === 'denied') throw new Error('link_denied');
      if (s?.state === 'approved' && s.sealed) { await holdKeys(await N.unsealJson(s.sealed, k.enc_priv, kid)); return true; }
    }
    return false;
  })();
  return { code, wait, cancel: () => { stop = true; } };
}
// A trusted device looks up a code it was given. Refuses a request whose key doesn't match the code.
export async function lookupLink(code) {
  const clean = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const l = await home.req(`/link/${encodeURIComponent(clean)}`);
  if ((await N.linkCode(l.enc_pub)).replace('-', '') !== clean) throw new Error('link_mismatch');
  return { ...l, code: clean };
}
const myBundle = async () => { info = await home.req('/me'); return info; };
const clientsDoc = () => info?.clients || { seq: 0, list: [] };
async function saveDoc(path, method, doc, extra = {}) {
  const sig = await N.signClients(me.id, keys.kid, doc, keys.sigPriv);
  await home.req(path, { method, body: JSON.stringify({ doc, sig, ...extra }) });
  await myBundle();
  if (me.username) forgetBundle(me.username);
  changed();
}
// { history: true } = hand a client the old DMs as well. onProgress(n)
export async function approveLink(l, { history = false, onProgress } = {}) {
  await myBundle();
  if (l.kind === 'device') {
    const sealed = await N.sealJson(await privateKeys(), l.enc_pub, await N.kidOf(l.enc_pub));
    await home.req(`/link/${encodeURIComponent(l.code)}/approve`, { method: 'POST', body: JSON.stringify({ sealed }) });
    return;
  }
  const cur = clientsDoc();
  const kid = await N.kidOf(l.enc_pub);
  const doc = { seq: Number(cur.seq || 0) + 1, list: [...(cur.list || []).filter(c => c.kid !== kid), { kid, enc_pub: l.enc_pub, sig_pub: l.sig_pub, label: l.label, app: l.app || '', added_at: Date.now(), revoked_at: 0 }] };
  await saveDoc(`/link/${encodeURIComponent(l.code)}/approve`, 'POST', doc);
  if (history && home.nookara) await shareHistory(kid, l.enc_pub, onProgress);
}
export const denyLink = code => home.req(`/link/${encodeURIComponent(code)}/deny`, { method: 'POST' });
async function shareHistory(kid, encPub, onProgress) {
  let before = null, total = 0;
  for (;;) {
    const d = await apiFetch(`/im/keys/history?limit=200${before ? `&before=${before}` : ''}`);
    if (!d.items.length) return total;
    const items = [];
    for (const it of d.items) {
      const k = await N.messageKey({ wraps: { [keys.kid]: it.wrap }, commit: it.commit }, keys.kid, keys.encPriv);
      if (k) items.push({ id: it.id, wrap: await N.seal(k, encPub, kid) });
    }
    if (items.length) await apiFetch('/im/keys/history', { method: 'POST', body: JSON.stringify({ kid, items }) });
    total += items.length;
    onProgress?.(total);
    before = d.items[d.items.length - 1].id;
    if (!d.has_more) return total;
  }
}
export const linkedClients = () => clientsDoc().list?.filter(c => !c.revoked_at) || [];
export async function revokeClient(kid) {
  await myBundle();
  const cur = clientsDoc();
  const doc = { seq: Number(cur.seq || 0) + 1, list: (cur.list || []).map(c => (c.kid === kid ? { ...c, revoked_at: Date.now() } : c)) };
  await saveDoc('/clients', 'PUT', doc);
}

// ── other people's keys ──
// Keys hardly ever change, and Nookara says when they do (e2ee_keys_changed -> forgetBundle), so a bundle is kept an hour.
// Opening a conversation opens every message at once and each checks its sender's signature: they all share ONE request
// (inflight), and a refusal (blocked, DM privacy, rate limited, offline) is remembered for a while too, so it isn't asked again per message.
const bundles = new Map(); // username (lower) -> { at, b } | { at, none: true } | { at, err }
const inflight = new Map(); // username (lower) -> the request on its way
const gens = new Map(); // username (lower) -> bumped by forgetBundle: a request that started before it never stores what it got
let epoch = 0; // the same for all of them (forgetAllBundles)
const BUNDLE_MS = 60 * 60 * 1000; // keys
const NONE_MS = 5 * 60 * 1000; // "hasn't set up yet" (they get e2ee_keys_changed to people they've talked to, strangers need asking again)
const ERR_MS = 2 * 60 * 1000; // blocked / DM privacy / not found
const BUSY_MS = 30 * 1000; // rate limited, offline, server trouble
const FRESH_MS = 3000; // a "fresh" ask right after a fetch takes that one
const noticeSubs = new Set();
export const onKeyChange = fn => { noticeSubs.add(fn); return () => noticeSubs.delete(fn); };
const ttl = v => (v.b ? BUNDLE_MS : v.none ? NONE_MS : v.err?.status >= 400 && v.err.status < 500 && v.err.status !== 429 ? ERR_MS : BUSY_MS);
// { b } | { none: true }. Throws what the server said for anything else (blocked, DM privacy)
export function bundleFor(username, { fresh = false } = {}) {
  const key = String(username).toLowerCase();
  const hit = bundles.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && (fresh ? age < FRESH_MS : age < ttl(hit))) return hit.err ? Promise.reject(hit.err) : Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = fetchBundle(username, key).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
    inflight.set(key, p);
  }
  return p;
}
// The same for someone known by their stable id (a homeserver DM's members): their key document, from their home through
// mine, checked here (keydoc.js: the owner, the kid, the client list's signature) and pinned. { b } | { none: true }
const docKey = id => `id ${normId(id)}`;
export function docBundle(id, { fresh = false } = {}) {
  const key = docKey(id);
  const hit = bundles.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && (fresh ? age < FRESH_MS : age < ttl(hit))) return hit.err ? Promise.reject(hit.err) : Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = fetchDoc(normId(id), key, fresh && !!hit).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
    inflight.set(key, p);
  }
  return p;
}
// where someone's pin is kept: a Nookara account seen from a Nookara account keeps the pin its Nookara DM made (the user id)
const pinKeyOf = b => (/^\d+$/.test(me.id) && /^\d+$/.test(b.owner) && splitId(b.id)?.domain === splitId(mySid())?.domain ? b.owner : b.id);
async function fetchDoc(id, key, fresh) {
  const gen = () => `${epoch}:${gens.get(key) || 0}`;
  const g = gen();
  const keep = v => { if (gen() === g) bundles.set(key, v); };
  let doc;
  try { doc = await home.keys(id, { fresh }); }
  catch (e) { keep({ at: Date.now(), err: e }); throw e; }
  const bad = () => { const e = new Error('bad_key_list'); keep({ at: Date.now(), err: e }); return e; };
  let r;
  try { r = await bundleOfDoc(doc, id); } catch { throw bad(); }
  if (r.none) { const none = { at: Date.now(), none: true }; keep(none); return none; }
  if (id !== mySid()) {
    const pk = pinKeyOf(r.b), pin = await KS.getPin(me.id, pk).catch(() => null), st = pinState(pin, r.b.fp, r.b.clients.seq);
    if (st === 'older') throw bad(); // an older list than one I already saw
    if (st === 'changed') noticeSubs.forEach(f => f(id));
    await KS.putPin(me.id, pk, { fp: r.b.fp, seq: r.b.clients.seq, first: st === 'same' ? pin.first : Date.now() }).catch(() => {});
  }
  const v = { at: Date.now(), b: r.b };
  keep(v);
  return v;
}
export const forgetDoc = id => { const k = docKey(id); bundles.delete(k); inflight.delete(k); gens.set(k, (gens.get(k) || 0) + 1); };
// my own keys as a member of a DM: what my home says (my client list checked against my own key, or the home could add a reader)
async function myDocBundle({ fresh = false } = {}) {
  if (fresh || !info?.kid) await myBundle();
  const doc = info.clients || { seq: 0, list: [] };
  if (!info.has || info.kid !== keys.kid) throw new Error('e2ee_locked');
  if (doc.list?.length && !(await N.verifyClients(me.id, info.kid, doc, info.clients_sig, info.sig_pub))) throw new Error('bad_key_list');
  return { id: mySid(), owner: me.id, kid: info.kid, enc_pub: info.enc_pub, sig_pub: info.sig_pub, clients: doc, clients_sig: info.clients_sig || null, past: info.past || [], fp: await N.fingerprint(info.enc_pub, info.sig_pub) };
}
async function fetchBundle(username, key) {
  const gen = () => `${epoch}:${gens.get(key) || 0}`;
  const g = gen();
  const keep = v => { if (gen() === g) bundles.set(key, v); };
  let b;
  try { b = await apiFetch(`/im/keys/user/${encodeURIComponent(username)}`); }
  catch (e) {
    if (e.message !== 'no_keys') { keep({ at: Date.now(), err: e }); throw e; }
    const none = { at: Date.now(), none: true };
    keep(none);
    return none;
  }
  // the list of linked clients has to be signed by the key itself, or Nookara could add a reader
  const doc = b.clients || { seq: 0, list: [] };
  const bad = () => { const e = new Error('bad_key_list'); keep({ at: Date.now(), err: e }); return e; };
  if (doc.list?.length && !(await N.verifyClients(b.user_id, b.kid, doc, b.clients_sig, b.sig_pub))) throw bad();
  const fp = await N.fingerprint(b.enc_pub, b.sig_pub);
  if (String(b.user_id) !== me.id) {
    const pin = await KS.getPin(me.id, b.user_id).catch(() => null);
    if (pin && pin.seq > Number(doc.seq || 0) && pin.fp === fp) throw bad(); // an older list than one I already saw
    if (pin && pin.fp !== fp) noticeSubs.forEach(f => f(b.username));
    await KS.putPin(me.id, b.user_id, { fp, seq: Number(doc.seq || 0), first: pin?.fp === fp ? pin.first : Date.now() }).catch(() => {});
  }
  const v = { at: Date.now(), b: { ...b, fp } };
  keep(v);
  return v;
}
// (a request already on its way may carry the old keys: it's let go, the next ask fetches again)
export const forgetBundle = username => { const k = String(username).toLowerCase(); bundles.delete(k); inflight.delete(k); gens.set(k, (gens.get(k) || 0) + 1); };
const forgetAllBundles = () => { bundles.clear(); inflight.clear(); epoch++; };
// the numbers two people compare outside Nookara
// the same with someone in a homeserver DM (ids in full, unless both are accounts of the same Nookara: then as their Nookara DM shows it)
export async function safetyWithId(id) {
  const v = await docBundle(id);
  if (!v.b) return null;
  const mine = await N.fingerprint(keys.enc_pub, keys.sig_pub);
  const nk = pinKeyOf(v.b) === v.b.owner && v.b.owner !== v.b.id;
  return N.safetyCode({ uid: nk ? Number(me.id) : mySid(), fp: mine }, { uid: nk ? Number(v.b.owner) : v.b.id, fp: v.b.fp });
}
export async function safetyWith(username) {
  const v = await bundleFor(username);
  if (!v.b) return null;
  return N.safetyCode({ uid: Number(me.id), fp: await N.fingerprint(keys.enc_pub, keys.sig_pub) }, { uid: Number(v.b.user_id), fp: v.b.fp });
}

// ── sealing ──
const active = b => [{ kid: b.kid, enc_pub: b.enc_pub }, ...((b.clients?.list || []).filter(c => !c.revoked_at).map(c => ({ kid: c.kid, enc_pub: c.enc_pub })))];
// -> the envelope, or throws no_keys when they haven't set up yet. text = the message with its file links
export async function seal(username, text, { replyQuote = null, editOf = 0, fresh = false } = {}) {
  if (!keys) throw new Error('e2ee_locked');
  const to = await bundleFor(username, { fresh });
  if (to.none) throw new Error('no_keys');
  const mine = await bundleFor(me.username, { fresh });
  if (mine.none) throw new Error('e2ee_locked');
  const payload = { t: text, ...(replyQuote ? { r: replyQuote } : {}) };
  // a DM's from/to are in the message; an edit keeps them as they were
  return N.encryptMessage(payload, { from: me.id, to: to.b.user_id, recipients: [...active(to.b), ...active(mine.b)], signer: { kid: keys.kid, sigPriv: keys.sigPriv }, editOf });
}
export async function sealEdit(m, text) {
  if (!keys) throw new Error('e2ee_locked');
  const other = String(m.fromId) === me.id ? String(m.toId) : String(m.fromId);
  const peer = await bundleFor(m.peer, { fresh: true });
  if (peer.none || String(peer.b.user_id) !== other) throw new Error('no_keys');
  const mine = await bundleFor(me.username, { fresh: true });
  return N.encryptMessage({ t: text, ...(m.quote ? { r: m.quote } : {}) }, { from: m.fromId, to: m.toId, recipients: [...active(peer.b), ...active(mine.b)], signer: { kid: keys.kid, sigPriv: keys.sigPriv }, editOf: m.imId });
}

// ── homeserver DMs (v: 2): sealed to every member's keys, never sent any other way ──
// what this device remembered of who is in a DM: the host says who the members are, so a change is noticed here (homedm.js)
const MEMBERS = () => acctKey('ember_e2ee_dm_members');
const readMembers = () => { try { const v = JSON.parse(localStorage.getItem(MEMBERS()) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
export const knownMembers = id => { const ids = readMembers()[id]; return Array.isArray(ids) ? { ids } : null; };
export function rememberMembers(dm) {
  try { const all = readMembers(); all[dm.id] = HD.memberIds(dm); const ks = Object.keys(all); if (ks.length > 500) delete all[ks[0]]; localStorage.setItem(MEMBERS(), JSON.stringify(all)); } catch { /* private mode: nothing is remembered */ }
}
// who joined or left since this device last looked. -> { ids, added, removed, error? } (a two-person DM whose list changed: error)
export function membersOf(dm) {
  const sid = mySid(), known = knownMembers(dm.id);
  const c = HD.membersCheck(dm, sid || '', known);
  if (!known && !c.error) rememberMembers(dm);
  return c;
}
// everyone's keys. -> { bundles: { id: bundle }, missing: [ids of members who have not set up] }; throws when someone's keys can't be asked for
export async function bundlesForDm(dm, { fresh = false } = {}) {
  if (!keys) throw new Error('e2ee_locked');
  const sid = mySid(), bundles = {}, missing = [];
  if (!sid) throw new Error('e2ee_locked');
  await Promise.all(HD.memberIds(dm).map(async id => {
    if (id === sid) { bundles[id] = await myDocBundle({ fresh }); return; }
    const v = await docBundle(id, { fresh });
    if (v.b) bundles[id] = v.b; else missing.push(id);
  }));
  return { bundles, missing };
}
// -> the envelope. Throws no_keys (.missing = who), dm_members_changed, e2ee_locked
export async function sealDm(dm, text, { replyQuote = null, preview = null, editOf = 0, fresh = false, bundles = null } = {}) {
  if (!keys) throw new Error('e2ee_locked');
  membersOf(dm); // (the first time this device sees the DM: who is in it is remembered)
  const got = bundles || (await bundlesForDm(dm, { fresh })).bundles;
  return HD.sealDm({ dm, me: mySid(), bundles: got, signer: { kid: keys.kid, sigPriv: keys.sigPriv }, text, quote: replyQuote, preview, editOf, known: knownMembers(dm.id) });
}
// a message from a DM's host -> the same with `body` = its text and `sealed` (as openMessage below, plus v: 2, from = the
// sender's stable id, preview = the link preview it carries, key = its K for a report)
export async function openDmMessage(m, dm) {
  if (!m?.enc) return m;
  if (!keys) return { ...m, body: '', sealed: { v: 2, state: 'locked' } };
  const from = HD.senderId(m.author, dm);
  const cacheKey = `2:${dm.id}:${from}:${m.id}:${m.edited_at || 0}:${String(m.enc.ct).slice(0, 44)}`;
  let got = opened.get(cacheKey);
  if (!got) {
    got = await HD.openDm(m.enc, { dm: dm.id, from, kid: keys.kid, encPriv: keys.encPriv });
    if (got.state === 'open') {
      got.signature = await dmSig(m, dm, from);
      opened.set(cacheKey, got); if (opened.size > 5000) opened.delete(opened.keys().next().value);
    }
  }
  if (got.state !== 'open') return { ...m, body: '', sealed: { v: 2, state: got.state, from } };
  return {
    ...m, body: got.text,
    reply: m.reply ? { ...m.reply, body: m.reply.gone ? m.reply.body : (got.quote?.s ?? m.reply.body) } : m.reply,
    sealed: { v: 2, state: 'open', signature: got.signature, files: got.files, wire: got.wire, quote: got.quote, preview: got.preview, key: got.key, ts: got.ts, from },
  };
}
async function dmSig(m, dm, from) {
  const ask = async fresh => (from === mySid() ? myDocBundle({ fresh }).catch(() => null) : (await docBundle(from, { fresh }).catch(() => null))?.b || null);
  const check = b => HD.signatureOf(m.enc, b, { dm: dm.id, from, id: m.id, edited: !!m.edited_at });
  const r = await check(await ask(false));
  if (r === 'valid') return r;
  // signed by a key my copy doesn't have: they may have linked a client or set up again since. One fresh ask a minute per person
  const k = docKey(from);
  if (!sigRetry.has(k)) sigRetry.set(k, ask(true).finally(() => { const t = setTimeout(() => sigRetry.delete(k), SIG_RETRY_MS); t?.unref?.(); }));
  const again = await sigRetry.get(k);
  return again ? check(again) : r;
}

// ── opening ──
const LINK_LINE = /^https?:\/\/\S+#nke=\S+$/;
const opened = new Map(); // `${id}:${ct head}` -> what came out (a message's contents never change under the same ciphertext)
// a message from the server -> the same message with `body` = its text and `sealed` saying how it went:
//   { state: 'open' | 'locked' | 'failed', signature: 'valid' | 'invalid' | 'none' | 'unknown', converted, files: [file links] }
//   no `enc` at all = it was never encrypted (a call line, or an old DM from before)
export async function openMessage(m) {
  if (!m?.enc) return m;
  if (!keys) return { ...m, body: '', sealed: { state: 'locked' } };
  const cacheKey = `${m.id}:${String(m.enc.ct).slice(0, 44)}`;
  let got = opened.get(cacheKey);
  if (!got) {
    try {
      const k = await N.messageKey(m.enc, keys.kid, keys.encPriv);
      if (!k) got = { state: 'failed' };
      else {
        const p = await N.openWithKey(m.enc, k, { from: m.from_id, to: m.to_id });
        const lines = String(p.t ?? '').split('\n');
        const files = lines.filter(l => LINK_LINE.test(l.trim())).map(l => l.trim());
        const text = lines.filter(l => !LINK_LINE.test(l.trim())).join('\n').trimEnd();
        got = { state: 'open', text, wire: String(p.t ?? ''), files, quote: p.r || null, signature: await checkSig(m) };
      }
    } catch { got = { state: 'failed' }; }
    if (got.state === 'open') { opened.set(cacheKey, got); if (opened.size > 5000) opened.delete(opened.keys().next().value); }
  }
  if (got.state !== 'open') return { ...m, body: '', sealed: { state: got.state } };
  return {
    ...m, body: got.text,
    reply: m.reply ? { ...m.reply, body: m.reply.gone ? m.reply.body : (got.quote?.s ?? m.reply.body) } : m.reply,
    sealed: { state: 'open', signature: m.enc.converted ? 'none' : got.signature, converted: !!m.enc.converted, files: got.files, wire: got.wire, quote: got.quote },
  };
}
async function checkSig(m) {
  const enc = m.enc;
  if (!enc.sig) return 'none';
  const sender = String(m.from_id) === me.id ? me.username : m.from;
  const v = await bundleFor(sender).catch(() => null);
  if (!v?.b) return 'unknown';
  const r = await sigWith(v.b, m);
  // signed by a key my copy doesn't have, or it doesn't match: they may have linked a client or set up again since. Ask once more,
  // at most once a minute per person (every message of a conversation lands here at once, they share the one request)
  if (r !== 'valid' && Date.now() - v.at > SIG_RETRY_MS) {
    if (!sigRetry.has(String(sender).toLowerCase())) sigRetry.set(String(sender).toLowerCase(), bundleFor(sender, { fresh: true }).catch(() => null).finally(() => setTimeout(() => sigRetry.delete(String(sender).toLowerCase()), SIG_RETRY_MS)));
    const again = await sigRetry.get(String(sender).toLowerCase());
    if (again?.b) return sigWith(again.b, m);
  }
  return r;
}
const SIG_RETRY_MS = 60 * 1000;
const sigRetry = new Map(); // username (lower) -> the one fresh ask after a signature didn't check out
async function sigWith(b, m) {
  const enc = m.enc;
  const key = b.kid === enc.signer ? b.sig_pub : (b.clients?.list || []).find(c => c.kid === enc.signer)?.sig_pub || (b.past || []).find(p => p.kid === enc.signer)?.sig_pub;
  if (!key) return 'unknown';
  return (await N.verifyMessage(enc, key, { from: m.from_id, to: m.to_id, editOf: m.edited_at ? m.id : 0 })) ? 'valid' : 'invalid';
}

// ── files ──
export async function sealFile(file) {
  const { data, key, iv } = await N.encryptFile(await file.arrayBuffer());
  return { upload: new File([data], 'file.bin', { type: 'application/octet-stream' }), key, iv };
}
export const fileLink = N.fileLink;
export const parseFileLink = N.parseFileLink;
const blobs = new Map(); // link -> promise of an object URL
const myHost = u => { try { const x = new URL(u); return /^\/(t|uploads)\//.test(x.pathname) && /(^|\.)nookara\.cc$|ikelene\.net$|^127\.0\.0\.1$|^localhost$/.test(x.hostname) && x.hostname !== 'cdn.nookara.cc' ? location.origin + x.pathname : u; } catch { return u; } };
// a file link -> an object URL of the opened file. Rejects 'gone' when the file isn't there any more.
// max: opening by itself (bytes): a bigger file stops before downloading and rejects with too_big (err.size = its size)
export function openFile(link, { max = 0 } = {}) {
  let p = blobs.get(link);
  if (p) return p;
  const f = N.parseFileLink(link);
  if (!f) return Promise.reject(new Error('bad_link'));
  const ctl = new AbortController();
  p = (async () => {
    const r = await fetch(myHost(f.url), { credentials: 'omit', signal: ctl.signal });
    if (r.status === 404 || r.status === 410) throw new Error('gone');
    if (!r.ok) throw new Error('fetch_failed');
    const size = Number(r.headers.get('content-length')) || 0;
    if (max && size > max) { ctl.abort(); throw Object.assign(new Error('too_big'), { size }); }
    const plain = await N.decryptFile(await r.arrayBuffer(), f.key, f.iv);
    return URL.createObjectURL(new Blob([plain], { type: mimeOf(f.mime, f.name) }));
  })();
  blobs.set(link, p);
  p.catch(() => blobs.delete(link));
  return p;
}

// ── reports ──
// the window Nookara says a report covers -> { <mail id>: key } for each message this device can open. Only these keys ever leave it.
export async function revealWindow(messages) {
  if (!keys) throw new Error('e2ee_locked');
  const out = {};
  for (const m of messages) {
    const k = await N.messageKey(m.enc, keys.kid, keys.encPriv);
    if (k) out[String(m.id)] = N.b64(k);
  }
  return out;
}

// ── held messages: nobody to encrypt them to yet ──
let sender = null; // (store.js) sends one for real
export const setOutboxSender = fn => { sender = fn; };
export const hold = v => KS.outboxPut(v);
// messages of homeserver DMs waiting for a member to set up carry `dm` (and `me`, whose they are): store.js sends those
let dmFlush = null;
export const setDmOutboxSender = fn => { dmFlush = fn; };
export const held = () => KS.outboxAll().catch(() => []);
export const release = nonce => KS.outboxDrop(nonce).catch(() => {});
// Nookara only tells someone about new keys if they've already talked (it can't know who's holding a message for a stranger, and shouldn't), so while anything is held, keep asking.
setInterval(() => { if (keys) flushOutbox(); }, 20000);
let flushing = false;
export async function flushOutbox(onlyFor = null) {
  if (flushing || !keys || !sender) return;
  flushing = true;
  try {
    const all = await held();
    if (!onlyFor && dmFlush && all.some(h => h.dm)) await dmFlush(all.filter(h => h.dm)).catch(() => {});
    for (const h of all) {
      if (h.dm) continue;
      if (onlyFor && String(h.to).toLowerCase() !== String(onlyFor).toLowerCase()) continue;
      await sender(h); // (held from before: it goes now, encrypted or, if they still haven't set up, not)
    }
  } finally { flushing = false; }
}
