// the starboard: the star emoji, a server's starboard settings and whether you starred a message (Starboard.jsx)
import { useChat } from './store.js';
import { useMemo } from 'react';
import { isInst, bare } from './ids.js';

export const STAR = '⭐';

// the star button in a message's quick actions: only where a starboard is watching that channel
export function useStarboardFor(sid, cid) {
  const chans = useChat(s => s.detail[sid]?.channels);
  return useMemo(() => (chans || []).some(b => b.type === 'starboard' && b.cid !== cid && (b.config?.watch?.length ? b.config.watch.includes(wid(cid)) : true)), [chans, cid]);
}

// a starboard's `watch` holds the channel ids its server uses (bare ones on an instance)
export const wid = cid => (isInst(cid) ? bare(cid) : cid);

export function starredByMe(m, me) {
  return !!(m.reactions || []).find(r => r.emoji === STAR)?.users?.includes(me);
}
