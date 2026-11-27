import { stickerLockNow, stickerLock, LOCK_HINT } from './cloneLock.js';
import { toast, getState } from './store.js';
import { LOCK_TOAST, addSticker, savePersonalSticker, isMyPersonalSticker } from './personal.js';
import { Lock, Copy, Sticker } from 'lucide-react';
import { serverMenuIcon } from './serverMenuIcon.jsx';
import { cloneTargets } from './cloneEmoji.js';
import { isInst } from './ids.js';

// s = { tid?, psid?, name, url, animated }; sid = the Ember server a server sticker belongs to (the message's server)
export const openStickerInfo = (s, sid, el) => dispatchEvent(new CustomEvent('vc-sticker-info', { detail: { s, sid: sid || null, rect: el.getBoundingClientRect() } }));

// only Ember servers have stickers
export const stickerTargets = () => cloneTargets().filter(x => isInst(x.sid));

// s, fromSid: the sticker and the server it belongs to (null for a personal one); sid: where it goes
export async function cloneSticker(s, sid, fromSid = null) {
  const lock = await stickerLockNow(s, fromSid);
  if (lock) { toast(LOCK_TOAST[lock]); return; }
  const from = new URL(s.url, location.href).href;
  try {
    const res = await fetch(from, { credentials: 'omit' });
    if (!res.ok) throw new Error('gone');
    const blob = await res.blob();
    const gif = s.animated || blob.type === 'image/gif';
    const name = String(s.name || 'sticker').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) || 'sticker';
    if (!(await addSticker(sid, new File([blob], `${name}.${gif ? 'gif' : 'png'}`, { type: blob.type || 'image/png' }), name, from))) return;
    const srv = getState().servers.find(x => x.sid === sid);
    toast(`Added ${name} to ${srv?.name || 'your server'}'s stickers.`, true);
  } catch { toast("Couldn't get that sticker's picture."); }
}

export const mine = s => !!s.psid && isMyPersonalSticker(s.psid);

// right-click: Clone to server (your Ember servers as a submenu) + Add to personal stickers. sid: the server a server sticker is from
export function stickerMenuItems(s, sid = null) {
  const targets = stickerTargets();
  const lock = stickerLock(s, sid);
  if (lock) return [
    { label: 'Clone to server', icon: Lock, disabled: true, hint: LOCK_HINT[lock] },
    getState().signedIn && { label: 'Add to personal stickers', icon: Lock, disabled: true, hint: LOCK_HINT[lock] },
  ].filter(Boolean);
  return [
    targets.length
      ? { label: 'Clone to server', icon: Copy, sub: targets.map(x => ({ label: x.name, icon: serverMenuIcon(x), onClick: () => cloneSticker(s, x.sid, sid) })) }
      : { label: 'Clone to server', icon: Copy, disabled: true, hint: 'Needs Manage server on an Ember server' },
    getState().signedIn && { label: mine(s) ? 'In your personal stickers' : 'Add to personal stickers', icon: Sticker, disabled: mine(s), onClick: () => savePersonalSticker(s, sid) },
  ].filter(Boolean);
}
