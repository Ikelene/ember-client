// Discovery, grouped by homeserver. Nookara's directory answers GET /directory?group=homeserver with
//   [ { homeserver: { domain, name, url, icon_url? }, communities: [ { sid, slug, address, name, icon_url, description, member_count, join_policy, invite_url, tags } ] } ]
// An older Nookara ignores `group` (or 404s) and answers as it always did, { results: [ { id, url, name, ... } ], page, has_more }:
// then the servers are grouped here, by the host of each one's address. Everything in a listing is untrusted text.
// Pure, no imports (the node tests load it).

export const FIRST_DOMAIN = 'nookara.cc'; // its section comes first
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hostOf = url => { try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`); return /^https?:$/.test(u.protocol) ? u.host.toLowerCase() : ''; } catch { return ''; } };
const originOf = url => { try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin : ''; } catch { return ''; } };

// one server, as a card shows it
function card(c, hs) {
  const slug = str(c.slug, 64), address = str(c.address, 320) || (slug && hs.domain ? `${slug}@${hs.domain}` : '');
  return {
    key: `${hs.domain}/${c.sid ?? c.id ?? (address || c.name)}`,
    sid: c.sid != null ? String(c.sid) : null, slug, address,
    url: originOf(c.url || hs.url), // where it lives (the homeserver's origin)
    name: str(c.name, 100) || address || hs.domain, description: str(c.description, 500),
    icon_url: str(c.icon_url, 2000), banner_url: str(c.banner_url, 2000), invite_url: str(c.invite_url, 2000),
    tags: (Array.isArray(c.tags) ? c.tags : []).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 24)).slice(0, 8),
    member_count: Math.max(0, Number(c.member_count) || 0), join_policy: str(c.join_policy, 20) || null, trusted: !!c.trusted, verified: c.verified === true,
  };
}
// verified: Nookara's staff list (the group's / entry's top-level `verified`; homeserver.verified means only that its delegation checked out)
const section = (hs, communities) => ({ domain: hs.domain, name: hs.name || hs.domain, url: hs.url, icon_url: hs.icon_url || '', verified: !!hs.verified, communities });

// is this the grouped answer? (an array, or { groups: [...] }, of { homeserver, communities })
const groupsIn = d => (Array.isArray(d) ? d : Array.isArray(d?.groups) ? d.groups : null);
export const isGrouped = d => { const g = groupsIn(d); return !!g && g.every(x => x && typeof x === 'object' && x.homeserver && typeof x.homeserver === 'object' && Array.isArray(x.communities)); };

// the grouped answer -> sections
export function fromGrouped(d) {
  const out = [];
  for (const g of groupsIn(d) || []) {
    const url = originOf(g.homeserver.url || g.homeserver.domain);
    const domain = str(g.homeserver.domain, 253).toLowerCase() || hostOf(url);
    if (!domain) continue;
    const hs = { domain, name: str(g.homeserver.name, 100), url: url || originOf(domain), icon_url: str(g.homeserver.icon_url, 2000), verified: g.verified === true };
    out.push(section(hs, g.communities.filter(c => c && typeof c === 'object').map(c => card(c, hs))));
  }
  return out;
}
// the old flat answer's results -> sections, one per host
export function groupFlat(results) {
  const by = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r !== 'object') continue;
    const url = originOf(r.url), domain = hostOf(r.url);
    if (!domain) continue;
    if (!by.has(domain)) by.set(domain, { hs: { domain, name: '', url, icon_url: '' }, list: [] });
    by.get(domain).list.push(card({ ...r, sid: r.sid ?? null, id: r.id }, by.get(domain).hs));
  }
  return [...by.values()].map(({ hs, list }) => section(hs, list));
}
// either answer -> { groups, has_more, page, grouped }
export function readDirectory(d) {
  if (isGrouped(d)) return { groups: sortGroups(fromGrouped(d)), has_more: !Array.isArray(d) && !!d.has_more, page: (!Array.isArray(d) && Number(d.page)) || 1, grouped: true };
  return { groups: sortGroups(groupFlat(d?.results)), has_more: !!d?.has_more, page: Number(d?.page) || 1, grouped: false };
}

// nookara.cc first, then the biggest: most members, then most servers, then by name. Inside a section the biggest server first.
const members = g => g.communities.reduce((n, c) => n + c.member_count, 0);
export function sortGroups(groups) {
  return groups.filter(g => g.communities.length).map(g => ({ ...g, communities: [...g.communities].sort((a, b) => b.member_count - a.member_count || a.name.localeCompare(b.name)) }))
    .sort((a, b) => (b.domain === FIRST_DOMAIN) - (a.domain === FIRST_DOMAIN) || members(b) - members(a) || b.communities.length - a.communities.length || a.domain.localeCompare(b.domain));
}
// the next page of a flat listing, added to what is shown (the same homeserver's servers stay in one section)
export function mergeGroups(a, b) {
  const by = new Map();
  for (const g of [...a, ...b]) {
    const cur = by.get(g.domain);
    if (!cur) { by.set(g.domain, { ...g, communities: [...g.communities] }); continue; }
    const seen = new Set(cur.communities.map(c => c.key));
    cur.communities.push(...g.communities.filter(c => !seen.has(c.key)));
  }
  return sortGroups([...by.values()]);
}
// the search box, over every section: name, description, address, tags, and the homeserver's own name / domain
export function filterGroups(groups, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  const hit = (text, w) => text.includes(w);
  return groups.map(g => {
    const head = `${g.name} ${g.domain}`.toLowerCase();
    return { ...g, communities: g.communities.filter(c => { const t = `${c.name} ${c.description} ${c.address} ${c.tags.join(' ')}`.toLowerCase(); return words.every(w => hit(t, w) || hit(head, w)); }) };
  }).filter(g => g.communities.length);
}

// fetchJson(url) -> the parsed answer, or throws { status }. Asks for the grouped listing; a 404 (or any failure there) asks
// the old way. -> readDirectory's shape
export async function loadDirectory(fetchJson, base, { q = '', page = 1 } = {}) {
  const query = `q=${encodeURIComponent(q)}&page=${page}`;
  let d = null;
  try { d = await fetchJson(`${base}/directory?group=homeserver&${query}`); } catch { d = null; }
  if (!isGrouped(d) && !Array.isArray(d?.results)) d = await fetchJson(`${base}/directory?${query}`);
  return readDirectory(d);
}
