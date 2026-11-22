// Does a server's rail icon get the white "new messages" pip? Only for unread channels that aren't muted
// (a muted channel / server stays quiet; mentions have their own red badge). Pure, so it can be tested.
//   srv       the server row: { sid, unread, unread_channels? } (unread_channels = the server's list of unread cids, newer servers send it)
//   channels  its loaded channel list (detail), or null when it isn't loaded
//   unread    store.unread: `c:<cid>` -> true for channels that got messages live
//   unreadN   store.unreadN: cid -> { sid, n } for live messages in servers whose channels aren't loaded
//   muted     (cid, sid) -> true when that channel is muted (by itself or through its server)
// Returns true / false, or null when it can't tell (no channel list, no unread_channels): the caller loads the channels.
export function loudUnread(srv, { channels = null, unread = {}, unreadN = {}, muted = () => false, serverMuted = false } = {}) {
  if (!srv?.unread || serverMuted) return false;
  const sid = srv.sid;
  if (channels) return channels.some(c => (c.unread || unread[`c:${c.cid}`]) && !muted(c.cid, sid));
  // live messages (the socket handler already skips muted channels, but a channel can be muted after they came in)
  if (Object.entries(unreadN).some(([cid, u]) => u?.sid === sid && !muted(cid, sid))) return true;
  if (Array.isArray(srv.unread_channels)) return srv.unread_channels.some(cid => !muted(cid, sid));
  return null;
}

// How many unread messages a server adds to the totals (the tab title's (N), the favicon dot, the phone menu badge, the
// desktop app's count) - muted channels never count (Ikelene 2026-11-22: a muted channel's messages still showed up there).
// Same inputs as loudUnread; the server itself being muted is the caller's check.
//   loaded channels: each unread, unmuted one counts its unread_count (at least 1) + live messages
//   not loaded: live messages in unmuted channels, plus the server's own count - all of it when none of its unread channels
//   are muted, one per unmuted unread channel when some are (the server sends one total, not one per channel), and
//   all of it when it doesn't say which channels (older servers)
export function serverUnreadCount(srv, { channels = null, unread = {}, unreadN = {}, muted = () => false } = {}) {
  const sid = srv?.sid;
  let count = 0;
  if (channels) {
    for (const c of channels) {
      if (muted(c.cid, sid)) continue;
      const live = unreadN[c.cid]?.n || 0;
      if (c.unread || unread[`c:${c.cid}`] || live) count += Math.max(1, (c.unread ? c.unread_count || 0 : 0) + live);
    }
    return count;
  }
  const live = Object.entries(unreadN).reduce((n, [cid, x]) => n + (x?.sid === sid && !muted(cid, sid) ? x.n || 0 : 0), 0);
  if (!srv?.unread) return live;
  if (Array.isArray(srv.unread_channels)) {
    const loud = srv.unread_channels.filter(cid => !muted(cid, sid)).length;
    if (!loud) return live;
    if (loud === srv.unread_channels.length) return Math.max(1, (srv.unread_count || 0) + live);
    return loud + live;
  }
  return Math.max(1, (srv.unread_count || 0) + live);
}
