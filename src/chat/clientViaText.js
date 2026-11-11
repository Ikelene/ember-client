// Plain text for the client info shown to people with Manage users (no React, so it can be tested).
// via: { official?, kind?, name?, token?, url?, app? } from Velora (client-via.js) or an Ember server ({ url, kind? }).
// lookup = the App registry lookup (appClients.js appInfo).
import { describeVia } from './appClients.js';

export function viaLabel(via, list, fromInstance) {
  if (!via) return '';
  return describeVia(via, list, fromInstance).name;
}
export function viaTitle(via, list, fromInstance) {
  if (!via) return 'Sent from an unknown client';
  const d = describeVia(via, list, fromInstance);
  if (d.known) return `Sent from ${d.name}${d.verified ? ' (verified)' : ''}`;
  return via.url ? `Sent from ${via.url}` : 'Sent from an unknown client';
}
export const STATE_TEXT = { notifications: 'Notifications only, the app is not open', background: 'In the background' };
export const STATE_SHORT = { notifications: 'Notifications only', background: 'Background' };
export const sessionLine = s => [s.platform, s.device, s.browser && s.browser !== 'Electron' ? s.browser : null, s.version ? `v${String(s.version).slice(0, 12)}` : null].filter(Boolean).join(', ');
// the short text beside a client: the browser if it has one, else the device or platform. The rest is in sessionDetails
export const sessionShort = s => (s.browser && s.browser !== 'Electron' ? s.browser : s.device || s.platform) || '';
// which icon a client gets: 'mobile', 'desktop' (an installed app) or 'browser'. An Ember page in a phone's browser counts as mobile
export const sessionKind = s => {
  const kind = s.via?.kind;
  if (kind === 'bot') return 'bot'; // (an Ember server's bot gateway connection)
  if (s.mobile || kind === 'android' || kind === 'ios' || /^(android|ios)$/i.test(s.platform || '')) return 'mobile';
  if (kind === 'desktop' || s.browser === 'Electron') return 'desktop';
  return 'browser';
};
export const sessionIsIdle = s => !!STATE_SHORT[s.state];
// Nookara's presence sessions + the ones an Ember server reports (marked `inst`, so their verified mark needs the App's own site).
// Ember is connected to both, so an Ember server's entry that matches a Nookara one (same App, or same address when there is
// none, and the same kind of device) is the same client and is left out, one for one.
const sameClientKey = (s, lookup, fromInstance) => {
  const d = describeVia(s.via || {}, lookup, fromInstance);
  return `${d.app || d.domain || d.name}|${sessionKind(s)}`;
};
export function mergeSessions(nookara = [], instance = [], lookup = () => undefined) {
  const left = new Map();
  for (const s of nookara) { const k = sameClientKey(s, lookup, false); left.set(k, (left.get(k) || 0) + 1); }
  const out = [...nookara];
  for (const s of instance) {
    const k = sameClientKey(s, lookup, true);
    if (left.get(k) > 0) { left.set(k, left.get(k) - 1); continue; }
    out.push({ ...s, inst: true });
  }
  return out;
}
export const sessionDetails = s =>[s.app, sessionLine(s), STATE_TEXT[s.state]].filter(Boolean).join('\n');
