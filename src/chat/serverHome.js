import { isInst, instOf } from './ids.js';
import { nookaraDomain, useChat } from './store.js';
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
