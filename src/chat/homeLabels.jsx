// Which homeserver a server is on (its header, the rail, Discovery and invites). People don't carry a homeserver label in
// lists: their profile shows their full @username@domain.
import { Globe } from 'lucide-react';
import { useChat, nookaraDomain } from './store.js';
import { isInst, instOf } from './ids.js';
import { homeDomainOf } from './homeservers.js';

// the homeserver a server lives on (a server Nookara hosts itself: Nookara's own domain)
export function serverHomeOf(st, sid) {
  if (!sid) return '';
  if (!isInst(sid)) return nookaraDomain();
  const origin = instOf(sid);
  const inst = st.instances.find(i => i.origin === origin);
  const srv = st.servers.find(x => x.sid === sid) || st.detail[sid]?.server;
  return String(homeDomainOf(inst, srv) || '').toLowerCase();
}
export const useServerHome = sid => useChat(s => serverHomeOf(s, sid));

// a small label with a homeserver's domain
export function HomeChip({ domain, title, icon = true, className = '' }) {
  if (!domain) return null;
  return <span className={`vc-hs-chip ${className}`} title={title || `On the homeserver ${domain}`}>{icon && <Globe size={10} aria-hidden="true" />}{domain}</span>;
}
