// A homeserver's federation settings as its admins edit them (PROTOCOL §4b: GET / PATCH /api/v2/homeserver/federation), and
// a server's own rules for accounts of other homeservers (server settings, section join). Pure: no imports, nothing from
// the browser. The checks follow ember-server's src/federation/rules.js, so what passes here the server takes.

export const DEFAULT_DENYLIST = 'https://nookara.cc/.well-known/ember/denylist';
export const MAX_DENYLISTS = 20;
export const MAX_DENY = 5000;

// ── names ──
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const isDomain = d => typeof d === 'string' && HOST.test(d);
// "example.org" (that name only) or "*.example.org" (every name under it)
export const isDomainRule = r => typeof r === 'string' && HOST.test(r.replace(/^\*\./, ''));

// ── addresses ──
const isIPv4 = s => { const p = String(s).split('.'); return p.length === 4 && p.every(x => /^\d{1,3}$/.test(x) && Number(x) <= 255); };
function isIPv6(s) {
  let t = String(s);
  if (!t.includes(':') || /:::/.test(t) || (t.match(/::/g) || []).length > 1) return false;
  let extra = 0;
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (v4) { if (!isIPv4(v4[2])) return false; t = v4[1] + '0'; extra = 1; } // the address takes two groups; '0' holds one, extra the other
  const [head, tail] = t.split('::');
  const groups = [...(head ? head.split(':') : []), ...(tail ? tail.split(':') : [])];
  if (!groups.every(g => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  const n = groups.length + extra;
  return tail === undefined ? n === 8 : n <= 7;
}
export const isIP = s => isIPv4(s) || isIPv6(s);
// "a.b.c.d/n", "2001:db8::/32" or a bare address
export function isCidr(text) {
  const m = /^([0-9a-f:.]+)(?:\/(\d{1,3}))?$/i.exec(String(text || '').trim());
  if (!m) return false;
  const v4 = isIPv4(m[1]);
  if (!v4 && !isIPv6(m[1])) return false;
  return m[2] === undefined || Number(m[2]) <= (v4 ? 32 : 128);
}

// ── deny entries ──
// what one typed entry is: 'domain' | 'subdomains' | 'network' | 'account', or null when it is none of them
export function denyKind(raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t || t.length > 320) return null;
  if (t.includes('@')) {
    const at = t.lastIndexOf('@');
    return at > 0 && ACCOUNT_ID.test(t.slice(0, at)) && isDomain(t.slice(at + 1).toLowerCase()) ? 'account' : null;
  }
  if (/^[0-9a-f:.]+(\/\d{1,3})?$/i.test(t) && (t.includes('/') || isIP(t))) return isCidr(t) ? 'network' : null;
  if (/^[\d.]+$/.test(t)) return null; // looks like an address but isn't one
  const d = t.toLowerCase();
  return isDomainRule(d) ? (d.startsWith('*.') ? 'subdomains' : 'domain') : null;
}
// the entry as the server keeps it (an account id keeps its case, its domain doesn't), or null
export function cleanDeny(raw) {
  const kind = denyKind(raw);
  if (!kind) return null;
  const t = raw.trim();
  if (kind === 'account') { const at = t.lastIndexOf('@'); return `${t.slice(0, at)}@${t.slice(at + 1).toLowerCase()}`; }
  return t.toLowerCase();
}
export const DENY_KIND_LABEL = { domain: 'Homeserver', subdomains: 'Every name under', network: 'IP range', account: 'Account' };
// what is wrong with one entry, in words ('' when it is fine)
export function denyIssue(raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return 'Type something to block.';
  if (denyKind(t)) return '';
  if (t.length > 320) return "That's too long.";
  if (/^https?:\/\//i.test(t)) return 'Just the domain, without https://.';
  if (t.includes('@')) return 'An account is written id@domain, like alice@example.org or l:5@example.org.';
  if (t.includes('/') || t.includes(':') || /^[\d.]+$/.test(t)) return 'Not a valid IP address or range. Try 203.0.113.0/24 or 2001:db8::/32.';
  if (t.includes('*')) return 'A star only goes at the front, as *.example.org.';
  return 'Not a domain, IP range or account. Try example.org, *.example.org, 203.0.113.0/24 or alice@example.org.';
}

// ── homeserver lists (who may sign in from elsewhere, a server's own list) ──
// a list as typed (one per line, or commas / spaces) -> { list: clean rules, no repeats, bad: what isn't a domain rule }
export function domainRules(raw) {
  const items = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/)).map(x => String(x).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  const list = [], bad = [];
  for (const x of items) { if (!isDomainRule(x)) { if (!bad.includes(x)) bad.push(x); } else if (!list.includes(x)) list.push(x); }
  return { list, bad };
}
export const domainRuleIssue = bad => (bad.length ? `${bad.length === 1 ? `"${bad[0]}" isn't` : `${bad.slice(0, 3).map(x => `"${x}"`).join(', ')}${bad.length > 3 ? ' and more' : ''} aren't`} a domain. Use example.org, or *.example.org for every name under it.` : '');

// ── shared deny lists ──
// a list address as the server keeps it, or null: https, no login in it, no #
export function listUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || String(raw).length > 500) return null;
  return u.href;
}
// why a followed list didn't update, in plain words
export function listErrorText(code) {
  const c = String(code || '');
  const http = /^http_(\d{3})$/.exec(c);
  if (http) {
    const n = Number(http[1]);
    if (n === 404 || n === 410) return `There's no list at that address (${n}).`;
    if (n === 401 || n === 403) return `The list's host refused to hand it over (${n}).`;
    if (n === 429) return 'The list\'s host says to slow down (429). It will be tried again.';
    if (n >= 500) return `The list's host had a problem (${n}). It will be tried again.`;
    if (n >= 300 && n < 400) return `The address redirects somewhere else (${n}). Use the address it ends up at.`;
    return `The list's host answered ${n} instead of the list.`;
  }
  switch (c) {
    case 'bad_signature': return "The list's signature doesn't match, so it was ignored. It may have been changed by someone else.";
    case 'unsigned': return "The list isn't signed, so it can't be trusted.";
    case 'unknown_kid': return "The list is signed with a key its host doesn't publish.";
    case 'bad_document': return "What's at that address isn't a deny list.";
    case 'too_big': return 'The list is too big (over 4 MB).';
    case 'timeout': return 'The list took too long to answer.';
    case 'private_address': return 'The address points at a private network, which homeservers never fetch.';
    case 'bad_url': return 'The address has to be https.';
    case 'unreachable': default: return "Couldn't reach the list's host.";
  }
}
// one entry of the view's `denylists` -> { tone: 'ok' | 'warn' | 'wait', text }. now: ms
export function listStatus(s, now = Date.now()) {
  if (!s) return { tone: 'wait', text: 'Not fetched yet.' };
  const count = `${Number(s.entries) || 0} ${Number(s.entries) === 1 ? 'entry' : 'entries'}`;
  const when = s.fetched_at ? `checked ${ago(s.fetched_at, now)}` : '';
  if (s.error) return { tone: 'warn', text: `${listErrorText(s.error)}${s.fetched_at ? ` The copy from ${ago(s.fetched_at, now)} (${count}) still applies.` : ''}` };
  if (!s.fetched_at) return { tone: 'wait', text: 'Not fetched yet.' };
  return { tone: 'ok', text: `${count}, ${when}.` };
}
export function ago(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Number(t)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

// ── limits ──
// [key, label, what it means, min, max]
export const RATE_FIELDS = [
  ['exchanges_per_minute', 'Sign-ins a minute', 'People from one homeserver signing in here.', 1, 100000],
  ['joins_per_hour', 'Joins an hour', 'Joins and join requests from one homeserver.', 1, 1000000],
  ['messages_per_minute', 'Messages a minute', 'Messages sent by everyone from one homeserver.', 1, 1000000],
  ['reports_per_hour', 'Reports an hour', 'Reports made by people from one homeserver.', 1, 100000],
  ['new_days', 'New for (days)', 'A homeserver first seen less than this long ago counts as new.', 0, 3650],
  ['new_divisor', 'New homeservers get 1 / N', 'New homeservers get the limits above divided by this.', 1, 1000],
  ['hold_after', 'Hold after', 'This many refusals within ten minutes puts a homeserver on hold.', 1, 100000],
  ['hold_minutes', 'Hold for (minutes)', 'How long a homeserver on hold has everything refused.', 1, 10080],
];
export const FLOOR_MAX = 365;
const intIn = (v, min, max) => { const s = String(v ?? '').trim(); if (!/^\d+$/.test(s)) return null; const n = Number(s); return n >= min && n <= max ? n : null; };
// the form's numbers -> { rate_limits, floor, bad: { key: words } }
export function readNumbers(f) {
  const bad = {}, rate_limits = {};
  for (const [k, , , min, max] of RATE_FIELDS) { const n = intIn(f.rate_limits?.[k], min, max); if (n === null) bad[k] = `A whole number from ${min} to ${max.toLocaleString('en')}.`; else rate_limits[k] = n; }
  const floor = intIn(f.min_age_floor_days, 0, FLOOR_MAX);
  if (floor === null) bad.min_age_floor_days = `A whole number of days from 0 to ${FLOOR_MAX}.`;
  return { rate_limits, floor, bad };
}

// ── what is sent ──
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// the view -> the form the tab edits (numbers as text, so a half-typed one stays in the box)
export const federationForm = v => {
  const f = v?.federation || {};
  return {
    rate_limits: Object.fromEntries(RATE_FIELDS.map(([k]) => [k, f.rate_limits?.[k] == null ? '' : String(f.rate_limits[k])])),
    min_age_floor_days: String(f.min_age_floor_days ?? 0), denylists: [...(f.denylists || [])], deny: [...(f.deny || [])],
  };
};
// the PATCH body for the federation block: only what changed ({} when nothing did, null while a number is wrong)
export function federationPatch(view, form) {
  const cur = view?.federation || {}, out = {};
  const { rate_limits, floor, bad } = readNumbers(form);
  if (Object.keys(bad).length) return null;
  const rl = {};
  for (const [k] of RATE_FIELDS) if (rate_limits[k] !== cur.rate_limits?.[k]) rl[k] = rate_limits[k];
  if (Object.keys(rl).length) out.rate_limits = rl;
  if (floor !== (cur.min_age_floor_days ?? 0)) out.min_age_floor_days = floor;
  if (!sameList(form.denylists, cur.denylists || [])) out.denylists = [...form.denylists];
  if (!sameList(form.deny, cur.deny || [])) out.deny = [...form.deny];
  return out;
}
// the PATCH body for accounts.remote_accounts: { remote_accounts: { mode?, list? } } with what changed, or {} / null (a bad name)
export function remoteAccountsPatch(cur, mode, rawList) {
  const { list, bad } = domainRules(rawList);
  if (bad.length) return null;
  const was = cur || {}, r = {};
  if (mode !== (was.mode || 'none')) r.mode = mode;
  if (!sameList(list, was.list || [])) r.list = list;
  return Object.keys(r).length ? { remote_accounts: r } : {};
}

// ── a server's own rules (join section) ──
export const SERVER_REMOTE_MODES = [
  ['inherit', 'Whoever the homeserver lets in', 'Accounts from every homeserver this one accepts.'],
  ['none', 'Nobody', 'Only accounts of this homeserver can join.'],
  ['allowlist', 'Only these', 'Accounts from the homeservers on the list (if this homeserver lets them in too).'],
];
export const DAYS_MAX = 365;
// a server's "new homeservers wait N days": a whole number, never under the homeserver's floor, at most 365
export function clampDays(v, floor = 0) {
  const lo = Math.max(0, Math.min(DAYS_MAX, Math.floor(Number(floor) || 0)));
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(DAYS_MAX, Math.max(lo, n)) : lo;
}
// how long the wait really is: the server's number or the floor, whichever is more
export const effectiveDays = (days, floor = 0) => Math.max(Number(days) || 0, Number(floor) || 0);
