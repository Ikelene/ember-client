// the kinds of channel a server can have, their icons and the shop / link channels' helpers (ChannelTypes.jsx draws them)
import { Hash, ScrollText, BadgeCheck, DoorOpen, ExternalLink, Volume2, Star, Gamepad2 } from 'lucide-react';
import { toast, ask } from './store.js';

export const TYPES = [
  { id: 'text', label: 'Text', hint: 'Messages, pictures and GIFs.', Icon: Hash },
  { id: 'logs', label: 'Logs', hint: 'Webhooks post here, members read - or bridge a CloudLink chat.', Icon: ScrollText },
  { id: 'roles', label: 'Roles shop', hint: 'People give themselves roles - free or for credits.', Icon: BadgeCheck },
  { id: 'welcome', label: 'Join & leave', hint: 'Says hi when people join or leave.', Icon: DoorOpen },
  { id: 'link', label: 'Link', hint: 'Opens a website.', Icon: ExternalLink },
  { id: 'voice', label: 'Voice', hint: 'Talk together - join and leave any time.', Icon: Volume2 },
  { id: 'starboard', label: 'Starboard', hint: 'The best messages - once they get enough stars.', Icon: Star },
  { id: 'game', label: 'Game server', hint: 'Link a Minecraft server: join info, console or chat.', Icon: Gamepad2 },
];

export const typeIcon = type => TYPES.find(t => t.id === type && type !== 'text')?.Icon || null;

// ── link channels: say where it goes, then open it ──
export async function openLinkChannel(c) {
  const href = c?.config?.url;
  if (!href) { toast('This link channel has no link yet.'); return; }
  let host = href;
  try { host = new URL(href).host; } catch { /* keep it */ }
  if (await ask({ title: `#${c.name} opens a website`, text: 'You are leaving Ember. This channel goes to:', link: { host, href }, confirm: 'Open link' })) window.open(href, '_blank', 'noopener,noreferrer');
}

// ── the roles shop (shown instead of messages) ──
// An instance's paid roles are paid in Nookara credits: buying one makes a Nookara pay request, which you approve here (signed in
// with Nookara) or on Nookara's payment page; the instance hands out the role once Nookara says it's paid (chat_shop_update).
// the shop's items in sections: roles with no category first (cards, no heading), then each category in order; empty ones are left out
export function shopGroups(d) {
  const cats = Array.isArray(d?.categories) ? d.categories : [];
  const known = new Set(cats.map(k => k.id));
  const items = d?.items || [];
  const out = [{ id: '', name: '', style: 'cards', items: items.filter(it => !known.has(it.cat)) }];
  for (const k of cats) out.push({ id: k.id, name: k.name, style: k.style === 'buttons' ? 'buttons' : 'cards', items: items.filter(it => it.cat === k.id) });
  return out.filter(g => g.items.length);
}

// locked composer wording for each type
export function lockedTextFor(channel) {
  if (!channel) return null;
  if (channel.type === 'logs' && channel.config?.mode === 'cloudlink') return "You can't send messages in this CloudLink channel.";
  if (channel.type === 'logs') return 'This is a logs channel - only webhooks (and admins) post here.';
  if (channel.type === 'welcome') return 'Join and leave messages show up here.';
  // not locked, yet I can't post: the channel's permissions say so (an overwrite denies Send messages)
  if (!channel.locked && channel.can_post === false) return "You don't have permission to send messages in this channel.";
  return null;
}
