// the standard emoji list (loaded once) and recently used emoji, for the picker and the text renderer
import { customEmoji } from './store.js';

export let dataSync = null;
let dataP = null;

export const loadData = () => (dataP ||= fetch('/assets/emoji/emoji.json').then(r => r.json()).then(d => { dataSync = d; return d; }).catch(() => { dataP = null; return []; }));

export const loadEmojiData = loadData;

export const emojiDataSync = () => dataSync;

export const emojiToken = e => `<${e.animated ? 'a' : ''}:${e.name}:${e.eid}>`;

export const emojiUrl = customEmoji;

export function recents() { try { return JSON.parse(localStorage.getItem('nookara_chat_emoji_recent') || '[]'); } catch { return []; } }

// a custom emoji you deleted from your personal emojis leaves Recent for good (personal.js deletePersonalEmoji)
export function forgetRecent(eid) {
  try { localStorage.setItem('nookara_chat_emoji_recent', JSON.stringify(recents().filter(r => !r.c || r.c.eid !== eid))); } catch { /* fine */ }
}
