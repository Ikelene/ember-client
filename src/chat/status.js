// Deep links into the public status page (ikelene.net/status). ?s=<id> opens and highlights that category or service.
export const STATUS_PAGE = 'https://ikelene.net/status/';
export const statusUrl = id => `${STATUS_PAGE}?s=${encodeURIComponent(id || 'ember')}`;
// status id for an Ember server address: hosted ones (e-<slug>.nookara.cc, older e_<slug>) are "ember-hosted", anything else of Nookara's
// (nookara.cc, ikelene.net and their subdomains) is "ember". A third-party instance isn't on our page at all -> null (no link).
export function statusIdForHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (/^e[-_][a-z0-9-]+\.nookara\.cc$/.test(h)) return 'ember-hosted';
  if (h === 'nookara.cc' || h.endsWith('.nookara.cc') || h === 'ikelene.net' || h.endsWith('.ikelene.net')) return 'ember';
  return null;
}
