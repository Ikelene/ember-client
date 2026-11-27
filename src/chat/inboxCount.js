// the count on the inbox button
import { useChat, isMuted } from './store.js';

export function useInboxCount() {
  const notif = useChat(s => s.notifUnread);
  const servers = useChat(s => s.servers);
  const srvMentions = useChat(s => s.srvMentions);
  useChat(s => s.notify);
  const pings = servers.reduce((n, s) => n + (isMuted(s.sid) ? 0 : (s.mentions || 0) + (srvMentions[s.sid] || 0)), 0);
  return notif + pings;
}
