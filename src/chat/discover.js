import { Globe, Bot } from 'lucide-react';
import { normOrigin, K } from './ids.js';
import { joinByAddress, joinAndOpen } from './instances.js';
import { go } from './store.js';

// While Discovery is open the sidebar lists its sections (Servers, Bots) instead of the last server's channels (Ikelene
// 2026-11-16); Chat.jsx keeps which one is open, so the sidebar and the tabs under the header stay in step.
export const DISCOVER_TABS = [['servers', 'Servers', Globe], ['bots', 'Bots', Bot]];

// a server on a homeserver with many: I'm in it when its own key is in my list; an older one is its whole address
const listedSid = r => { const url = normOrigin(r.url); return url && r.sid ? K(url, r.sid) : null; };

// (a quiet connection is only there for my account or a DM on that homeserver: in a server there only when one is in my list)
const inList = (mine, url, servers = []) => mine.some(i => i.origin === url && (!i.quiet || servers.some(s => s.inst === url)));

export const isListedAdded = (r, servers, mine) => (listedSid(r) ? servers.some(s => s.sid === listedSid(r)) : inList(mine, normOrigin(r.url), servers));

// a directory listing was picked: open it when I'm in it, otherwise join (the Add a server dialog only when it has to ask).
// -> Promise<true when it opened or joined>
export async function pickListed(r, servers, mine) {
  const url = normOrigin(r.url);
  if (!url) return r.address ? joinByAddress(r.address) : false;
  if (listedSid(r)) {
    if (isListedAdded(r, servers, mine)) { go({ kind: 'server', sid: listedSid(r) }); return true; }
    return joinAndOpen(url, undefined, r.sid);
  }
  if (inList(mine, url, servers)) { go({ kind: 'instance', inst: url }); return true; }
  return joinAndOpen(url);
}
