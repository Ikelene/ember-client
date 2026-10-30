// Aliases (see Alias.jsx): which alias a message shows, and the name / picture to draw for it.
// the alias to show for a message, or null (only bots can post under one; the server enforces it, this is belt and braces)
export const aliasOf = m => (m && !m.system && m.author?.bot && !m.author?.webhook && m.alias?.name ? m.alias : null);
export const replyAliasOf = r => (r && r.author?.bot && r.alias?.name ? r.alias : null);
// grouping key: the same bot under two different aliases must not share a header
export const aliasKey = m => { const a = aliasOf(m); return a ? `${a.name}\n${a.avatar_url || ''}` : ''; };
// the face (name + picture) to draw for an aliased message; no avatar_url = the bot's own picture
export const aliasFace = (alias, face) => (alias ? { ...face, username: alias.name, display_name: alias.name, pfp: alias.avatar_url || face?.pfp || null, color: face?.color } : face);
// the name a message is shown under (notifications, search, pins, the reply bar)
export const shownName = (m, fallback = 'Velora') => aliasOf(m)?.name || m?.author?.username || fallback;
export const shownPfp = m => { const a = aliasOf(m); return (a && a.avatar_url) || m?.author?.pfp || null; };
