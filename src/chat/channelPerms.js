// Channel permission overwrites (ember-server PROTOCOL §6.5): the channel permissions by name, grouped for the editor
// (ChannelPerms.jsx), the words for the server's refusals, and what I may do in a channel worked out the server's way from the
// channel view's permission_overwrites, so the composer and the buttons hide what the server would refuse anyway.
import { useChat, getState } from './store.js';
import { isInst, instOf, bare } from './ids.js';
import { CH, bitsOf, resolveBits } from './channelPermsCore.js';

export { CH, bitsOf, resolveBits };

// [group, [[name, label, what it allows]]]
export const CH_GROUPS = [
  ['General', [
    ['view_channel', 'See the channel', 'Without it the channel is hidden: not in the list, no unread counts, no notifications.'],
    ['manage_channel', 'Manage channel', 'Rename it, change its topic and settings, delete it.'],
    ['manage_permissions', 'Manage permissions', "Edit this channel's permissions (only for what they have themselves)."],
  ]],
  ['Text', [
    ['send_messages', 'Send messages', 'Post messages and show as typing.'],
    ['attach_files', 'Attach files', 'Upload pictures and files.'],
    ['embed_links', 'Embed links', 'Links in their messages get previews.'],
    ['add_reactions', 'Add reactions', 'Add new reactions (taking their own off always works).'],
    ['use_external_emojis', 'Use emojis from other servers', 'Custom emojis that belong to other servers.'],
    ['mention_everyone', 'Mention @everyone, @here and all roles', 'Ping the whole channel, or roles that are not mentionable.'],
    ['manage_messages', 'Manage messages', "Delete other people's messages and pin them."],
    ['pin_messages', 'Pin messages', 'Pin and unpin messages.'],
    ['read_message_history', 'Read message history', 'See messages sent before they opened the channel, pins and search.'],
  ]],
  ['Voice', [
    ['connect', 'Connect', 'Join the voice channel.'],
    ['speak', 'Speak', 'Use their microphone there.'],
    ['video', 'Video', 'Turn on their camera.'],
    ['stream', 'Share screen', 'Share their screen (and its sound).'],
    ['use_soundboard', 'Use soundboard', 'Play soundboard sounds there.'],
  ]],
];
export const VOICE_ONLY = new Set(['connect', 'speak', 'video', 'stream', 'use_soundboard']);
export const TEXT_ONLY = new Set(['send_messages', 'attach_files', 'embed_links', 'add_reactions', 'use_external_emojis', 'mention_everyone', 'manage_messages', 'pin_messages', 'read_message_history']);
// the groups that matter for a channel of this type (a category shows all of them)
export const groupsFor = type => CH_GROUPS.map(([g, list]) => [g, list.filter(([n]) => (type === 'voice' ? !TEXT_ONLY.has(n) || n === 'send_messages' : type === 'category' ? true : !VOICE_ONLY.has(n)))]).filter(([, l]) => l.length);

export const namesOf = bits => Object.keys(CH).filter(n => (bits & CH[n]) === CH[n]);

// the server's refusals of an overwrite edit, in words
export function overwriteErrorText(e) {
  const names = Array.isArray(e?.names) ? e.names : [];
  const label = n => CH_GROUPS.flatMap(([, l]) => l).find(([k]) => k === n)?.[1] || n.replace(/_/g, ' ');
  switch (e?.error || e?.message) {
    case 'cannot_grant': return `You can only change permissions you have here yourself${names.length ? `: not ${names.map(label).join(', ')}` : ''}.`;
    case 'role_too_high': return "That role is as high as yours or higher, so you can't change its permissions.";
    case 'member_too_high': return "Their highest role is above yours, so you can't change their permissions.";
    case 'owner_not_affected': return "The owner can always do everything: permissions don't apply to them.";
    case 'would_lock_you_out': return "That would stop you seeing this channel or editing its permissions, so it wasn't saved.";
    case 'not_a_channel_permission': return "That isn't a channel permission (server-wide ones are set on roles).";
    case 'role_not_found': return 'That role is gone.';
    case 'member_not_found': return "They aren't in the server any more.";
    case 'category_not_found': return 'That category is gone.';
    case 'no_category': return "This channel isn't in a category.";
    case 'invalid_permissions': case 'invalid_overwrite_type': return "Those permissions couldn't be saved.";
    default: return "Couldn't save the permissions. Try again.";
  }
}

// what I may do in a channel (bits; null = not known yet). sid/cid: the app's ids. Owner / Administrator: everything; Nookara-hosted servers: their
// server permissions (they have no overwrites); a channel view without permission_overwrites: the server permissions too
export function channelBits(st, sid, cid) {
  const d = st.detail[sid];
  if (!d || d.server?.perms == null) return null; // (not known yet)
  const server = Number(d.server.perms) || 0;
  if (d.server?.role === 'owner' || (server & 512)) return 0x7fffffff;
  const ch = d.channels?.find(c => c.cid === cid);
  const ows = ch?.permission_overwrites;
  if (!isInst(sid) || !Array.isArray(ows)) return server;
  const me = st.instances.find(i => i.origin === instOf(sid))?.user || null;
  const myId = me?.id != null ? String(me.id) : null;
  const member = st.members[sid]?.find(m => (myId && String(m.id) === myId) || (me?.username && m.username === me.username));
  const roles = new Set((member?.roles || []).map(String));
  return resolveBits({ server, overwrites: ows, roles: [...roles], myId, everyoneRid: d.roles?.find(r => r.is_default)?.rid });
}
// can I (name) in this channel? true while it isn't known (the server still checks)
export const canIn = (st, sid, cid, name) => { const b = channelBits(st, sid, cid); return b == null || (b & CH[name]) === CH[name]; };
export const useCanIn = (sid, cid, name) => useChat(s => (sid && cid ? canIn(s, sid, cid, name) : true));
export const canInNow = (sid, cid, name) => canIn(getState(), sid, cid, name);

// the routes, by the app's ids
export const owPath = (sid, cid) => `/api/v1/servers/${encodeURIComponent(bare(sid))}/channels/${encodeURIComponent(bare(cid))}/overwrites`;
export const catOwPath = (sid, name) => `/api/v1/servers/${encodeURIComponent(bare(sid))}/categories/${encodeURIComponent(name)}/overwrites`;
export const effectivePath = (sid, cid, principal) => `/api/v1/servers/${encodeURIComponent(bare(sid))}/channels/${encodeURIComponent(bare(cid))}/permissions/${encodeURIComponent(principal)}`;
// an overwrite's allow/deny as bits, whatever the server sent (numbers, or the names lists)
export const owBits = o => ({ allow: Array.isArray(o.allow_names) ? bitsOf(o.allow_names) : bitsOf(o.allow), deny: Array.isArray(o.deny_names) ? bitsOf(o.deny_names) : bitsOf(o.deny) });
