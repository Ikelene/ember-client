// Where Ember / Nookara live. Three hosts count as "home": the old velora.ikelene.net, nookara.cc (the app under /chat)
// and ember.nookara.cc (the app at its root, same backend, so API + websocket are same-origin there too).
export const EMBER_HOST = 'ember.nookara.cc';
export const NOOKARA_ORIGIN = 'https://nookara.cc';
export const EMBER_ORIGIN = `https://${EMBER_HOST}`;
export const HOME_HOSTS = [EMBER_HOST, 'nookara.cc', 'velora.ikelene.net'];
export const isHomeHost = h => HOME_HOSTS.includes(String(h || '').toLowerCase().replace(/^www\./, ''));
const here = () => { try { return location.hostname.toLowerCase(); } catch { return ''; } };
export const onEmberHost = () => here() === EMBER_HOST;
// is this page the web client (as opposed to a desktop / android shell)? /chat on the Velora-era hosts, the root on ember.nookara.cc
export const onWebClientPath = () => onEmberHost() || /^\/chat(\/|$)/.test(location.pathname);
// path the client lives at, for history.pushState and sign-in return links
export const clientPath = () => (onEmberHost() ? '/' : '/chat');
// shareable link to a view hash such as '#/s/1': always the canonical Ember host (a local dev server keeps its own origin)
export const shareLink = hash => (/^(localhost|127\.|\[::1\])/i.test(here()) ? `${location.origin}/chat${hash}` : `${EMBER_ORIGIN}/${hash}`);
// a hosted instance's address: <slug> -> https://e_<slug>.nookara.cc (older ones were <slug>.ikelene.net)
export const INSTANCE_DOMAIN = 'nookara.cc';
