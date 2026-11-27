// adding / removing a reaction and reading a reaction's name (Reactions.jsx draws them)
import { reactionBase } from './msg-actions.js';
import { timedOutIn, getState, toast, untilText, errorText } from './store.js';
import { instOf } from './ids.js';
import { serverOfInst } from './addresses.js';
import { apiFetch } from '../api.js';
import { recordReaction } from './reactionUsage.js';
import { NOOKARA_INST } from '../compat.js';
import { nameOfChar } from './emojiNames.js';
import { emojiDataSync } from './emojiData.js';

export const CUSTOM = /^<(a?):(\w+):(e[0-9a-f]{10})>$/;

export const customId = emoji => /^c:(e[0-9a-f]{10})$/.exec(emoji)?.[1] || CUSTOM.exec(emoji)?.[3];

export const stableKey = emoji => customId(emoji) ? `c:${customId(emoji)}` : emoji;

export function accountOf(inst) {
  const s = getState(), user = inst ? s.instances.find(i => i.origin === inst)?.user : s.me;
  return `${inst || NOOKARA_INST}|${user?.id || user?.username || 'anonymous'}`;
}

export function customInfo(emoji, sid, groups = getState().emojis) {
  const eid = customId(emoji);
  if (!eid) return null;
  return (groups || []).filter(s => !sid || s.sid === sid).flatMap(s => s.emojis).find(e => e.eid === eid);
}

const ERR = { too_many_reactions: 'That message has as many different reactions as it can (20).', unknown_emoji: "That emoji can't be used as a reaction." };

export async function setReaction(id, emoji, on, inst) {
  const account = accountOf(inst);
  const c = CUSTOM.exec(emoji);
  // id: a channel message id, dm:<id> for a DM, g:<room>:<id> for a group message; inst: the instance a message lives on (none = Nookara)
  const base = reactionBase(id);
  const nookaraOnly = /^(dm|g):/.test(String(id)); // these keep a custom emoji's whole token, like a DM message does
  const out = on && inst && timedOutIn((v => (v && instOf(v) === inst ? v : serverOfInst(getState().servers, inst, { communitySid: getState().instances.find(i => i.origin === inst)?.community?.sid })?.sid))(getState().view.sid)); // (the server on screen, when the homeserver has several)
  if (out) { toast(`You're timed out until ${untilText(out)} - no reactions until then.`); return; }
  try {
    await apiFetch(`${base}/reactions/${encodeURIComponent(inst ? stableKey(emoji) : c && !nookaraOnly ? c[3] : emoji)}`, { method: on ? 'PUT' : 'DELETE', inst });
    if (on) recordReaction(account, inst ? stableKey(emoji) : emoji);
    return true;
  } catch (e) { toast(ERR[e.message] || errorText(e.message)); return false; }
}

export function openReactionPicker(id, el, inst) {
  const r = el?.getBoundingClientRect ? el.getBoundingClientRect() : el;
  const rect = r && Number.isFinite(r.top) ? { top: r.top, bottom: r.bottom, right: r.right, left: r.left } : { top: 0, bottom: 0, right: innerWidth / 2, left: innerWidth / 2 };
  dispatchEvent(new CustomEvent('vc-react-pick', { detail: { id, inst, rect } }));
}

export const reactionName = (emoji, info, sid) => nameOf(emoji, info, sid);

export const nameOf = (emoji, info, sid) => { const c = CUSTOM.exec(emoji), meta = info || customInfo(emoji, sid); return customId(emoji) ? `:${meta?.name || c?.[2] || 'deleted_emoji'}:` : `:${nameOfChar(emoji, emojiDataSync()) || emoji}:`; };
