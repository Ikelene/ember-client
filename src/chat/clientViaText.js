// Plain text for the client info shown to people with Manage users (no React, so it can be tested).
// via: { official?, kind?, name?, token?, url?, app? } from Velora (client-via.js) or an Ember server ({ url, kind? }).
// list = Velora's official clients (officialClients.js); null/undefined = not loaded yet.
import { describeVia } from './officialClients.js';

export function viaLabel(via, list) {
  if (!via) return '';
  return describeVia(via, list).name;
}
export function viaTitle(via, list) {
  if (!via) return 'Sent from an unknown client';
  const d = describeVia(via, list);
  if (d.known) return `Sent from ${d.name}${d.verified ? ' (official)' : ''}`;
  if (via.token) return `Sent with the sign-in token "${via.token}"${via.url ? ` from ${via.url}` : ''}`;
  return via.url ? `Sent from ${via.url}` : 'Sent from an unknown client';
}
export const STATE_TEXT = { notifications: 'Notifications only, the app is not open', background: 'In the background' };
export const sessionLine = s => [s.platform, s.device, s.browser && s.browser !== 'Electron' ? s.browser : null, s.version ? `v${String(s.version).slice(0, 12)}` : null].filter(Boolean).join(', ');
