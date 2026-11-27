import { plainText } from './tokens.js';
import { instOf, NOOKARA } from './ids.js';
import { stickerOfBody } from './stickerLink.js';

// a message body as one plain line: custom emoji / mentions / links made readable, markdown marks dropped
export function snippet(body, sid = null) {
  let t = plainText(body, sid ? instOf(sid) : NOOKARA, sid);
  if (!t.trim()) return '';
  const st = stickerOfBody(t); // a personal sticker (stickerLink.js)
  if (st) return `Sticker: ${st.name}`;
  t = t.replace(/<a?:(\w+):\w+>/g, ':$1:').replace(/<@&\w+>/g, '@role').replace(/<#\w+>/g, '#channel').replace(/<t:(\d+)(:\w)?>/g, (m, s) => new Date(Number(s) * 1000).toLocaleString());
  t = t.replace(/https?:\/\/(files\.|litter\.)?catbox\.moe\/\S+/g, '[file]').replace(/https?:\/\/\S+/g, u => { try { return new URL(u).host; } catch { return u; } });
  t = t.replace(/^(#{1,3}|-#|>>>|>)\s+/gm, '').replace(/(\*\*|__|~~|\|\||`)/g, '').replace(/\s+/g, ' ').trim();
  return t;
}
