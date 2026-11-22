// Emojis in bios (Ikelene 2026-11-21): a custom emoji is stored as the same token messages use (<:name:eid> / <a:name:eid>),
// so it shows for everyone, not only its owner. A token counts as ONE character toward the bio limit, and a bio holds at
// most BIO_EMOJI_MAX of them (10 x the longest token + 500 still fits the VARCHAR(1000) column). Nookara checks the same rule (routes/account.js bioLength), so keep the two in step.
export const BIO_EMOJI_MAX = 10;
const TOKEN = /<a?:[A-Za-z0-9_]{1,32}:e[0-9a-f]{10}>/g;
export const bioEmojiCount = s => (String(s || '').match(TOKEN) || []).length;
export const bioLength = s => String(s || '').replace(TOKEN, '*').length;
