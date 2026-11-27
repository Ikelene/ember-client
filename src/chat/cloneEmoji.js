// Clone emoji: copy someone's custom emoji into a server of yours (one where you have Manage server).
// The picture is fetched as-is (GIFs stay animated) and uploaded like a new emoji from Server settings > Emojis.
import { Copy, SmilePlus, Lock } from 'lucide-react';
import { serverMenuIcon } from './serverMenuIcon.jsx';
import { addPersonalFromEmoji, isPersonalEmoji, LOCK_TOAST } from './personal.js';
import { emojiLock, emojiLockNow, LOCK_HINT } from './cloneLock.js';
import { uploadFetch } from '../api.js';
import { getState, customEmoji, loadEmojis, toast, errorText } from './store.js';
import { P, has } from './perms.js';

// the servers you could add it to
export function cloneTargets() {
  const s = getState();
  return (s.servers || []).filter(x => !x.read_only && has(x.perms ?? s.detail?.[x.sid]?.server?.perms, P.MANAGE_SERVER));
}

export async function cloneEmoji(emoji, sid) {
  const name = String(emoji.name || 'emoji').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) || 'emoji';
  const lock = await emojiLockNow(emoji);
  if (lock) { toast(LOCK_TOAST[lock]); return; }
  const from = new URL(customEmoji(emoji.eid, emoji.animated), location.href).href;
  try {
    const res = await fetch(from, { credentials: 'omit' });
    if (!res.ok) throw new Error('emoji_unavailable');
    const blob = await res.blob();
    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', blob, `${name}.${emoji.animated ? 'gif' : 'png'}`);
    fd.append('from', from); // (the servers check its owner's / server's clone lock)
    await uploadFetch(`/chat/servers/${sid}/emojis`, fd);
    loadEmojis();
    const srv = getState().servers.find(x => x.sid === sid);
    toast(`Added :${name}: to ${srv?.name || 'your server'}.`, true);
  } catch (e) {
    console.error('clone emoji failed', e?.message, e?.status);
    toast({ emoji_unavailable: "Couldn't get that emoji's picture.", too_many_emojis: 'That server is out of emoji slots.', file_too_large: 'That emoji is too big to copy (2 MB max).', not_allowed: "You can't add emojis to that server.", clone_locked: LOCK_TOAST.owner, cloning_disabled: LOCK_TOAST.server }[e.message] || errorText(e.message));
  }
}

// both right-click choices for a custom emoji: Clone emoji (to a server you manage) + Add to personal emojis (your account)
export function emojiMenuItems(emoji) {
  if (!emoji?.eid) return [];
  const signedIn = !!getState().signedIn;
  const lock = emojiLock(emoji);
  return [
    cloneMenuItem(emoji),
    signedIn && (lock ? { label: 'Add to personal emojis', icon: Lock, disabled: true, hint: LOCK_HINT[lock] }
      : { label: isPersonalEmoji(emoji.eid) ? 'In your personal emojis' : 'Add to personal emojis', icon: SmilePlus, disabled: isPersonalEmoji(emoji.eid), onClick: () => addPersonalFromEmoji(emoji) }),
  ].filter(Boolean);
}

// a menu item ("Clone emoji" with your servers as a submenu), or null when you have nowhere to put it
export function cloneMenuItem(emoji) {
  if (!emoji?.eid) return null;
  const lock = emojiLock(emoji);
  if (lock) return { label: 'Clone emoji', icon: Lock, disabled: true, hint: LOCK_HINT[lock] };
  const targets = cloneTargets();
  if (!targets.length) return { label: 'Clone emoji', icon: Copy, disabled: true, hint: 'Needs Manage server somewhere' };
  return { label: 'Clone emoji', icon: Copy, sub: targets.map(x => ({ label: x.name, icon: serverMenuIcon(x), onClick: () => cloneEmoji(emoji, x.sid) })) };
}
