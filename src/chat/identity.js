// Apply account changes only to matching IDs. An old name can belong to somebody
// else after a rename; it must never be used as an identity key for old messages.
// instance = true: an event from an Ember instance, whose ids are principals ("v:12"); Velora's own people / me are left alone
export function applyIdentity(state, user, instance = false) {
  // instance = the origin string of the instance that sent the event (or true): b:16 / u:3 are only unique INSIDE one instance,
  // so an event may only touch that instance own members / messages, never another instance that has a b:16 too
  const origin = typeof instance === "string" ? instance : null;
  const mine = key => !origin || String(key).includes(origin + "|");
  if (!user?.id || !(instance ? /^[a-z]:\d+$/ : /^\d+$/).test(String(user.id))) return state;
  const same = value => value?.id != null && String(value.id) === String(user.id);
  const person = value => same(value) ? { ...value, ...user, username: user.username || 'Deleted account' } : value;
  const message = (value, reply = false) => {
    if (!value) return value;
    const next = { ...value, author: person(value.author) };
    if (same(value.subject) && Array.isArray(value.body_parts)) {
      next.subject = { ...value.subject, username: user.username || null };
      next.body = value.body_parts.map(part => part === null ? user.username ? '@' + user.username : 'Deleted account' : part).join('');
      if (reply) next.body = next.body.slice(0, 200);
    }
    if (value.reply) next.reply = message(value.reply, true);
    return next;
  };
  const people = { ...state.people };
  if (!instance) {
    for (const [name, value] of Object.entries(people)) if (same(value)) delete people[name];
    if (user.username) people[user.username] = { ...(state.people[user.username] || {}), ...user };
  }
  return {
    ...state, ...(instance ? {} : { people, me: person(state.me) }),
    members: Object.fromEntries(Object.entries(state.members).map(([key, list]) => [key, mine(key) ? list.map(person) : list])),
    msgs: Object.fromEntries(Object.entries(state.msgs).map(([key, buffer]) => [key, mine(key) ? { ...buffer, list: buffer.list.map(item => message(item)) } : buffer])),
  };
}

// A member's nickname on one Ember server changed (chat_member_update whose member carries `nick`): messages already loaded in
// that server's channels show the new name. Only that server's channels (a nick is per server), only that member's id.
// member: the server's member view ({ id, display_name, nick, global_display_name? }); cids: that server's channel keys
export function applyNick(state, member, cids) {
  if (!member?.id || !('nick' in member) || !cids?.length) return state;
  const same = v => v?.id != null && String(v.id) === String(member.id);
  const nickOf = v => {
    if (!same(v)) return v;
    const own = member.global_display_name || (v.nick ? v.global_display_name : v.display_name) || v.display_name;
    return member.nick ? { ...v, display_name: member.nick, nick: member.nick, global_display_name: own } : { ...v, display_name: member.display_name || own, nick: null, global_display_name: undefined };
  };
  const msg = v => (v ? { ...v, author: nickOf(v.author), ...(v.reply ? { reply: { ...v.reply, author: nickOf(v.reply.author) } } : {}) } : v);
  let msgs = state.msgs, changed = false;
  for (const cid of cids) {
    const b = msgs[`c:${cid}`];
    if (!b?.list?.some(x => same(x.author) || same(x.reply?.author))) continue;
    if (!changed) { msgs = { ...msgs }; changed = true; }
    msgs[`c:${cid}`] = { ...b, list: b.list.map(msg) };
  }
  return changed ? { ...state, msgs } : state;
}
