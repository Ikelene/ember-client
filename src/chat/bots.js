// adding a bot to a server, and the bots' error text (Bots.jsx)
import { legacyToNew, EMBER_API } from '../compat.js';
import { useChat } from './store.js';
import { has, P } from './perms.js';
import { apiFetch } from '../api.js';
import { bare } from './ids.js';

export const errText = e => ({
  bad_bot_name: 'Names are 2-32 letters, numbers, dots, dashes or underscores.', name_taken: 'Someone already has that name.',
  too_many_bots: 'That server has as many bots as it can have.', already_in_server: "It's already in that server.",
  bot_is_private: 'This bot is private.', not_allowed: 'You need Manage server there.', forbidden: 'You need Manage server for that.',
  gallery_banned: 'This bot was banned from the gallery.', bot_not_found: "That bot doesn't exist (any more).",
  invalid_instance: "That server's homeserver address isn't valid.", unknown_instance: "That server's homeserver isn't registered with Nookara, so it can't take gallery bots.",
  instance_banned: "That server's homeserver is banned from Nookara.", gallery_needs_nookara_account: "That homeserver uses its own accounts, so it can't take gallery bots (they need Nookara sign-in).",
  ticket_invalid: "Nookara's permission slip wasn't accepted - try again.", ticket_unknown_kid: "The homeserver doesn't know Nookara's signing key yet - try again in a minute.",
  ticket_bad_signature: "Nookara's permission slip didn't check out - try again.", ticket_wrong_issuer: "That slip didn't come from Nookara.",
  ticket_wrong_audience: 'That slip was made for another homeserver - try again.', ticket_wrong_user: "That slip isn't yours.", ticket_expired: 'That took too long and the slip expired - try again.',
  ticket_used: 'That slip was already used - try again.', banned_from_server: 'This bot is banned from that server.',
  token_conflict: 'A different bot with the same token is already in that server.', nookara_unreachable: "That homeserver couldn't reach Nookara - try again in a bit.",
  instance_unreachable: "Couldn't reach that homeserver.", instance_not_connected: 'Sign in to that homeserver first.', inst_scope: 'This login needs a new permission for that homeserver - log in again.',
  signed_out: 'Sign in to add bots.', message_required: 'Write a message first.', description_required: 'Add a short description of at least 10 characters (the one-line summary shown on the card).', long_description_required: 'Add a long description of at least 20 characters (what the bot does and how to use it).', description_too_long: 'The short description can be 200 characters at most.',
  avatar_required: 'Give the bot a profile picture first (upload one in the bot settings above).', already_pending: "It's already waiting for review.", already_listed: "It's already in the gallery.",
  invalid_tags: 'Tags are 2-20 letters, numbers or dashes, up to 6.', invalid_support_url: 'The support link has to start with https://.', invalid_links: 'Links need a label and an https:// address (up to 5).',
  invalid_permissions: 'One of those permissions is not on the list.', invalid_state: "It can't do that in its current state.",
}[legacyToNew(e?.message)] || `Something went wrong - try again.${e?.message ? ` (${e.message})` : ''}`);

// the servers where I may add a bot: Manage server there. Nookara's own (legacy) servers and each instance's community.
export function useAddTargets() {
  const servers = useChat(s => s.servers);
  const detail = useChat(s => s.detail);
  const insts = useChat(s => s.instances);
  return (servers || []).filter(s => {
    if (!s?.sid) return false;
    const perms = s.perms ?? detail?.[s.sid]?.server?.perms;
    const i = s.inst ? insts?.find(x => x?.origin === s.inst) : null;
    return (perms != null && (has(perms, P.MANAGE_SERVER) || has(perms, P.ADMIN))) || ['owner', 'admin'].includes(s.role) || !!(i && (i.isAdmin || i.isOwner));
  });
}

// Add a gallery bot to a server I manage. Nookara servers: the old route. Instance servers: Nookara hands out a ticket for the
// instance, the instance checks it. Resolves to { test } or throws an Error whose message is the code.
export async function addBotToServer(bot, s) {
  if (!bot?.username || !s?.sid) throw new Error('not_allowed');
  if (!s.inst) { await apiFetch(`/chat/bots/by-name/${encodeURIComponent(bot.username)}/add`, { method: 'POST', body: JSON.stringify({ sid: s.sid }) }); return { test: false }; }
  if (!bot?.id) throw new Error('bot_not_found');
  const t = await apiFetch(`${EMBER_API}/bots/gallery/${encodeURIComponent(bot.id)}/ticket`, { method: 'POST', body: JSON.stringify({ instance: s.inst }) });
  if (!t?.ticket) throw new Error('ticket_invalid');
  await apiFetch('/api/v1/bots/gallery/add', { inst: s.inst, method: 'POST', body: JSON.stringify({ ticket: t.ticket, sid: bare(s.sid) }) });
  return { test: !!t.test };
}
