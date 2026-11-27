import { normOrigin } from './ids.js';
import { currentOrigin, currentSession } from './homeserver.js';
import { getToken } from '../api.js';
import { hostOf } from './instances.js';
import { useChat } from './store.js';

// the homeservers a server can be made on: [{ origin, domain, name, icon, count, listed }]
export function createHosts(instances) {
  const out = (instances || []).filter(i => i.v2).map(i => ({
    origin: i.origin, domain: i.homeserver?.domain || i.host, name: i.homeserver?.name || i.name, icon: i.homeserver?.icon_url || i.icon || null, listed: true,
  }));
  let home = null;
  // (only while the app runs as that homeserver account: signed in with Nookara, a saved homeserver session isn't "yours" here)
  try { const o = normOrigin(currentOrigin()), s = currentSession(); if (o && s && !getToken()) home = { origin: o, domain: s.account?.domain || hostOf(o), name: s.account?.domain || hostOf(o), icon: null, listed: false, home: true }; } catch { /* no homeserver sign-in */ }
  if (home) { const at = out.find(h => h.origin === home.origin); if (at) at.home = true; else out.unshift(home); }
  return out;
}

export const useCreateHosts = () => createHosts(useChat(s => s.instances));
