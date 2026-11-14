// Personal emojis + personal stickers (on your Nookara account, usable anywhere) and server stickers (Ember servers only).
// Personal emojis: Nookara /chat/personal-emojis (25 free / 100 Pro). Same <:name:eid> token and /uploads/emojis/<eid> picture
// as server emojis, so every client can already show them; only the owner gets them in their picker.
// Stickers: an Ember server's /api/v1/servers/:sid/stickers; a message carries one as `sticker: { tid, name, url, animated }`.
import { apiFetch, uploadFetch } from '../api.js';
import { getState, patchState, toast, errorText, customEmoji, signingInfo, askSendUnsigned } from './store.js';
import { isInst, instOf, bare } from './ids.js';
import { signMessage, refreshSigningKey } from './signing.js';
import { connections } from './instances.js';

const ERR = {
  too_many_emojis: 'You have as many personal emojis as you can (25, or 100 with Pro).',
  too_many_stickers: 'This server has as many stickers as it can (30).',
  file_too_large: 'That file is too big.',
  invalid_emoji: "That picture couldn't be read. Try a PNG, JPG, GIF or WebP.",
  images_only: 'Stickers can be PNG, GIF or WebP pictures.',
  upload_suspended: "Uploads are paused on your account.",
};
const msg = e => ERR[e?.message] || errorText(e?.message);

// ── personal emojis ──
export async function loadPersonalEmojis() {
  if (!getState().signedIn) return null;
  const d = await apiFetch('/chat/personal-emojis').catch(() => null);
  if (!d) return null;
  const urls = { ...getState().emojiUrls };
  for (const e of d.emojis || []) urls[e.eid] = e.url;
  patchState({ personalEmojis: { list: d.emojis || [], max: d.max, pro_max: d.pro_max }, emojiUrls: urls });
  return d;
}
const nameOf = n => String(n || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'emoji';
export async function addPersonalEmoji(fileOrBlob, name, { quiet = false } = {}) {
  const fd = new FormData();
  const nm = nameOf(name || fileOrBlob.name?.replace(/\.[^.]+$/, ''));
  fd.append('name', nm);
  fd.append('file', fileOrBlob, fileOrBlob.name || `${nm}.png`);
  try {
    const d = await uploadFetch('/chat/personal-emojis', fd);
    await loadPersonalEmojis();
    if (!quiet) toast(`Added :${d.emoji?.name || nm}: to your personal emojis.`, true);
    return d.emoji;
  } catch (e) { toast(msg(e)); return null; }
}
// "Add to personal emojis" on someone's emoji: its picture, as-is (GIFs stay animated)
export async function addPersonalFromEmoji(emoji) {
  try {
    const res = await fetch(new URL(customEmoji(emoji.eid, emoji.animated), location.href).href, { credentials: 'omit' });
    if (!res.ok) throw new Error('emoji_unavailable');
    const blob = await res.blob();
    return addPersonalEmoji(new File([blob], `${nameOf(emoji.name)}.${emoji.animated ? 'gif' : 'png'}`, { type: blob.type || 'image/png' }), emoji.name);
  } catch { toast("Couldn't get that emoji's picture."); return null; }
}
export async function renamePersonalEmoji(eid, name) {
  try { await apiFetch(`/chat/personal-emojis/${encodeURIComponent(eid)}`, { method: 'PATCH', body: JSON.stringify({ name: nameOf(name) }) }); }
  catch (e) { toast(msg(e)); }
  return loadPersonalEmojis();
}
export async function deletePersonalEmoji(eid) {
  try { await apiFetch(`/chat/personal-emojis/${encodeURIComponent(eid)}`, { method: 'DELETE' }); }
  catch (e) { toast(msg(e)); }
  return loadPersonalEmojis();
}
export const isPersonalEmoji = eid => !!getState().personalEmojis?.list?.some(e => e.eid === eid);

// ── server stickers (Ember servers) ──
export async function loadStickers(sid) {
  if (!sid || !isInst(sid)) return null;
  const d = await apiFetch(`/chat/servers/${sid}/stickers`).catch(() => null);
  if (d) patchState({ stickers: { ...(getState().stickers || {}), [sid]: { list: d.stickers || [], max: d.max || 30 } } });
  return d;
}
export const setStickers = (sid, list) => patchState({ stickers: { ...(getState().stickers || {}), [sid]: { ...(getState().stickers?.[sid] || { max: 30 }), list: list || [] } } });
export async function addSticker(sid, file, name) {
  const fd = new FormData();
  fd.append('name', nameOf(name || file.name?.replace(/\.[^.]+$/, '')));
  fd.append('file', file);
  let ok = true;
  try { await uploadFetch(`/chat/servers/${sid}/stickers`, fd); } catch (e) { ok = false; toast(msg(e)); }
  await loadStickers(sid);
  return ok; // (Clone to server says so when it worked)
}
export async function renameSticker(sid, tid, name) {
  try { await apiFetch(`/chat/servers/${sid}/stickers/${tid}`, { method: 'PATCH', body: JSON.stringify({ name: nameOf(name) }) }); } catch (e) { toast(msg(e)); }
  return loadStickers(sid);
}
export async function deleteSticker(sid, tid) {
  try { await apiFetch(`/chat/servers/${sid}/stickers/${tid}`, { method: 'DELETE' }); } catch (e) { toast(msg(e)); }
  return loadStickers(sid);
}
// send one: a message with only the sticker in it, signed like any other message (the signature covers the sticker id)
const SIGN_REFUSED = new Set(['bad_signature', 'signing_unavailable']);
export async function sendSticker(cid, tid, replyTo) {
  const sid = getState().view?.sid;
  const post = signature => apiFetch(`/chat/channels/${cid}/messages`, { method: 'POST', body: JSON.stringify({ message: '', sticker: tid, ...(replyTo?.id ? { reply_to: replyTo.id } : {}), ...(signature ? { signature } : {}) }) });
  try {
    let signature;
    if (sid && isInst(sid) && signingInfo(sid).can) {
      try {
        signature = await signMessage({ instance: instOf(sid), community: bare(sid), channel: bare(cid), author: connections.get(instOf(sid)).user.velora_id, body: '', attachments: [], reply_to: replyTo?.id ?? null, edit_of: null, sticker: tid });
      } catch { if (!(await askSendUnsigned())) return; }
    }
    try { await post(signature); }
    catch (e) {
      if (!signature || !SIGN_REFUSED.has(e.message)) throw e;
      if (e.message === 'bad_signature') refreshSigningKey(); // (a rotated key)
      if (await askSendUnsigned()) await post(undefined); // the server turned the signature down: the same choice as for text
    }
  } catch (e) { toast(e.message === 'unknown_sticker' ? 'That sticker is gone.' : errorText(e.message)); }
}

// ── personal stickers: Nookara /chat/personal-stickers (10 free / 50 Pro) ──
// Sent anywhere as a message whose whole text is the sticker's picture link (stickerLink.js), so nothing on the
// other end needs to know about them; Ember draws that message as a sticker.
const STK_ERR = { too_many_stickers: 'You have as many personal stickers as you can (10, or 50 with Pro).', invalid_sticker: "That picture couldn't be read. Try a PNG, JPG, GIF or WebP." };
const stkMsg = e => STK_ERR[e?.message] || msg(e);
export async function loadPersonalStickers() {
  if (!getState().signedIn) return null;
  const d = await apiFetch('/chat/personal-stickers').catch(() => null);
  if (d) patchState({ personalStickers: { list: d.stickers || [], max: d.max, pro_max: d.pro_max } });
  return d;
}
export async function addPersonalSticker(fileOrBlob, name, { quiet = false } = {}) {
  const fd = new FormData();
  const nm = nameOf(name || fileOrBlob.name?.replace(/\.[^.]+$/, '')).replace(/^emoji$/, 'sticker');
  fd.append('name', nm);
  fd.append('file', fileOrBlob, fileOrBlob.name || `${nm}.png`);
  try {
    const d = await uploadFetch('/chat/personal-stickers', fd);
    await loadPersonalStickers();
    if (!quiet) toast(`Added ${d.sticker?.name || nm} to your stickers.`, true);
    return d.sticker;
  } catch (e) { toast(stkMsg(e)); return null; }
}
// "Save to my stickers" on a sticker someone sent (a personal one or an Ember server's): its picture, as-is
export async function savePersonalSticker(s) {
  try {
    const res = await fetch(new URL(s.url, location.href).href, { credentials: 'omit' });
    if (!res.ok) throw new Error('gone');
    const blob = await res.blob();
    const gif = s.animated || /\.gif(\?|#|$)/i.test(s.url) || blob.type === 'image/gif';
    return addPersonalSticker(new File([blob], `${nameOf(s.name)}.${gif ? 'gif' : 'png'}`, { type: blob.type || 'image/png' }), s.name);
  } catch { toast("Couldn't get that sticker's picture."); return null; }
}
export async function renamePersonalSticker(psid, name) {
  try { await apiFetch(`/chat/personal-stickers/${encodeURIComponent(psid)}`, { method: 'PATCH', body: JSON.stringify({ name: nameOf(name) }) }); }
  catch (e) { toast(stkMsg(e)); }
  return loadPersonalStickers();
}
export async function deletePersonalSticker(psid) {
  try { await apiFetch(`/chat/personal-stickers/${encodeURIComponent(psid)}`, { method: 'DELETE' }); }
  catch (e) { toast(stkMsg(e)); }
  return loadPersonalStickers();
}
export const isMyPersonalSticker = psid => !!getState().personalStickers?.list?.some(s => s.sid === psid);
