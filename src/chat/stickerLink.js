// Personal stickers (Nookara personal-stickers.js) travel as a message whose whole text is the sticker's picture link:
//   https://nookara.cc/uploads/stickers/<sid>.png#<name>   (.gif when animated)
// Every app already shows that as a picture; Ember draws it as a sticker. Works in DMs, groups and on any Ember server.
export const STICKER_LINK = /^https:\/\/(?:(?:cdn\.)?nookara\.cc|velora\.ikelene\.net)\/uploads\/stickers\/(s[0-9a-f]{10})\.(png|gif)(?:#(\w{1,32}))?$/;

// the whole body -> { psid, name, url, animated } or null
export function stickerOfBody(body) {
  const t = String(body || '').trim();
  const m = STICKER_LINK.exec(t);
  if (!m) return null;
  return { psid: m[1], name: m[3] || 'sticker', url: t.split('#')[0], animated: m[2] === 'gif' };
}
