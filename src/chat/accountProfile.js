// Your account profile on an Ember server that has its own accounts (ember-server PROTOCOL 4.1): reading and saving it there,
// copying your Nookara profile over, and keeping the copy in sync. The server never talks to Nookara for this: this client reads the
// Nookara profile and writes the server one, and the server only remembers which Nookara account the profile follows and the stamp
// of the last copy (so every device knows whether there is anything new to bring over).
import { apiFetch, uploadFetch, getToken } from '../api.js';
import { NOOKARA_ORIGIN } from './hosts.js';
import { getState, lookup, forgetProfile, accountProfileSaved } from './store.js';
import { setInstanceUser, instanceConn } from './instances.js';
import { LIMITS, copyFields, stampOf, stampParts, joinStamp, changedParts, follows, pictureSources, hasAccountProfile } from './accountProfileCore.js';
import { NOOKARA_ID_FIELD } from '../compat.js';

const PATH = '/api/v1/me/profile';
const took = (origin, r) => { if (r?.user) { setInstanceUser(origin, r.user); accountProfileSaved(origin); } return r; };

export const getAccountProfile = origin => apiFetch(PATH, { inst: origin });
export const saveAccountProfile = (origin, patch) => apiFetch(PATH, { inst: origin, method: 'PATCH', body: JSON.stringify(patch) }).then(r => took(origin, r));
// blob = null takes the picture away
export function setAccountPicture(origin, kind, blob, name = `${kind}.png`) {
  if (!blob) return apiFetch(`${PATH}/${kind}`, { inst: origin, method: 'DELETE' }).then(r => took(origin, r));
  const fd = new FormData();
  fd.append('file', blob, name);
  return uploadFetch(`${PATH}/${kind}`, fd, { inst: origin }).then(r => took(origin, r));
}

// my Nookara profile, read fresh
async function nookaraProfile() {
  const name = getState().me?.username;
  if (!name || !getToken()) throw new Error('signed_out');
  forgetProfile(name);
  const g = await lookup(name);
  if (!g?.username) throw new Error('signed_out');
  return g;
}
// a Nookara picture as bytes (the server keeps its own copy). -> Blob | 'too_big' | null (couldn't be read: try again later)
async function readPicture(url) {
  for (const src of pictureSources(url, NOOKARA_ORIGIN)) {
    try {
      const r = await fetch(src, { credentials: 'omit' });
      if (!r.ok) continue;
      const b = await r.blob();
      if (!b.size || !/^image\//.test(b.type || 'image/')) continue;
      return b.size > LIMITS.picture ? 'too_big' : b;
    } catch { /* next source */ }
  }
  return null;
}

// Copy my Nookara profile to the server. sync: true = and keep following it, false = stop following, undefined = leave that as it is.
// before: the stamp the server holds, to bring over only what changed ('' = everything). profile: my Nookara profile, when just read.
// -> the server's answer plus { skipped: ['pfp' | 'banner'] } (pictures that couldn't be copied)
export async function copyFromNookara(origin, { sync, before = '', profile } = {}) {
  const g = profile || await nookaraProfile();
  const now = await stampOf(g), want = changedParts(before, now);
  const held = stampParts(before), next = { ...stampParts(now) };
  let r = null;
  const skipped = [];
  if (want.text) r = await saveAccountProfile(origin, copyFields(g));
  for (const kind of ['pfp', 'banner']) {
    if (!want[kind]) continue;
    const url = g[`${kind}_url`];
    if (!url) { r = await setAccountPicture(origin, kind, null); continue; }
    const blob = await readPicture(url);
    if (blob && blob !== 'too_big') { r = await setAccountPicture(origin, kind, blob, `${kind}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`); continue; }
    skipped.push(kind);
    if (!blob) next[kind === 'pfp' ? 'p' : 'b'] = held[kind === 'pfp' ? 'p' : 'b']; // not read this time: the stamp stays behind, so the next sync tries again
  }
  if (sync !== undefined) r = await saveAccountProfile(origin, { sync: sync ? { [NOOKARA_ID_FIELD]: String(g.id), stamp: joinStamp(next) } : null });
  if (!r) r = await getAccountProfile(origin);
  return { ...r, skipped };
}

// Follow-up for servers whose profile follows my Nookara one: bring over what changed since the last copy. Called when a server
// connects and when Nookara says my profile changed. Quiet: a server that is offline or refuses just waits for the next time.
const running = new Map(); // origin -> promise
export function syncAccountProfile(origin) {
  if (running.has(origin)) return running.get(origin);
  const p = (async () => {
    const c = instanceConn(origin);
    if (!getToken() || !getState().me || c?.info?.accounts_mode !== 'local' || !c.info.features?.account_profiles || c.user?.kind !== 'local') return false;
    const cur = await getAccountProfile(origin);
    if (!cur.sync) return false;
    const g = await nookaraProfile();
    if (!follows(cur.sync, g.id) || (await stampOf(g)) === cur.sync.stamp) return false;
    await copyFromNookara(origin, { sync: true, before: cur.sync.stamp, profile: g });
    dispatchEvent(new CustomEvent('vc-account-profile-synced', { detail: { origin } })); // (an open editor shows the new copy)
    return true;
  })().catch(() => false).finally(() => running.delete(origin));
  running.set(origin, p);
  return p;
}
// Nookara says my profile changed: every connected server that could be following it checks
export function syncAllAccountProfiles() {
  for (const i of getState().instances || []) if (hasAccountProfile(i) && i.status === 'open') syncAccountProfile(i.origin);
}
