// Short share links on ember.nookara.cc (Nat 2026-11-09: "can we make invite links simpler and shorter?"):
//   /invite/<code>                    a Nookara server's invite        = #/invite/<code>
//   /invite/<server address>/<code>   an Ember server's invite         = #/i/https%3A%2F%2F<address>/invite/<code>
//   /server/<server address>          an Ember server                  = #/i/https%3A%2F%2F<address>
// The website serves Ember's page for these paths (ember-host.js SHORT_LINK); on load Ember swaps the path for its #/ route.
// Only https servers get a short link (an http:// dev server keeps the long #/i/ form). No React, so it can be tested.
import { EMBER_ORIGIN } from './hosts.js';

const HOST = '[a-z0-9.-]{1,253}(?::\\d{1,5})?';
const INVITE = new RegExp(`^/invite/(?:(${HOST})/)?([A-Za-z0-9_-]{1,64})/?$`, 'i');
const SERVER = new RegExp(`^/server/(${HOST})/?$`, 'i');
const instOrigin = host => `https://${host.toLowerCase()}`;

// a path like /invite/... -> the #/ route it stands for, or null
export function shortLinkHash(pathname) {
  const p = String(pathname || '');
  let m = INVITE.exec(p);
  if (m) return m[1] ? `#/i/${encodeURIComponent(instOrigin(m[1]))}/invite/${m[2]}` : `#/invite/${m[2]}`;
  m = SERVER.exec(p);
  if (m) return `#/i/${encodeURIComponent(instOrigin(m[1]))}`;
  return null;
}

// the https host of an instance origin ('https://chat.ikelene.net' -> 'chat.ikelene.net'), or null
function hostOf(inst) {
  try { const u = new URL(inst); return u.protocol === 'https:' && !u.pathname.replace(/\/$/, '') ? u.host.toLowerCase() : null; } catch { return null; }
}

// the short link for a view, or null when it has none: { kind: 'invite', code, inst? } / { kind: 'instance', inst }
export function shortLinkFor(v, base = EMBER_ORIGIN) {
  if (!v) return null;
  if (v.kind === 'invite' && /^[A-Za-z0-9_-]{1,64}$/.test(String(v.code || ''))) {
    if (!v.inst || v.inst === 'velora') return `${base}/invite/${v.code}`;
    const h = hostOf(v.inst);
    return h ? `${base}/invite/${h}/${v.code}` : null;
  }
  if (v.kind === 'instance') { const h = hostOf(v.inst); return h ? `${base}/server/${h}` : null; }
  return null;
}
