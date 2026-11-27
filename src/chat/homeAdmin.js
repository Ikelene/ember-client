// A homeserver's account settings, as its admins edit them (PROTOCOL §4a: GET / PATCH /api/v2/homeserver/accounts), and the
// sign-in methods of your own account there (GET /api/v2/account/logins). Pure: nothing from the browser.
import { RATE_FIELDS, FLOOR_MAX, DAYS_MAX, MAX_DENYLISTS, MAX_DENY } from './federation.js';

export const REGISTRATION = [
  ['open', 'Open', 'Anyone can make an account.'],
  ['closed', 'Closed', 'Nobody new can make an account.'],
  ['invite', 'Invite only', 'New accounts need an invite code an admin made (below).'],
  ['approval', 'Approval', 'Anyone can ask; the account waits until an admin approves it (below).'],
];
export const REMOTE_MODES = [
  ['none', 'Nobody', 'Only accounts made here.'],
  ['all', 'Everyone', 'Accounts from every other homeserver.'],
  ['allowlist', 'Only these', 'Accounts from the homeservers on the list.'],
  ['blocklist', 'Everyone except these', 'Accounts from every homeserver except the ones on the list.'],
];
export const CREATION_MODES = [
  ['admins', 'Admins only', "Only the homeserver's admins can create servers."],
  ['allowlist', 'Chosen people', 'Admins, and the accounts on the list.'],
  ['request', 'On request', 'People ask for a server, and an admin approves it (the queue is below).'],
  ['anyone', 'Anyone', 'Every account here can create servers.'],
];

// ── presets ──
// what "Add a sign-in method" offers. id: the method id it starts with; fields a preset fixes are filled in and left alone
export const PRESETS = [
  { key: 'password', label: 'Password', hint: 'A username and password kept on this homeserver.', method: { id: 'password', kind: 'password', name: 'Password' } },
  { key: 'nookara', label: 'Sign in with Nookara', hint: 'People use their nookara.cc account.', method: { id: 'nookara', kind: 'nookara', name: 'Nookara', issuer: 'https://nookara.cc' } },
  { key: 'google', label: 'Google', hint: 'OpenID Connect with Google accounts.', method: { id: 'google', kind: 'oidc', name: 'Google', issuer: 'https://accounts.google.com', scopes: 'openid profile email' } },
  { key: 'microsoft', label: 'Microsoft', hint: 'OpenID Connect with Microsoft accounts.', method: { id: 'microsoft', kind: 'oidc', name: 'Microsoft', issuer: 'https://login.microsoftonline.com/common/v2.0', scopes: 'openid profile email' } },
  { key: 'github', label: 'GitHub', hint: 'OAuth 2.0 with GitHub accounts.', method: { id: 'github', kind: 'oauth2', name: 'GitHub', authorize_url: 'https://github.com/login/oauth/authorize', token_url: 'https://github.com/login/oauth/access_token', userinfo_url: 'https://api.github.com/user', scopes: 'read:user user:email', id_field: 'id', username_field: 'login' } },
  { key: 'discord', label: 'Discord', hint: 'OAuth 2.0 with Discord accounts.', method: { id: 'discord', kind: 'oauth2', name: 'Discord', authorize_url: 'https://discord.com/oauth2/authorize', token_url: 'https://discord.com/api/oauth2/token', userinfo_url: 'https://discord.com/api/users/@me', scopes: 'identify email', id_field: 'id', username_field: 'username' } },
  { key: 'oidc', label: 'Custom OpenID Connect', hint: 'Any provider with an issuer address.', method: { id: 'sso', kind: 'oidc', name: 'Single sign-on', issuer: '', scopes: 'openid profile email' } },
  { key: 'oauth2', label: 'Custom OAuth 2.0', hint: 'Any provider: you fill in its three addresses.', method: { id: 'oauth', kind: 'oauth2', name: 'Single sign-on', authorize_url: '', token_url: '', userinfo_url: '', scopes: '', id_field: 'id', username_field: '' } },
];
export const KIND_LABEL = { password: 'Password', oidc: 'OpenID Connect', oauth2: 'OAuth 2.0', nookara: 'Nookara' };
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const validId = id => ID.test(String(id || ''));
// base, base-2, base-3... the first one no method has yet
export function uniqueId(base, methods = []) {
  const taken = new Set(methods.map(m => m.id));
  const b = String(base || 'method').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 28) || 'method';
  if (!taken.has(b)) return b;
  for (let n = 2; ; n++) if (!taken.has(`${b}-${n}`)) return `${b}-${n}`;
}
// a new method from a preset, ready for the editor. null: there is a password method already (one at most)
export function presetMethod(key, methods = []) {
  const p = PRESETS.find(x => x.key === key);
  if (!p) return null;
  if (p.method.kind === 'password' && methods.some(m => m.kind === 'password')) return null;
  const m = { ...p.method, id: uniqueId(p.method.id, methods), enabled: true };
  if (m.kind !== 'password') { m.client_id = ''; m.client_secret = ''; }
  return m;
}
// which preset a stored method looks like (for its icon / label), by what the preset fixes
export function presetOf(m) {
  if (!m) return null;
  if (m.kind === 'password' || m.kind === 'nookara') return m.kind;
  const strip = u => String(u || '').replace(/\/+$/, '');
  const hit = PRESETS.find(p => p.method.kind === m.kind && (m.kind === 'oidc' ? p.method.issuer && strip(p.method.issuer) === strip(m.issuer) : p.method.authorize_url && strip(p.method.authorize_url) === strip(m.authorize_url)));
  return hit ? hit.key : m.kind;
}

// ── secrets ──
// a client secret reads back as eight stars and its last four characters, or null when there is none
export const isMasked = t => /^\*{8}.{0,4}$/.test(String(t || ''));
export const hasSecret = m => isMasked(m?.client_secret);
// what goes in the PATCH for a method's secret. typed: what is in the box; '' or the masked value = keep the stored one
// (the server keeps it for an empty one), anything else replaces it
export function secretToSend(typed) {
  const t = typeof typed === 'string' ? typed.trim() : '';
  return !t || isMasked(t) ? '' : t;
}
// (the server has no "forget this secret": a stored one only goes when its method does)

// ── what is sent ──
const URLS = ['authorize_url', 'token_url', 'userinfo_url'];
const FIELDS = ['id_field', 'username_field', 'email_field', 'email_verified_field'];
const text = v => (typeof v === 'string' ? v.trim() : '');
// one method as the PATCH wants it: nothing the server works out itself (callback_url, an issuer's endpoints)
export function methodToSend(m) {
  const out = { id: text(m.id).toLowerCase(), kind: m.kind, name: text(m.name), enabled: m.enabled !== false };
  if (m.kind === 'password') return out;
  out.client_id = text(m.client_id);
  out.client_secret = secretToSend(m.client_secret);
  if (m.kind === 'oidc') out.issuer = text(m.issuer).replace(/\/+$/, '');
  if (m.kind === 'oauth2') for (const k of URLS) out[k] = text(m[k]);
  if (m.kind !== 'nookara' && text(m.scopes)) out.scopes = text(m.scopes).split(/\s+/).join(' ');
  for (const k of FIELDS) if ((k !== 'id_field' || m.kind === 'oauth2') && text(m[k])) out[k] = text(m[k]);
  if (m.token_auth === 'basic' || m.token_auth === 'post') out.token_auth = m.token_auth;
  if (m.pkce === false) out.pkce = false;
  return out;
}
export const methodsToSend = list => (list || []).map(methodToSend);
const httpsUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && !x.hash; } catch { return false; } };
// what is wrong with a method before it is sent: { field: words }, empty when it can go
export function methodIssues(m, others = []) {
  const bad = {};
  const id = text(m.id).toLowerCase();
  if (!validId(id)) bad.id = 'Use 1-32 of a-z, 0-9, - and _, starting with a letter or number.';
  else if (others.some(x => x !== m && x.id === id)) bad.id = 'Another sign-in method has this id.';
  if (m.kind === 'password') return bad;
  if (m.enabled !== false && !text(m.client_id)) bad.client_id = "The client id the provider gave you.";
  if (m.kind === 'oidc' && !httpsUrl(text(m.issuer))) bad.issuer = 'An https address, like https://id.example.';
  if (m.kind === 'oauth2') for (const k of URLS) if (!httpsUrl(text(m[k]))) bad[k] = 'An https address.';
  return bad;
}
// has the form moved away from what the server holds?
export const sameMethods = (a, b) => JSON.stringify(methodsToSend(a)) === JSON.stringify(methodsToSend(b));

// the address a provider sends people back to: registered with the provider, one per method
export function callbackUrl(publicUrl, id) {
  const base = String(publicUrl || '').replace(/\/+$/, '');
  return base && id ? `${base}/login/callback/${encodeURIComponent(id)}` : '';
}
// one homeserver per line (or commas / spaces) -> a clean list, lower case, no repeats
export const hostList = raw => [...new Set(String(raw || '').split(/[\s,]+/).map(x => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean))];
export const nameList = raw => [...new Set(String(raw || '').split(/[\s,]+/).map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];

// ── errors ──
const FIELD_WORDS = { id: 'id', kind: 'kind', issuer: 'issuer address', authorize_url: 'authorize address', token_url: 'token address', userinfo_url: 'user info address', jwks_url: 'keys address', client_id: 'client id', client_secret: 'client secret', scopes: 'scopes', id_field: 'id field', username_field: 'username field', email_field: 'email field', email_verified_field: 'verified-email field', token_auth: 'client secret setting' };
const RATE_WORDS = Object.fromEntries(RATE_FIELDS.map(([k, label]) => [k, label.toLowerCase()]));
const of = (e, methods) => { const m = e?.method && (methods || []).find(x => x.id === e.method); return m ? `"${m.name || m.id}"` : e?.method ? `"${e.method}"` : ''; };
// a refused save (an Error from apiFetch: message = the code, plus the server's method / field / message) in plain words
export function adminErrorText(e, methods) {
  const code = typeof e === 'string' ? e : e?.error || e?.message || '';
  const who = of(e, methods), field = FIELD_WORDS[e?.field] || '';
  switch (code) {
    case 'invalid_issuer': return `Couldn't read the sign-in details${who ? ` for ${who}` : ''} from its issuer address. Check the address${e?.message && e.message !== code && typeof e.message === 'string' && e.error ? ` (${e.message})` : ''}, or switch the method off to save it anyway.`;
    case 'invalid_method_url': return `${who ? `${who}: the` : 'The'} ${field || 'address'} has to be an https address with no username or password in it.`;
    case 'invalid_login_methods': return e?.field === 'id' ? `${who ? `${who}: that` : 'That'} id is taken or isn't allowed. Ids are 1-32 of a-z, 0-9, - and _.` : field ? `${who ? `${who}: the` : 'The'} ${field} isn't valid.` : "One of the sign-in methods isn't valid.";
    case 'no_login_method': return 'Keep at least one sign-in method switched on, or nobody could sign in.';
    case 'invalid_registration': return "That isn't a way to register this homeserver knows.";
    case 'invalid_remote_accounts': return 'The list of homeservers has something that is not a domain. Use example.org, or *.example.org for every name under it.';
    case 'invalid_rate_limits': return RATE_WORDS[e?.field] ? `The "${RATE_WORDS[e.field]}" limit is out of range.` : "One of the limits for other homeservers isn't valid.";
    case 'invalid_min_age_floor_days': return `New homeservers can be made to wait 0 to ${FLOOR_MAX} days.`;
    case 'invalid_denylists': return `Deny lists are https addresses, at most ${MAX_DENYLISTS} of them.`;
    case 'invalid_deny': return `Blocked entries are a domain, *.domain, an IP range or an account (id@domain), at most ${MAX_DENY.toLocaleString('en')}.`;
    case 'invalid_federation': case 'invalid_remote_invite_bypass': return "The homeserver didn't understand that setting.";
    case 'invalid_remote_min_age_days': return `New homeservers can be made to wait 0 to ${DAYS_MAX} days.`;
    case 'invalid_hosts_accounts': case 'invalid_accounts': case 'invalid_link_verified_emails': return "The homeserver didn't understand that setting.";
    case 'invalid_ember_clients': return 'One of the client addresses is not a web address.';
    case 'local_admin_required': return 'Make an admin account on this homeserver first: after the switch somebody has to be able to sign in.';
    case 'managed_setting': return "Nookara hosts this homeserver, so that setting can't be changed.";
    case 'invalid_creation': return "The server creation settings aren't valid: check the list and the limit (1-1000).";
    case 'forbidden': case 'not_allowed': return 'Only admins of this homeserver can change that.';
    case 'owner_only': return 'Only the owner of this homeserver can do that.';
    case 'user_not_found': case 'unknown_user': case 'not_found': return 'No account with that id here.';
    case 'cannot_remove_owner': return "The owner can't be removed from the admins.";
    case 'rate_limited': return 'Too many tries. Wait a moment and try again.';
    case 'not_on_instances': case 'instance_not_connected': return "You aren't connected to this homeserver right now.";
    case 'instance_unreachable': case 'unreachable': return "Couldn't reach the homeserver. Check your connection and try again.";
    case 'signed_out': return 'Your sign-in to this homeserver ended. Sign in again.';
    case 'invalid_max_uses': return 'Uses can be 1 to 1000, or empty for no limit.';
    case 'invalid_expires_in_hours': return 'An invite can last 1 to 8760 hours (a year), or empty for no end.';
    case 'invalid_note': return 'The note can be up to 200 characters.';
    case 'too_many_invites': return 'This homeserver has as many invites as it can keep. Revoke some first.';
    case 'invite_not_found': return 'That invite is gone already.';
    case 'account_not_pending': return "That account isn't waiting any more.";
    case 'request_not_found': return 'That request was answered or cancelled already.';
    case 'invalid_reason': return 'The reason can be up to 300 characters.';
    default: return "That didn't work. Try again.";
  }
}
// linking / unlinking one of your own sign-in methods (a code from the server, or from the trip through the provider)
export function loginErrorText(code, name) {
  const it = name || 'that sign-in';
  switch (code) {
    case 'last_login_method': return `You can't remove ${it}: it's the only way left to get into your account. Add another one first.`;
    case 'cannot_remove_password': return "A password can't be removed here.";
    case 'not_linked': return `${name || 'That sign-in'} isn't linked to your account.`;
    case 'login_already_linked': return `${name || 'That login'} is already linked to another account.`;
    case 'unknown_method': return "This homeserver doesn't offer that sign-in any more.";
    case 'invalid_return_to': return "This homeserver doesn't know this copy of Ember, so it can't send you back here. Link it from the homeserver's own account page.";
    case 'access_denied': case 'declined': case 'cancelled': return 'Linking was cancelled.';
    case 'link_refused': return "This homeserver doesn't let Ember start linking from here yet. Use the homeserver's own account page.";
    case 'blocked': return 'Your browser blocked the pop-up. Allow pop-ups for this site and try again.';
    case 'signed_out': return 'Your sign-in to this homeserver ended. Sign in again.';
    case 'unreachable': return "Couldn't reach the homeserver. Check your connection and try again.";
    case 'rate_limited': return 'Too many tries. Wait a moment and try again.';
    default: return `Couldn't link ${it}. Try again.`;
  }
}

// ── back from linking ──
// The homeserver sends the browser to return_to with ?linked=<method id> or ?link_error=<code> added to its query.
// search: location.search (or a whole URL). -> null (not a link return) | { linked } | { error }
export function parseLinkReturn(search) {
  let s = String(search || '');
  if (/^https?:/i.test(s)) { try { s = new URL(s).search; } catch { return null; } }
  const q = new URLSearchParams(s.replace(/^[^?]*\?/, '').replace(/#.*$/, ''));
  const error = q.get('link_error'), linked = q.get('linked');
  if (error) return { error: error.slice(0, 64) };
  if (linked && ID.test(linked)) return { linked };
  return null;
}
// the same address without those two (what goes back in the address bar)
export function stripLinkReturn(href) {
  const u = new URL(href);
  u.searchParams.delete('linked'); u.searchParams.delete('link_error');
  return u.href;
}
// a message from auth/callback.html after a link trip. ev = { origin, data } -> null (not ours) | { linked } | { error }
export function checkLinkMessage(ev, emberOrigin) {
  if (!ev || !emberOrigin || ev.origin !== emberOrigin) return null;
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.type !== 'ember-link') return null;
  if (typeof d.link_error === 'string' && d.link_error) return { error: d.link_error.slice(0, 64) };
  if (typeof d.linked === 'string' && ID.test(d.linked)) return { linked: d.linked };
  return { error: 'failed' };
}
