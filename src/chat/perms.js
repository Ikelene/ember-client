// permissions, role colors and the moderation / nickname / role menu items (roles.jsx draws the role parts)
import { getState, useChat, ask, memberRef, toast, errorText, loadMembers, untilText } from './store.js';
import { Hash, Megaphone, Lock, MessageCircle, Gamepad2, Music, Image, Code, Bug, Lightbulb, HelpCircle, Star, Heart, BookOpen, Coffee, Sparkles, Trophy, Video, Palette, Terminal, Globe, Bell, Shield, Rocket, ScrollText, Smile, Flame, Zap, Gift, Pin, Clock, UserMinus, Ban, PenLine, RotateCcw } from 'lucide-react';
import { isNookara, nookaraId } from '../compat.js';
import { isInst, instOf } from './ids.js';
import { apiFetch } from '../api.js';

export const P = {
  SEND: 1, MANAGE_CHANNELS: 2, MANAGE_SERVER: 4, MANAGE_ROLES: 8, KICK: 16, BAN: 32,
  MANAGE_MESSAGES: 64, MENTION_EVERYONE: 128, ATTACH: 256, ADMIN: 512, MANAGE_USERS: 2048,
  UNMARKED_ALIASES: 4096, // instances only: a bot's alias messages show unmarked while the server's Danger zone allows it
  CHANGE_NICKNAME: 8192, MANAGE_NICKNAMES: 16384, // instances only: your own server nickname / anyone's below you
  CUSTOMIZE_PROFILE: 32768, // instances only: your own picture, banner, colour, bio and pronouns on that server
  // instances only, also channel permissions (ember-server PROTOCOL §6.5): @everyone has them all by default except Pin messages
  ADD_REACTIONS: 65536, EMBED_LINKS: 131072, READ_HISTORY: 262144, USE_EXTERNAL_EMOJIS: 524288, PIN_MESSAGES: 1048576,
  CONNECT: 2097152, SPEAK: 4194304, VIDEO: 8388608, STREAM: 16777216, USE_SOUNDBOARD: 33554432,
};
// the channel-permission bits a role editor that knows them sends whole (full_permissions: true)
export const INSTANCE_CHANNEL_PERMS = ['ADD_REACTIONS', 'EMBED_LINKS', 'READ_HISTORY', 'USE_EXTERNAL_EMOJIS', 'PIN_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'STREAM', 'USE_SOUNDBOARD'];

export const PERM_LIST = [
  ['ADMIN', 'Administrator', 'Every permission, and can do anything in the server. Be careful who gets this.'],
  ['MANAGE_SERVER', 'Manage server', 'Change the name, description, icon, banner and server settings.'],
  ['MANAGE_ROLES', 'Manage roles', 'Create and edit roles below their own, and give them to people.'],
  ['MANAGE_USERS', 'Manage users', 'See who is really online (invisible people show with a hollow dot), which client and device people use, and when they last logged in. Also shows a client tag next to their messages.', "Shows when people last logged in and which page each message was sent from. Invisible status and devices only show in Nookara's own servers: this server doesn't see people's presence."],
  ['MANAGE_NICKNAMES', 'Manage nicknames', "Change anyone's server nickname whose highest role is below theirs, and their own."],
  ['MANAGE_CHANNELS', 'Manage channels', 'Create, edit, delete and rearrange channels and categories.'],
  ['KICK', 'Kick members', 'Remove people from the server (they can come back with an invite).'],
  ['BAN', 'Ban members', 'Remove people for good.'],
  ['MANAGE_MESSAGES', 'Manage messages', "Delete other people's messages, and post in locked channels."],
  ['MENTION_EVERYONE', 'Mention @everyone, @here and all roles', 'Ping the whole server, or roles that are not mentionable.'],
  ['SEND', 'Send messages', 'Post in channels that let everyone send messages.'],
  ['ATTACH', 'Attach files', 'Send pictures with their messages.'],
  ['EMBED_LINKS', 'Embed links', 'Links in their messages get previews.'],
  ['ADD_REACTIONS', 'Add reactions', 'Add new reactions to messages (taking their own off always works).'],
  ['USE_EXTERNAL_EMOJIS', 'Use emojis from other servers', 'Custom emojis that belong to other servers, in their messages.'],
  ['READ_HISTORY', 'Read message history', 'See messages sent before they opened a channel, pins and search.'],
  ['PIN_MESSAGES', 'Pin messages', 'Pin and unpin messages.'],
  ['CONNECT', 'Connect to voice', 'Join voice channels.'],
  ['SPEAK', 'Speak', 'Use their microphone in voice channels.'],
  ['VIDEO', 'Video', 'Turn on their camera in voice channels.'],
  ['STREAM', 'Share screen', 'Share their screen in voice channels.'],
  ['USE_SOUNDBOARD', 'Use soundboard', 'Play soundboard sounds in voice channels.'],
  ['CHANGE_NICKNAME', 'Change nickname', 'Set their own nickname on this server.'],
  ['CUSTOMIZE_PROFILE', 'Customize profile in this server', 'Set their own picture, banner, name color, bio and pronouns for this server only (Settings > Profile, pick this server). Off for everyone unless you turn it on.'],
  ['UNMARKED_ALIASES', 'Use unmarked aliases', "For bots: while the server owner has turned on unmarked aliases (Server settings > Danger zone > Advanced), this bot's alias messages look exactly like a member's, with no alias mark. Only give it to bots you trust."],
];

export const has = (perms, bit) => ((Number(perms) || 0) & bit) === bit;

export const myPerms = sid => getState().detail[sid]?.server.perms || 0;

export function useCan(sid, bit) { return useChat(s => has(s.detail[sid]?.server.perms, bit)); }

export const CHANNEL_ICONS = {
  hash: Hash, megaphone: Megaphone, lock: Lock, 'message-circle': MessageCircle, 'gamepad-2': Gamepad2, music: Music, image: Image,
  code: Code, bug: Bug, lightbulb: Lightbulb, 'help-circle': HelpCircle, star: Star, heart: Heart, 'book-open': BookOpen, coffee: Coffee,
  sparkles: Sparkles, trophy: Trophy, video: Video, palette: Palette, terminal: Terminal, globe: Globe, bell: Bell, shield: Shield,
  rocket: Rocket, 'scroll-text': ScrollText, smile: Smile, flame: Flame, zap: Zap, gift: Gift, pin: Pin,
};

// ── names: colour + role icon ──
// the roles someone has in a server, highest first
export function rolesOf(sid, username, st = getState()) {
  const m = st.members[sid]?.find(x => x.username === username);
  const all = st.detail[sid]?.roles || [];
  return all.filter(r => !r.is_default && m?.roles?.includes(r.rid)).sort((a, b) => b.position - a.position);
}

// their own accent colour (if the server allows it), else their highest coloured role
export function nameColor(sid, user, st = getState()) {
  if (!user) return null;
  const allow = sid ? st.detail[sid]?.server.allow_accent !== false : true;
  // a Nookara person on an instance: their accent comes from their live Nookara profile, which may not have loaded yet - hold the
  // name neutral until it has (rather than showing the role colour first and flipping to the accent)
  if (allow && user.inst && isNookara(user.kind) && nookaraId(user) && !st.nookaraFaces[String(nookaraId(user))]) return null;
  if (allow && user.color && !/^#?(fff|ffffff)$/i.test(user.color)) return user.color;
  if (!sid) return null;
  return rolesOf(sid, user.username, st).find(r => r.color)?.color || null;
}

export function roleIcon(sid, username, st = getState()) {
  return sid ? rolesOf(sid, username, st).find(r => r.icon) || null : null;
}

// a hook so names redraw when roles / members / settings change
export function useNameStyle(sid, user) {
  return useChat(s => {
    const c = nameColor(sid, user, s);
    const ic = roleIcon(sid, user?.username, s);
    return `${c || ''}|${ic ? `${ic.icon}|${ic.name}` : ''}`;
  });
}

export const colorFrom = key => key.split('|')[0] || undefined;

// ── removing / banning someone (member menu, profile card, Server settings > Members) ──
// may I? On an instance the server also wants my highest role above theirs (the owner is above everyone); it checks again.
export function modRights(sid, username, st = getState()) {
  const srv = st.detail[sid]?.server;
  const inst = isInst(sid);
  const them = st.members[sid]?.find(x => x.username === username);
  const meU = inst ? st.instances.find(i => i.origin === instOf(sid))?.user : st.me;
  const isMe = inst ? !!them && them.id === meU?.id : meU?.username === username;
  if (!srv || isMe || them?.role === 'owner') return { kick: false, ban: false, below: false };
  const top = name => Math.max(0, ...rolesOf(sid, name, st).map(r => r.position));
  const below = !inst || srv.role === 'owner' || !them || top(username) < top(meU?.username);
  return { kick: !!them && has(srv.perms, P.KICK), ban: has(srv.perms, P.BAN), below };
}

const MOD_ASK = {
  ban: n => ({ title: `Ban ${n}?`, text: "They're removed from the server and can't rejoin until they're unbanned.", confirm: 'Ban', danger: true }),
  kick: n => ({ title: `Remove ${n}?`, text: 'They can join again with an invite.', confirm: 'Remove', danger: true }),
  unban: n => ({ title: `Unban ${n}?`, text: 'They can join again.', confirm: 'Unban' }),
};

// -> true when done. who = the member / ban entry (its id is what an instance's routes want)
export async function moderate(sid, username, what, who) {
  if (!(await ask(MOD_ASK[what](username)))) return false;
  const ref = who?.id && isInst(sid) ? encodeURIComponent(who.id) : memberRef(sid, username);
  try {
    await apiFetch(what === 'unban' ? `/chat/servers/${sid}/bans/${ref}` : `/chat/servers/${sid}/members/${ref}${what === 'ban' ? '?ban=1' : ''}`, { method: 'DELETE' });
    toast(what === 'ban' ? `${username} is banned.` : what === 'kick' ? `${username} was removed.` : `${username} is unbanned.`, true);
    return true;
  } catch (e) { toast(errorText(e.message)); return false; }
}

// the Remove / Ban items of a member's right-click menu
export function modMenuItems(sid, username) {
  if (!sid) return [];
  const r = modRights(sid, username);
  if (!r.kick && !r.ban) return [];
  const hint = r.below ? '' : 'Their role is as high as yours';
  const m = isInst(sid) ? getState().members[sid]?.find(x => x.username === username) : null;
  const out = m?.timeout_until > Date.now();
  return ['sep',
    m && !m.bot && { label: out ? `Change timeout` : `Time out ${username}`, icon: Clock, disabled: !r.below, hint, onClick: () => timeOutMember(sid, m) },
    m && out && { label: 'Remove timeout', icon: Clock, onClick: () => liftTimeout(sid, m) },
    r.kick && { label: `Remove ${username}`, icon: UserMinus, danger: true, disabled: !r.below, hint, onClick: () => moderate(sid, username, 'kick') },
    r.ban && { label: `Ban ${username}`, icon: Ban, danger: true, disabled: !r.below, hint, onClick: () => moderate(sid, username, 'ban') },
  ];
}

// Server nickname (Ember servers only): shown on that server instead of the person's name. Your own with Change nickname
// (or Manage nicknames); someone else's with Manage nicknames when their role is below yours (the server checks too)
export const canNick = (sid, isMe) => {
  const p = getState().detail[sid]?.server?.perms;
  return has(p, P.MANAGE_NICKNAMES) || (isMe && has(p, P.CHANGE_NICKNAME));
};

export function nickMenuItems(sid, username) {
  if (!sid || !isInst(sid)) return [];
  const st = getState();
  const srv = st.detail[sid]?.server;
  const m = st.members[sid]?.find(x => x.username === username);
  const meU = st.instances.find(i => i.origin === instOf(sid))?.user;
  if (!srv || !m || !meU) return [];
  const isMe = m.id === meU.id;
  if (!canNick(sid, isMe)) return [];
  const r = isMe ? { below: true } : modRights(sid, username, st);
  const below = isMe || (m.role !== 'owner' && (srv.role === 'owner' || r.below));
  return [{ label: isMe ? 'Change nickname' : `Change ${username}'s nickname`, icon: PenLine, disabled: !below, hint: below ? '' : 'Their role is as high as yours', onClick: () => changeNick(sid, m, isMe) }];
}

export async function changeNick(sid, m, isMe) {
  const a = await ask({
    title: isMe ? 'Change nickname' : `Change ${m.username}'s nickname`, compact: true,
    text: `${isMe ? 'Your' : 'Their'} nickname only shows on ${getState().detail[sid]?.server?.name || 'this server'}. Leave it empty to go back to ${isMe ? 'your' : 'their'} normal name.`,
    input: { placeholder: m.global_display_name || m.display_name || m.username, value: m.nick || '', optional: true, max: 32 }, confirm: 'Save',
  });
  if (!a) return false;
  try {
    const r = await apiFetch(`/chat/servers/${sid}/members/${isMe ? '@me' : encodeURIComponent(m.id)}`, { method: 'PATCH', body: JSON.stringify({ nick: a.text || null }) });
    toast(r.nick ? `Nickname set to ${r.nick}.` : 'Nickname removed.', true); loadMembers(sid); return true;
  } catch (e) { toast(e.message === 'not_found' || e.message === 'method_not_allowed' ? "This server doesn't support nicknames yet (it needs an update)." : errorText(e.message)); return false; }
}

// Reset profile (Ember servers with server profiles): someone's look on this server back to their global profile. Manage users, and
// above them. They get a line in their Nookara inbox saying so (the server sends it)
export function profileMenuItems(sid, username) {
  if (!sid || !isInst(sid)) return [];
  const st = getState();
  const srv = st.detail[sid]?.server;
  const m = st.members[sid]?.find(x => x.username === username);
  const inst = st.instances.find(i => i.origin === instOf(sid));
  if (!srv || !m || m.bot || !inst?.user || !inst.features?.server_profiles || m.id === inst.user.id) return [];
  if (!has(srv.perms, P.MANAGE_USERS) || (!m.profile && !m.nick)) return [];
  const r = modRights(sid, username, st);
  const below = m.role !== 'owner' && (srv.role === 'owner' || r.below);
  return [{ label: 'Reset profile', icon: RotateCcw, danger: true, disabled: !below, hint: below ? 'Back to their global profile' : 'Their role is as high as yours', onClick: () => resetProfile(sid, m) }];
}

export async function resetProfile(sid, m) {
  const ok = await ask({ title: `Reset ${m.display_name || m.username}'s profile?`, text: `Their picture, banner, name color, bio, pronouns and nickname on ${getState().detail[sid]?.server?.name || 'this server'} go back to their global profile. They get a notice saying so.`, confirm: 'Reset profile', danger: true });
  if (!ok) return;
  try { await apiFetch(`/chat/servers/${sid}/members/${encodeURIComponent(m.id)}/profile/reset`, { method: 'POST' }); toast('Profile reset.', true); loadMembers(sid); }
  catch (e) { toast(errorText(e.message)); }
}

// timeouts (instances): no posting, reacting or voice until it ends. Kick or Ban; the server checks the role order too
const TIMEOUTS = [['60', '60 seconds'], ['300', '5 minutes'], ['600', '10 minutes'], ['3600', '1 hour'], ['86400', '1 day'], ['604800', '1 week']];

const UNIT = { m: 60, h: 3600, d: 86400 };

export async function timeOutMember(sid, m) {
  const a = await ask({
    title: `Time out ${m.username}`, compact: true,
    text: `They can still read, but can't send messages, react, join voice or play sounds until it ends.${m.timeout_until > Date.now() ? ` They're timed out until ${untilText(m.timeout_until)} now - this replaces it.` : ''}`,
    choices: [...TIMEOUTS.map(([id, label]) => ({ id, label })), { id: 'custom', label: 'Custom', custom: { units: [['m', 'minutes'], ['h', 'hours'], ['d', 'days']] } }],
    input: { placeholder: 'Reason (optional, they see it)', value: '', optional: true, max: 200 }, confirm: 'Time out',
  });
  if (!a) return false;
  const seconds = a.choice === 'custom' ? Math.round(a.amount * UNIT[a.unit]) : Number(a.choice);
  if (!(seconds >= 1 && seconds <= 28 * 86400)) { toast('A timeout can be up to 28 days.'); return false; }
  try {
    const r = await apiFetch(`/chat/servers/${sid}/timeouts`, { method: 'POST', body: JSON.stringify({ user_id: m.id, seconds, reason: a.text || '' }) });
    toast(`${m.username} is timed out until ${untilText(r.until)}.`, true); loadMembers(sid); return true;
  } catch (e) { toast(errorText(e.message)); return false; }
}

export async function liftTimeout(sid, m) {
  try { await apiFetch(`/chat/servers/${sid}/timeouts/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); toast(`${m.username}'s timeout is lifted.`, true); loadMembers(sid); }
  catch (e) { toast(errorText(e.message)); }
}

// "Roles" submenu for right-click menus
export function roleMenuItems(sid, username) {
  const st = getState();
  if (!sid || !has(st.detail[sid]?.server.perms, P.MANAGE_ROLES)) return [];
  const m = st.members[sid]?.find(x => x.username === username);
  const list = (st.detail[sid]?.roles || []).filter(r => !r.is_default).sort((a, b) => b.position - a.position);
  if (!list.length) return [];
  return [{
    label: 'Roles', sub: list.map(r => ({
      label: r.name, checked: !!m?.roles?.includes(r.rid),
      onClick: () => apiFetch(`/chat/servers/${sid}/members/${memberRef(sid, username)}/roles/${r.rid}`, { method: m?.roles?.includes(r.rid) ? 'DELETE' : 'PUT' }).catch(e => toast(errorText(e.message))),
    })),
  }];
}
