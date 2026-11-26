// The session a server gets while Ember runs on a v2 homeserver session (social.js tokenSource): the home homeserver takes
// the home session's own access token, every other homeserver a session traded for a token home signs (PROTOCOL 4b).
// instances.js asks here when it connects and again after a 401; the Nookara sign-in never comes through this file.
import { tokenSource, remoteUrlOf, sessionTag } from './social.js';
import { currentOrigin, getSession, refresh, remoteSignIn } from './homeserver.js';

// -> 'legacy' | 'home' | 'remote'
export const sourceFor = (origin, info, legacy) => tokenSource({ legacy, home: currentOrigin(), origin, info });
// the tag sessions stored for this origin must carry to be used (null on the legacy path, which has its own)
export const tagFor = (origin, info, legacy) => sessionTag(sourceFor(origin, info, legacy), getSession(currentOrigin())?.account);
// -> { source, session (the token the server takes), account, tag }. renew: the one we had was refused (401) - home's is
// refreshed, another homeserver's is traded for again. Throws HomeserverError (signed_out when the home session is over).
export async function openSession(origin, info, { legacy = false, renew = false } = {}) {
  const source = sourceFor(origin, info, legacy);
  if (source === 'legacy') return null;
  const home = currentOrigin();
  const tag = tagFor(origin, info, legacy);
  if (source === 'home') {
    const s = renew ? await refresh(home) : getSession(home);
    return { source, session: s.access_token, account: s.account, tag };
  }
  const r = await remoteSignIn(origin, { origin: home, remoteUrl: remoteUrlOf(origin, info) });
  return { source, session: r.access_token, account: r.account, tag };
}
