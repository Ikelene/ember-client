// Homeservers Nookara has verified (GET <Nookara>/ember/homeservers/verified -> { homeservers: [{ domain, name, verified_at }] }):
// a small check next to their name or domain wherever a homeserver shows. Asked once per page (kept a day on this device);
// anything wrong and there are simply no checks.
import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { NOOKARA_ORIGIN } from './hosts.js';

const KEY = 'ember_verified_homes';
const DAY = 864e5;
const norm = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
export const verifiedSet = list => new Set((Array.isArray(list) ? list : []).map(h => norm(h?.domain)).filter(Boolean));

let set = null;
try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.at < DAY) set = verifiedSet(c.list); } catch { /* none */ }
let asked = null;
const listeners = new Set();
function load() {
  if (asked) return asked;
  const get = url => fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : Promise.reject(new Error('no'))));
  asked = get('/ember/homeservers/verified').catch(() => get(`${NOOKARA_ORIGIN}/ember/homeservers/verified`))
    .then(d => {
      if (!Array.isArray(d?.homeservers)) return;
      set = verifiedSet(d.homeservers);
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list: d.homeservers.map(h => ({ domain: h.domain })) })); } catch { /* fine */ }
      listeners.forEach(f => f());
    }).catch(() => {});
  return asked;
}
export const isVerifiedHome = domain => !!set && set.has(norm(domain));
export function useVerifiedHome(domain) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(x => x + 1); listeners.add(f); load(); return () => listeners.delete(f); }, []);
  return isVerifiedHome(domain);
}
// the check itself (domain: the homeserver's domain, or a URL on it)
// (on: already known to be verified, e.g. a Discovery group's own `verified`)
export function HsVerified({ domain, size = 12, on = false }) {
  const ok = useVerifiedHome(domain) || on;
  if (!ok) return null;
  return <span className="vc-hs-ver" data-tip="Verified by Nookara" title="Verified by Nookara" aria-label="Verified by Nookara"><BadgeCheck size={size} /></span>;
}
