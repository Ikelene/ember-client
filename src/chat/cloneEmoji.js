// Clone emoji: copy someone's custom emoji into a server of yours (one where you have Manage server).
// The picture is fetched as-is (GIFs stay animated) and uploaded like a new emoji from Server settings > Emojis.
import { Copy, Server } from 'lucide-react';
import { uploadFetch } from '../api.js';
import { getState, customEmoji, loadEmojis, toast, errorText } from './store.js';
import { P, has } from './roles.jsx';

// the servers you could add it to
export function cloneTargets() {
  const s = getState();
  return (s.servers || []).filter(x => !x.read_only && has(x.perms ?? s.detail?.[x.sid]?.server?.perms, P.MANAGE_SERVER));
}

export async function cloneEmoji(emoji, sid) {
  const name = String(emoji.name || 'emoji').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) || 'emoji';
  try {
    const res = await fetch(new URL(customEmoji(emoji.eid, emoji.animated), location.href).href, { credentials: 'omit' });
    if (!res.ok) throw new Error('emoji_unavailable');
    const blob = await res.blob();
    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', blob, `${name}.${emoji.animated ? 'gif' : 'png'}`);
    await uploadFetch(`/chat/servers/${sid}/emojis`, fd);
    loadEmojis();
    const srv = getState().servers.find(x => x.sid === sid);
    toast(`Added :${name}: to ${srv?.name || 'your server'}.`, true);
  } catch (e) {
    toast({ emoji_unavailable: "Couldn't get that emoji's picture.", too_many_emojis: 'That server is out of emoji slots.', file_too_large: 'That emoji is too big to copy (2 MB max).', not_allowed: "You can't add emojis to that server." }[e.message] || errorText(e.message));
  }
}

// a menu item ("Clone emoji" with your servers as a submenu), or null when you have nowhere to put it
export function cloneMenuItem(emoji) {
  if (!emoji?.eid) return null;
  const targets = cloneTargets();
  if (!targets.length) return { label: 'Clone emoji', icon: Copy, disabled: true, hint: 'Needs Manage server somewhere' };
  return { label: 'Clone emoji', icon: Copy, sub: targets.map(x => ({ label: x.name, icon: Server, onClick: () => cloneEmoji(emoji, x.sid) })) };
}
