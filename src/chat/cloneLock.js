// Clone locks (Nat 2026-11-14): Privacy > "Lock my emojis and stickers" (Nookara chat setting lock_emojis) and an Ember server's
// Emojis / Stickers page > "Allow cloning server emojis & stickers" (server settings emojis.allow_cloning, on by default).
// Ember hides or disables Clone / Add to personal for a locked one and says why; the servers refuse the copy anyway
// (Nookara clone-lock.js, ember-server clonelock.js: they match the picture's bytes, and every copy sends `from`, the address
// it was copied from, so the server that owns it can be asked).
import { apiFetch } from '../api.js';
import { getState } from './store.js';
import { isInst } from './ids.js';
import { P, has } from './perms.js';
import { isPersonalEmoji, isMyPersonalSticker, LOCK_TOAST } from './personal.js';

export { LOCK_TOAST };
export const LOCK_HINT = { owner: 'Locked by its owner', server: "This server doesn't allow copying" };
// a copy's origin (where its bytes were first seen) as the text after "Originally from": @user or the server's name
export const originLabel = o => (!o ? null : o.type === 'user' ? (o.username ? `@${o.username}` : 'a deleted account') : o.name || 'an Ember server');

const known = new Map(); // 'e:<eid>' / 's:<psid>' -> a personal emoji's / sticker's owner lock (from the info answers)
export const rememberLock = (key, locked) => { if (typeof locked === 'boolean') known.set(key, locked); };

const serverOf = sid => getState().servers?.find(x => x.sid === sid) || getState().detail?.[sid]?.server || null;
// its owner and people with Administrator can still copy their server's pictures
const runsIt = sid => { const s = serverOf(sid); return s?.role === 'owner' || s?.role === 'admin' || has(s?.perms ?? getState().detail?.[sid]?.server?.perms, P.ADMIN); };
function serverLocked(sid) {
  if (!sid || !isInst(sid) || runsIt(sid)) return false;
  const st = getState();
  const v = serverOf(sid)?.allow_cloning ?? st.emojis?.find(x => x.sid === sid)?.allow_cloning;
  return v === false;
}
// the Ember server a custom emoji belongs to (the one whose emoji list has it)
export const emojiServer = eid => getState().emojis?.find(sv => sv.emojis?.some(x => x.eid === eid))?.sid || null;

// what we know right now: null (free to copy) | 'owner' | 'server'
export function emojiLock(emoji) {
  if (!emoji?.eid || isPersonalEmoji(emoji.eid)) return null;
  const sid = emojiServer(emoji.eid);
  if (sid) return serverLocked(sid) ? 'server' : null;
  return known.get(`e:${emoji.eid}`) ? 'owner' : null;
}
// s = { psid?, tid?, ... }; sid = the server a server sticker belongs to
export function stickerLock(s, sid) {
  if (s?.psid) return isMyPersonalSticker(s.psid) ? null : known.get(`s:${s.psid}`) ? 'owner' : null;
  return serverLocked(sid) ? 'server' : null;
}

// before copying: asks Nookara about a personal one Ember hasn't seen the owner of yet
export async function emojiLockNow(emoji) {
  if (!emoji?.eid || isPersonalEmoji(emoji.eid) || emojiServer(emoji.eid) || known.has(`e:${emoji.eid}`)) return emojiLock(emoji);
  const x = await apiFetch(`/chat/emojis/${encodeURIComponent(emoji.eid)}/info`).catch(() => null);
  if (x?.personal) rememberLock(`e:${emoji.eid}`, !!x.personal.locked);
  return emojiLock(emoji);
}
export async function stickerLockNow(s, sid) {
  if (s?.psid && !isMyPersonalSticker(s.psid) && !known.has(`s:${s.psid}`)) {
    const x = await apiFetch(`/chat/personal-stickers/${encodeURIComponent(s.psid)}/info`).catch(() => null);
    if (x) rememberLock(`s:${s.psid}`, !!x.locked);
  }
  return stickerLock(s, sid);
}
