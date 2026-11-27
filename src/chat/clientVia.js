import { useState, useEffect } from 'react';
import { onApps, appInfo } from './appClients.js';
import { useChat } from './store.js';
import { parseK } from './ids.js';
import { onInstClients, watchInstClients, instClientsOf } from './instClients.js';

// the official clients list (null until it's known), re-rendering when it arrives
// re-render when an App's registry entry arrives; returns the lookup describeVia takes
export function useApps() {
  const [, bump] = useState(0);
  useEffect(() => onApps(() => bump(n => n + 1)), []);
  return appInfo;
}

// The clients an Ember server says this member is connected with (instClients.js), while the card is open. `who` = the member
// as that server knows them ({ inst, id }), `sid` = the server the card was opened in. Only asked when the server would answer:
// it is me there, or I hold Manage users in that server (the server checks again; anyone else gets nothing).
// -> undefined (nothing / not asked) | null (not allowed) | { online, sessions, last_online }
const MANAGE_USERS = 2048;

export function useInstClients(who, sid) {
  const inst = who?.inst || null, uid = who?.id != null ? String(who.id) : null;
  const server = useChat(s => {
    if (!inst || uid == null) return null;
    const here = sid && parseK(sid).inst === inst ? sid : s.servers.find(x => x.inst === inst)?.sid; // (one community per server, usually)
    if (!here) return null;
    const mine = s.instances?.find(i => i?.origin === inst)?.user?.id;
    const perms = Number(s.detail[here]?.server?.perms ?? s.servers.find(x => x.sid === here)?.perms) || 0;
    return String(mine) === uid || (perms & MANAGE_USERS) === MANAGE_USERS ? parseK(here).id : null;
  });
  const [, bump] = useState(0);
  useEffect(() => onInstClients(() => bump(n => n + 1)), []);
  useEffect(() => (server ? watchInstClients(inst, server, uid) : undefined), [inst, server, uid]);
  return server ? instClientsOf(inst, uid) : undefined;
}
