// Plain text for the client info Velora shows to people with Manage users (no React, so it can be tested).
// via: { official, kind, name, token, url }
export function viaLabel(via) {
  if (!via) return '';
  if (via.official) return via.name || 'Ember';
  if (via.token) return via.token;
  if (via.url) return via.url.replace(/^https?:\/\//, '');
  return 'Unknown client';
}
export const viaTitle = via => (via?.official ? 'Sent from the official Ember client' : via?.token ? `Sent with the sign-in token "${via.token}"${via.url ? ` from ${via.url}` : ''}` : via?.url ? `Sent from ${via.url}` : 'Sent from an unknown client');
export const STATE_TEXT = { notifications: 'Notifications only, the app is not open', background: 'In the background' };
export const sessionLine = s => [s.platform, s.device, s.browser && s.browser !== 'Electron' ? s.browser : null, s.version ? `v${String(s.version).slice(0, 12)}` : null].filter(Boolean).join(', ');
