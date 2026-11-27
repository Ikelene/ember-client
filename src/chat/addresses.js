// Many servers on one homeserver (ember-server protocol_version 2). A server there has an address, slug@domain, next to its
// id. Here: reading what people type or paste to join one, the slug rules, the rail entries of an instance that hosts
// several servers, and the plain words for what a homeserver says when it won't make a server.
// Pure, no imports (the node tests load it).

// ── does this instance host many servers? (its discovery doc, /.well-known/ember) ──
export const isV2 = info => Number(info?.protocol_version) >= 2;
// the listed server with this id in a discovery doc (the old single `community` counts too)
export function communityOf(info, sid) {
  if (!info) return null;
  if (sid == null) return info.community || null;
  const all = [...(Array.isArray(info.communities) ? info.communities : []), info.community].filter(Boolean);
  return all.find(c => String(c.sid) === String(sid)) || null;
}

// ── slugs: 3-32 of a-z 0-9 and -, no - at either end, no -- ──
export function slugIssue(slug) {
  const s = String(slug ?? '');
  if (s.length < 3) return 'At least 3 characters.';
  if (s.length > 32) return 'At most 32 characters.';
  if (!/^[a-z0-9-]+$/.test(s)) return 'Only lowercase letters, numbers and dashes.';
  if (s.startsWith('-') || s.endsWith('-')) return "It can't start or end with a dash.";
  if (s.includes('--')) return "It can't have two dashes in a row.";
  return null;
}
export const validSlug = slug => !slugIssue(slug);
// a name -> a slug to suggest ('' when nothing usable is left)
export function slugFrom(name) {
  const s = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return validSlug(s) ? s : '';
}

// ── addresses and the invites built on them ──
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN = new RegExp(`^(?=.{1,253}(?::|$))${LABEL}(?:\\.${LABEL})+(?::\\d{1,5})?$`);
const CODE = /^[A-Za-z0-9_-]{1,64}$/;
const cleanDomain = d => { const s = String(d ?? '').trim().toLowerCase(); return DOMAIN.test(s) ? s : ''; };
export const addressOf = (slug, domain) => `${slug}@${domain}`;
function build(slug, domain, code) {
  slug = String(slug ?? '').toLowerCase();
  domain = cleanDomain(domain);
  if (!validSlug(slug) || !domain) return null;
  if (code != null && code !== '' && !CODE.test(code)) return null;
  return { slug, domain, address: addressOf(slug, domain), code: code || null };
}
// 'slug@domain' | 'slug@domain/code' | 'https://domain/i/slug/code' (| '#/i/slug@domain/code', and that inside a link)
// -> { slug, domain, address, code | null }, or null when it is none of those (an old invite, a server address, a typo)
export function parseAddress(input) {
  let s = String(input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  const hash = /#\/i\/([^/]+)(?:\/([^/?#]*))?\/?$/.exec(s); // Ember's own link to one
  if (hash) {
    let who = hash[1];
    try { who = decodeURIComponent(who); } catch { return null; }
    if (!who.includes('@') || /^https?:/i.test(who)) return null; // (#/i/<instance origin>/... is the old form)
    s = hash[2] ? `${who}/${hash[2]}` : who;
  }
  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
    const m = /^\/i\/([^/]+)\/([^/]+)\/?$/.exec(u.pathname);
    return m ? build(m[1], u.host, m[2]) : null;
  }
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@')) return null;
  const rest = s.slice(at + 1).replace(/\/+$/, '');
  const cut = rest.indexOf('/');
  if (cut < 0) return build(s.slice(0, at), rest, null);
  const code = rest.slice(cut + 1);
  return code ? build(s.slice(0, at), rest.slice(0, cut), code) : null;
}
// the #/ route of an address invite (store.js hashFor / readHash)
export const addressHash = ({ slug, domain, code }) => `#/i/${slug}@${domain}${code ? `/${code}` : ''}`;

// ── invite links any client can open (the homeserver's own page lists the apps that open them) ──
// where a homeserver's invite links start: its discovery doc's invites.url_base, else https://<domain>/i/
export function inviteBase(domain, invites) {
  const b = typeof invites?.url_base === 'string' ? invites.url_base.trim() : '';
  let u = null;
  try { u = b ? new URL(b) : null; } catch { u = null; }
  if (u && /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.search && !u.hash) return u.href.endsWith('/') ? u.href : `${u.href}/`;
  return `https://${domain}/i/`;
}
// the link to share for an invite to slug@domain (invites: that homeserver's discovery doc block, when known)
export const inviteUrl = ({ slug, domain, code }, invites) => `${inviteBase(domain, invites)}${slug}/${code}`;
// an invite link on any host, also one whose url_base isn't on the homeserver's domain (http://localhost:4102/i/cabin/abc):
// -> { slug, code, origin } (origin: where to ask /.well-known/ember who the homeserver is), or null
export function parseInviteUrl(input) {
  const s = String(input ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  const m = /^(?:\/[^/]+)*\/i\/([^/]+)\/([^/]+)\/?$/.exec(u.pathname);
  if (!m) return null;
  const slug = m[1].toLowerCase(), code = m[2];
  if (!validSlug(slug) || !CODE.test(code)) return null;
  return { slug, code, origin: u.origin };
}
// web+ember:invite?address=slug@domain&code=X, as the browser hands it over (the protocol handler opens #/open?u=<it>)
// -> { slug, domain, address, code | null } or null
export function parseProtocolLink(input) {
  const s = String(input ?? '').trim();
  const m = /^web\+ember:(?:\/\/)?([a-z]+)\/?(?:\?(.*))?$/i.exec(s);
  if (!m || m[1].toLowerCase() !== 'invite') return null;
  const q = new URLSearchParams(m[2] || '');
  const a = parseAddress(q.get('address') || '');
  if (!a) return null;
  const code = q.get('code') || a.code;
  return code ? build(a.slug, a.domain, code) : a;
}
// #/open?u=<link>: the link (or null)
export function openRouteLink(hash) {
  const m = /^#\/open\?(.*)$/.exec(String(hash ?? ''));
  return m ? new URLSearchParams(m[1]).get('u') : null;
}

// ── what a homeserver says when it won't make or rename a server ──
export function createErrorText(e) {
  const code = typeof e === 'string' ? e : e?.error || e?.message || '';
  const limit = Number(e?.limit);
  switch (code) {
    case 'creation_requires_approval': return 'This homeserver only lets admins create servers.';
    case 'creation_limit': return Number.isFinite(limit) && limit >= 0 ? `You've reached this homeserver's limit of ${limit} server${limit === 1 ? '' : 's'}.` : "You've reached this homeserver's limit of servers.";
    case 'slug_taken': return 'That address is already taken on this homeserver.';
    case 'invalid_slug': return "That address won't work: 3-32 lowercase letters, numbers and dashes.";
    case 'forbidden': return "You're not allowed to do that on this homeserver.";
    case 'server_not_found': return "There's no server with that address.";
    case 'wrong_homeserver': return "That server isn't on this homeserver.";
    case 'not_found': return "This homeserver can't do that yet - it needs an update.";
    case 'instance_unreachable': case 'unreachable': return "Couldn't reach that homeserver.";
    case 'not_an_instance': case 'not_found_domain': return "There's no Ember homeserver at that address.";
    default: return "That didn't work - try again in a bit.";
  }
}

// ── the rail ──
// One entry per server I'm in. An instance with one server (or none yet) is one entry with the id it always had,
// `i:<origin>`. Only an instance that hosts many (protocol_version 2) AND has me in more than one gets an entry per
// server, `i:<origin>|<sid>` (the server's own key, so nothing else needs a new id).
// instances: [{ origin, v2 }], servers: [{ sid: 'origin|id', inst }] -> [{ id, inst, server | null }]
export function railEntries(instances, servers) {
  const out = [];
  for (const inst of instances || []) {
    const mine = (servers || []).filter(s => s.inst === inst.origin);
    if (inst.quiet && !mine.length) continue; // (only there for my account or a DM: nothing to show until I'm in a server on it)
    if (inst.v2 && mine.length > 1) for (const server of mine) out.push({ id: `i:${server.sid}`, inst, server });
    else out.push({ id: `i:${inst.origin}`, inst, server: mine[0] || null });
  }
  return out;
}
// the instance a rail id belongs to ('i:<origin>' or 'i:<origin>|<sid>'), null for a Nookara-hosted one ('v:<sid>')
export function railOrigin(id) {
  if (!String(id).startsWith('i:')) return null;
  const k = String(id).slice(2), i = k.indexOf('|');
  return i > 0 ? k.slice(0, i) : k;
}
// where a rail id sits in a saved order: its own place, else its instance's (a second server joined there lands next to the
// first, and going back to one server keeps the place), else -1
export function railPos(order, id) {
  const list = order || [];
  const at = list.indexOf(id);
  if (at >= 0) return at;
  const origin = railOrigin(id);
  if (!origin) return -1;
  return list.findIndex(x => railOrigin(x) === origin);
}
