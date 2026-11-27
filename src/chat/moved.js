// Servers that moved off Nookara's hosting (https://e-<slug>.nookara.cc) onto a homeserver: the homeserver lists the old origin in
// its discovery's previous_urls (PROTOCOL §3, §5a "Moving a server here"), and keeps the server's slug and main invite code.
// Old links (#/i/<old origin>/invite/<code>, #/i/<old origin>, #/i/<old origin>/s/...) find that homeserver and open the server
// by its address instead.
const HOSTED = /^https:\/\/e-([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.nookara\.cc$/i;
export const hostedSlug = origin => HOSTED.exec(String(origin || ''))?.[1]?.toLowerCase() || null;

const docs = new Map(); // origin -> Promise<discovery doc | null>, for this page's life
function discovery(origin) {
  if (!docs.has(origin)) {
    docs.set(origin, fetch(`${origin}/.well-known/ember`, { headers: { Accept: 'application/json' }, credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null)).then(d => (d && typeof d === 'object' ? d : null)).catch(() => null));
  }
  return docs.get(origin);
}
const clean = u => { try { return new URL(u).origin.toLowerCase(); } catch { return null; } };
const domainOf = (d, origin) => (typeof d?.homeserver?.domain === 'string' && d.homeserver.domain) || (typeof d?.domain === 'string' && d.domain) || new URL(origin).host;

// old: the old origin; known: [{ origin, previousUrls? }] the homeservers this device knows (connected ones with their discovery
// already read, then signed-in ones to ask). -> { origin, domain } | null
export async function movedHome(old, known) {
  const o = clean(old);
  if (!o) return null;
  for (const k of known) if ((k.previousUrls || []).map(clean).includes(o)) return { origin: k.origin, domain: k.domain || new URL(k.origin).host };
  for (const k of known) {
    if (k.previousUrls) continue; // (asked already: its discovery is what previousUrls came from)
    const d = await discovery(k.origin);
    if (Array.isArray(d?.previous_urls) && d.previous_urls.map(clean).includes(o)) return { origin: k.origin, domain: domainOf(d, k.origin) };
  }
  return null;
}
