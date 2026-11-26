// The social API of the home homeserver (PROTOCOL 4c): friends, DMs, profiles. Its base comes from the homeserver's discovery
// (social.api_url): for nookara.cc accounts that is Nookara itself, not the homeserver the session is on. Requests carry the
// home session's token (homeFetch: only to the homeserver's origin or its domain's).
// Pure like homeserver.js: nothing from the browser but what homeserver.js is configured with.
import { homeFetch, homeInfo, currentOrigin, isOwnUrl, HomeserverError } from './homeserver.js';

const moved = new Map(); // home origin -> the api_url a 409 social_elsewhere named (until the page reloads)
export const resetSocialApi = () => moved.clear();
const clean = u => String(u || '').replace(/\/+$/, '');
export async function socialBase(origin = currentOrigin()) {
  return moved.get(origin) || (await homeInfo(origin)).api_url;
}
const enc = id => encodeURIComponent(String(id));

async function send(url, { origin, method = 'GET', body }) {
  let res;
  try { res = await homeFetch(url, { origin, method, credentials: 'omit', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch (e) { if (e instanceof HomeserverError) throw Object.assign(new Error(e.code), { status: e.status ?? 0, code: e.code }); throw Object.assign(new Error('unreachable'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  return { res, data: data && typeof data === 'object' ? data : {} };
}
const failed = (res, data) => Object.assign(new Error(typeof data.error === 'string' && data.error ? data.error : 'request_failed'), data, { status: res.status, error: data.error });

// one call: path is under the base ('/social/friends', '/users/lookup?handle=..'). -> the JSON answer; throws Error(code) with
// .status and the answer's fields. 409 social_elsewhere { api_url }: this account's friends and DMs live there, so the call
// goes there (once) and so does every later one
export async function socialFetch(path, { method = 'GET', body, origin = currentOrigin() } = {}) {
  const base = await socialBase(origin);
  let { res, data } = await send(`${base}${path}`, { origin, method, body });
  if (res.status === 409 && data.error === 'social_elsewhere' && typeof data.api_url === 'string') {
    const next = clean(data.api_url);
    if (next === base || !isOwnUrl(next, origin)) throw failed(res, data); // (somewhere that isn't this homeserver's: the token stays here)
    moved.set(origin, next);
    ({ res, data } = await send(`${next}${path}`, { origin, method, body }));
  }
  if (!res.ok) throw failed(res, data);
  return data;
}

export const social = {
  friends: o => socialFetch('/social/friends', o),
  addFriend: (who, message, o) => socialFetch('/social/friends', { ...o, method: 'POST', body: { ...(who.id ? { id: who.id } : { handle: who.handle }), ...(message ? { message } : {}) } }),
  accept: (id, o) => socialFetch(`/social/friends/${enc(id)}/accept`, { ...o, method: 'POST' }),
  removeFriend: (id, o) => socialFetch(`/social/friends/${enc(id)}`, { ...o, method: 'DELETE' }),
  block: (id, o) => socialFetch(`/social/blocks/${enc(id)}`, { ...o, method: 'POST' }),
  unblock: (id, o) => socialFetch(`/social/blocks/${enc(id)}`, { ...o, method: 'DELETE' }),
  dms: o => socialFetch('/social/dms', o),
  dm: (id, o) => socialFetch(`/social/dms/${enc(id)}`, o),
  readDm: (id, o) => socialFetch(`/social/dms/${enc(id)}/read`, { ...o, method: 'POST' }),
  leaveDm: (id, o) => socialFetch(`/social/dms/${enc(id)}/leave`, { ...o, method: 'POST' }),
  profile: (id, o) => socialFetch(`/social/profile/${enc(id)}`, o),
  lookup: (handle, o) => socialFetch(`/users/lookup?handle=${enc(handle)}`, o),
};

// start a DM or a group: { members: [handle], member_ids?, name?, group? } -> { dm, created }.
// 409 create_on_homeserver { url }: this one has people from other homeservers in it, so it is made on the homeserver the
// session is on: the same POST goes to that url (once), and the DM then shows in the list as a pointer
export async function createDm(body, { origin = currentOrigin() } = {}) {
  try { return await socialFetch('/social/dms', { method: 'POST', body, origin }); } catch (e) {
    if (e.status !== 409 || e.error !== 'create_on_homeserver' || typeof e.url !== 'string' || !isOwnUrl(e.url, origin)) throw e;
    const { res, data } = await send(e.url, { origin, method: 'POST', body });
    if (!res.ok) throw failed(res, data);
    return data;
  }
}
