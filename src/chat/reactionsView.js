import { useChat, lookupMany } from './store.js';
import { useEffect, useMemo } from 'react';

// names -> faces: the server's member list when it has them, else Nookara's public profiles (looked up in batches)
export function useNameFaces(names, sid) {
  const people = useChat(s => s.people);
  const members = useChat(s => (sid ? s.members[sid] : null));
  const key = names.join('\n');
  useEffect(() => {
    const miss = names.filter(n => !people[n] && !members?.some(m => m.username === n));
    if (miss.length) lookupMany(miss).catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => names.map(n => {
    const mem = members?.find(m => m.username === n);
    const p = people[n];
    return { username: n, ...(mem || {}), pfp: mem?.pfp || p?.pfp || null, display_name: mem?.display_name || p?.display_name || null };
  }), [key, people, members]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function openReactionsView(m, emoji) {
  dispatchEvent(new CustomEvent('vc-reactions-view', { detail: { m, emoji: emoji || null } }));
}
