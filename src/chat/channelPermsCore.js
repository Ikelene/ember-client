// The channel permissions by name and Discord's resolution order (ember-server PROTOCOL §6.5), with nothing else imported so the
// node tests can load it. channelPerms.js puts it to use.
// names -> bits (GET /api/v1/permissions `channel`); the bits are fixed by the protocol
export const CH = {
  view_channel: 1024, send_messages: 1, attach_files: 256, embed_links: 131072, add_reactions: 65536, mention_everyone: 128,
  manage_messages: 64, pin_messages: 1048576, read_message_history: 262144, use_external_emojis: 524288,
  connect: 2097152, speak: 4194304, video: 8388608, stream: 16777216, use_soundboard: 33554432,
  manage_channel: 2, manage_permissions: 8,
};
export const bitsOf = v => (Array.isArray(v) ? v.reduce((b, n) => b | (CH[n] || 0), 0) : Number(v) || 0);

// server: my server permissions (@everyone OR my roles); overwrites: the channel's permission_overwrites
// ({ type: 'role' | 'member', id, everyone?, allow, deny }); roles: my role ids; myId: my principal. -> my bits in the channel:
// @everyone's overwrite (deny, then allow), then all my roles' together (denies, then allows: a role allow beats a role deny),
// then my own (deny, then allow). (The owner and Administrator skip it: the caller checks those.)
export function resolveBits({ server = 0, overwrites = [], roles = [], myId = null, everyoneRid = null }) {
  const mine = new Set(roles.map(String));
  const isEveryone = o => o.type === 'role' && (o.everyone || o.id === 'everyone' || (everyoneRid != null && String(o.id) === String(everyoneRid)));
  let bits = Number(server) || 0;
  const ev = overwrites.find(isEveryone);
  if (ev) bits = (bits & ~bitsOf(ev.deny)) | bitsOf(ev.allow);
  let allow = 0, deny = 0;
  for (const o of overwrites) if (o.type === 'role' && !isEveryone(o) && mine.has(String(o.id))) { allow |= bitsOf(o.allow); deny |= bitsOf(o.deny); }
  bits = (bits & ~deny) | allow;
  const own = myId != null && overwrites.find(o => o.type === 'member' && String(o.id) === String(myId));
  if (own) bits = (bits & ~bitsOf(own.deny)) | bitsOf(own.allow);
  return bits;
}
