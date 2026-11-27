import { useSyncExternalStore } from 'react';
import { sessions, allSessions, subscribe, SESSIONS_KEY, CURRENT_KEY, ACTIVE_KEY, currentSession } from './homeserver.js';

// the v2 homeserver session in use (null = none), kept current across tabs
let snapRaw = null, snapVal = null;

function snapshot() {
  let raw = '';
  try { raw = `${localStorage.getItem(SESSIONS_KEY) || ''}|${localStorage.getItem(CURRENT_KEY) || ''}|${localStorage.getItem(ACTIVE_KEY) || ''}`; } catch { /* blocked */ }
  if (raw !== snapRaw) { snapRaw = raw; snapVal = currentSession(); }
  return snapVal;
}

function watch(fn) {
  const off = subscribe(fn);
  addEventListener('storage', fn);
  return () => { off(); removeEventListener('storage', fn); };
}

export const useHomeSession = () => useSyncExternalStore(watch, snapshot);

// every homeserver signed in on this device
export function useHomeSessions() { useHomeSession(); return Object.values(sessions()); }
// every homeserver account on this device (several can share a homeserver): [{ ...session, key, active }]
export function useAllHomeSessions() { useHomeSession(); return allSessions(); }

export const RESOLVE_TEXT = (code, domain) => ({
  invalid: 'Enter a homeserver like example.org, or your full name like alice@example.org.',
  not_found: `No homeserver found at ${domain}.`,
  legacy: `${domain} isn't an Ember homeserver you can sign in to.`,
  not_homeserver: `${domain} isn't an Ember homeserver you can sign in to.`,
  unreachable: `Couldn't reach ${domain}. Check the address and your connection.`,
}[code] || `${domain} has a homeserver setup Ember can't use.`);
