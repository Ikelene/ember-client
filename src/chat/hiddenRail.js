// Servers hidden from the rail ("Hide from list" on a server's right-click menu): only the rail entry goes; I stay in the
// server, its homeserver stays connected, and a link or notification still opens it. Kept per account on this device
// (Nookara's chat settings have no key for it yet). Settings > Homeservers shows them again.
import { useSyncExternalStore } from 'react';
import { acctKey } from './ids.js';

const KEY = 'ember_hidden_servers';
const subs = new Set();
let cache = null, cacheKey = null;
function read() {
  const k = acctKey(KEY);
  if (cache && cacheKey === k) return cache;
  let list = [];
  try { const v = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(v)) list = v.filter(x => typeof x === 'string').slice(0, 500); } catch { /* none */ }
  cache = new Set(list); cacheKey = k;
  return cache;
}
function write(set) {
  cache = new Set(set); cacheKey = acctKey(KEY);
  try { localStorage.setItem(cacheKey, JSON.stringify([...cache])); } catch { /* private mode: this page only */ }
  subs.forEach(f => f());
}
export const hiddenServers = () => read();
export const isHidden = sid => read().has(sid);
export const hideServer = sid => { const s = new Set(read()); s.add(sid); write(s); };
export const showServers = sids => { const s = new Set(read()); for (const x of sids) s.delete(x); write(s); };
const subscribe = f => { subs.add(f); const st = e => { if (!e.key || e.key.startsWith(KEY)) { cache = null; f(); } }; addEventListener('storage', st); return () => { subs.delete(f); removeEventListener('storage', st); }; };
export const useHiddenServers = () => useSyncExternalStore(subscribe, read);
