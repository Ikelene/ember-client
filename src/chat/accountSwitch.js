// Every account signed in on this device, Nookara's and the homeservers' (the profile menu's switcher and Settings > Accounts):
// one list of user@domain, and switching between them. The app runs as one at a time: the Nookara sign-in when its token is
// there, else the homeserver session marked current (Chat.jsx boot). Switching keeps the others signed in.
import { getToken } from '../api.js';
import { savedEmberAccounts, rememberAccount, switchEmberAccount } from './session.js';
import { allSessions, currentOrigin, setCurrent, DEFAULT_HOMESERVER } from './homeserver.js';
import { clientUrl } from './hosts.js';

// -> [{ key, kind: 'nookara' | 'home', handle, name, domain, pfp, current, origin?, saved? }]
export function deviceAccounts(nookaraUser = null, { nookaraDomain = DEFAULT_HOMESERVER } = {}) {
  const nk = !!getToken(), cur = nk ? null : currentOrigin();
  const out = [];
  const seen = new Set();
  if (nk && nookaraUser?.username) { out.push({ key: `nk:${nookaraUser.username.toLowerCase()}`, kind: 'nookara', handle: `${nookaraUser.username}@${nookaraDomain}`, name: nookaraUser.display_name || nookaraUser.username, domain: nookaraDomain, pfp: nookaraUser.pfp || null, current: true }); seen.add(nookaraUser.username.toLowerCase()); }
  for (const a of savedEmberAccounts()) {
    const k = a.username.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `nk:${k}`, kind: 'nookara', handle: `${a.username}@${nookaraDomain}`, name: a.username, domain: nookaraDomain, pfp: a.pfp || null, current: false, saved: a });
  }
  for (const s of allSessions()) { // (each account, several per homeserver too)
    if (!s?.account) continue;
    out.push({ key: `hs:${s.key}`, kind: 'home', handle: s.account.handle, name: s.account.display_name || s.account.username, domain: s.domain, pfp: s.account.avatar_url || null, icon: s.icon_url || null, hsName: s.name || s.domain, current: s.origin === cur && s.active, origin: s.origin, hsKey: s.key });
  }
  return out;
}

// switch to one: a Nookara account (its saved token), or a homeserver session (the Nookara token, if any, is kept in the saved
// list first so switching back needs no sign-in). Reloads. -> throws Error('ended' | 'unreachable') for a Nookara one that failed
export async function switchToAccount(a, current = null) {
  if (a.kind === 'nookara') return switchEmberAccount(a.saved);
  if (getToken() && current?.kind === 'nookara') {
    try { rememberAccount(localStorage.getItem('ember_user') || current.handle.split('@')[0], getToken(), current.pfp); } catch { /* fine */ }
  }
  setCurrent(a.origin, a.hsKey || null);
  try { localStorage.removeItem('ember_token'); localStorage.removeItem('ember_user'); localStorage.removeItem('ember_me_cache_v2'); } catch { /* private mode */ }
  history.replaceState(null, '', clientUrl('#/home'));
  location.reload();
  return undefined;
}
