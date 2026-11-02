// What can be done with a message where it is: one list for the right-click menu and the hover toolbar, in a server channel,
// a DM or a group chat. Pure, no imports (the node tests load it). The server still checks all of it when the action arrives.
//
//                 channel                   DM                         group chat
//   reply         if I can post             yes                        yes
//   react         yes                       yes                        no (group messages have no reactions)
//   forward       yes                       yes                        yes
//   edit          my own                    my own                     no (group messages can't be edited)
//   delete        my own, or Manage msgs    my own                     my own
//   copy link     the channel               no (#/dm/<name> means      the group (members only)
//                                           someone else to the reader)
export function messageCaps(view, m, { mine = false, canMod = false, canPost = true } = {}) {
  const none = { reply: false, react: false, forward: false, edit: false, del: false, copyLink: false };
  if (!view || !m) return none;
  const live = !m.system && !m.ephemeral;
  const saved = live && !m.pending && !m.failed;
  const channel = view.kind === 'channel', group = view.kind === 'group';
  const dm = view.kind === 'dm' && view.username !== 'System' && !!m.imId;
  const row = channel && /^\d+$/.test(String(m.id));
  return {
    reply: live && (channel ? !!canPost : group ? !!m.gid : dm),
    react: saved && (row || dm),
    forward: saved,
    edit: !!mine && (channel || dm),
    del: channel ? !!(mine || canMod) : !!mine && (dm || (group && !!m.gid)),
    copyLink: channel || group,
  };
}

// the reactions I've already made on this message (the quick reaction row in the menu marks them)
export const myReactions = (m, me) => (m?.reactions || []).filter(r => r.users?.includes(me)).map(r => r.emoji);
