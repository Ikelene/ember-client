// Which homeserver things are on, shown the way Matrix clients do: a server says the homeserver it lives on, and
// someone from another homeserver than the server's carries that homeserver's name next to theirs.
import { Globe } from 'lucide-react';
import { useChat, nookaraDomain } from './store.js';
import { isInst, instOf } from './ids.js';
import { homeDomainOf } from './homeservers.js';

// the domain part of a name: 'carol@b.test' -> 'b.test' ('' for a plain name)
export const domainOfName = name => { const s = String(name || ''); const at = s.lastIndexOf('@'); return at > 0 ? s.slice(at + 1).toLowerCase() : ''; };
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
// next to someone's name on a server: their homeserver, when it isn't the server's own
export function ForeignChip({ sid, username }) {
  const home = useServerHome(sid);
  const d = domainOfName(username);
  if (!d || !home || d === home) return null;
  return <HomeChip domain={d} icon={false} className="sm" title={`From another homeserver: ${username}`} />;
}
