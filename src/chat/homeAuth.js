// The session a server gets while Ember runs on a v2 homeserver session (social.js tokenSource): the home homeserver takes
// the home session's own access token, every other homeserver a session traded for a token home signs (PROTOCOL 4b).
// instances.js asks here when it connects and again after a 401.
// A Nookara session (legacy) keeps its own path - the instance token, or the server's own login - except on a v2 homeserver
// that lets other homeservers' accounts in: there Nookara signs the token ('nookara') and the trade is the same.
import { tokenSource, remoteUrlOf, sessionTag, nookaraTag } from './social.js';
import { currentOrigin, getSession, refresh, remoteSignIn, remoteExchange } from './homeserver.js';

// -> 'legacy' | 'home' | 'remote' | 'nookara'. ownLogin: signed in there with one of its own accounts already
export const sourceFor = (origin, info, legacy, ownLogin = false) => tokenSource({ legacy, home: currentOrigin(), origin, info, ownLogin });
// the tag sessions stored for this origin must carry to be used (null on the legacy path, which has its own)
export const tagFor = (origin, info, legacy, nookaraKey) => { const source = sourceFor(origin, info, legacy); return source === 'nookara' ? nookaraTag(nookaraKey) : sessionTag(source, getSession(currentOrigin())?.account); };
// A Nookara session on another homeserver: ask(audience) gets the token from Nookara (POST /api/v2/auth/remote-token with the
// Nookara token), the homeserver trades it for a session. One trip at a time per homeserver.
const trading = (globalThis.__emberNookaraTrade ||= new Map()); // (survives the module being evaluated again, like remoteSignIn's)
const tradeBusy = (globalThis.__emberNookaraBusy ||= new Map());
export function nookaraSignIn(origin, remoteUrl, ask) {
  const wait = (tradeBusy.get(origin) || 0) - Date.now();
  if (wait > 0) return Promise.reject(Object.assign(new Error('homeserver_rate_limited'), { code: 'homeserver_rate_limited', status: 429, retry_after: Math.ceil(wait / 1000) }));
  if (!trading.has(origin)) {
    trading.set(origin, (async () => remoteExchange(origin, await ask(origin), remoteUrl))()
      .catch(e => { if (e?.retry_after) tradeBusy.set(origin, Date.now() + e.retry_after * 1000); throw e; })
      .finally(() => trading.delete(origin)));
  }
  return trading.get(origin);
}
// -> { source, session (the token the server takes), account, tag }. renew: the one we had was refused (401) - home's is
// refreshed, another homeserver's is traded for again. Throws HomeserverError (signed_out when the home session is over).
// nookara: { token: audience => the jwt Nookara signs, key: what the stored session is tagged with }
export async function openSession(origin, info, { legacy = false, renew = false, ownLogin = false, nookara = null } = {}) {
  const source = sourceFor(origin, info, legacy, ownLogin);
  if (source === 'legacy') return null;
  if (source === 'nookara') {
    if (typeof nookara?.token !== 'function') throw Object.assign(new Error('signed_out'), { code: 'signed_out', status: 401 });
    const r = await nookaraSignIn(origin, remoteUrlOf(origin, info), nookara.token);
    return { source, session: r.access_token, account: r.account, tag: nookaraTag(nookara.key) };
  }
  const home = currentOrigin();
  const tag = tagFor(origin, info, legacy);
  if (source === 'home') {
    const s = renew ? await refresh(home) : getSession(home);
    return { source, session: s.access_token, account: s.account, tag };
  }
  const r = await remoteSignIn(origin, { origin: home, remoteUrl: remoteUrlOf(origin, info) });
  return { source, session: r.access_token, account: r.account, tag };
}
