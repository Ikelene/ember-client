import { nookaraId } from '../compat.js';
// Account profiles on Ember servers with their own accounts (ember-server PROTOCOL 4.1): what a Nookara profile becomes when it is
// copied to such a server, and the stamp that says which copy the server holds. No store / network here (tested in node).

export const LIMITS = { name: 32, bio: 300, pronouns: 40, picture: 4 * 1024 * 1024 };
const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
// cut to n UTF-16 units (what the server counts) without splitting a character
function cut(text, n) {
  let out = '';
  for (const ch of String(text || '')) { if (out.length + ch.length > n) break; out += ch; }
  return out;
}

// the text fields of a Nookara profile (GET /account/lookup/:name) as the server takes them
export function copyFields(g) {
  const name = cut(String(g?.display_name || '').replace(/\s+/g, ' ').trim(), LIMITS.name);
  return {
    display_name: name && name !== g?.username ? name : null,
    bio: cut(String(g?.bio || '').replace(/\r\n?/g, '\n').trim(), LIMITS.bio) || null,
    pronouns: cut(String(g?.pronouns || '').trim(), LIMITS.pronouns) || null,
    color: isHex(g?.color) ? g.color.toLowerCase() : null,
  };
}

async function hash(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
// "t:<text>.p:<picture>.b:<banner>": one short hash per part, so a sync only brings over the parts that changed
export async function stampOf(g) {
  const f = copyFields(g);
  const [t, p, b] = await Promise.all([hash(JSON.stringify([f.display_name, f.bio, f.pronouns, f.color])), hash(String(g?.pfp_url || '')), hash(String(g?.banner_url || ''))]);
  return `t:${t}.p:${p}.b:${b}`;
}
export function stampParts(stamp) {
  const out = { t: '', p: '', b: '' };
  for (const part of String(stamp || '').split('.')) { const m = /^([tpb]):([0-9a-f]{16})$/.exec(part); if (m) out[m[1]] = m[2]; }
  return out;
}
export const joinStamp = s => `t:${s.t}.p:${s.p}.b:${s.b}`;
// which parts of the Nookara profile the server doesn't have yet. before: the stamp it holds ('' = copy everything)
export function changedParts(before, now) {
  const a = stampParts(before), b = stampParts(now);
  return { text: a.t !== b.t, pfp: a.p !== b.p, banner: a.b !== b.b };
}
// can this server keep an account profile for me? (its own accounts, new enough, and I'm signed in there) inst: store.js instView
export const hasAccountProfile = inst => !!inst && inst.mode === 'local' && !!inst.features?.account_profiles && inst.user?.kind === 'local';
// the Settings > Profile target of a server's account profile, and back
export const accountTarget = origin => `acct:${origin}`;
export const targetOrigin = t => (typeof t === 'string' && t.startsWith('acct:') ? t.slice(5) : null);
// does this server profile follow the Nookara account that is signed in here?
export const follows = (sync, accountId) => !!sync && accountId != null && String(nookaraId(sync)) === String(accountId);

// where to read a Nookara picture from as bytes: its own link, then the same file on nookara.cc (the CDN copy has no CORS promise)
export function pictureSources(url, origin = 'https://nookara.cc') {
  const u = String(url || '');
  if (!u) return [];
  if (u.startsWith('/') && !u.startsWith('//')) return [origin + u];
  if (!/^https?:\/\//i.test(u)) return [];
  const alt = u.replace(/^https:\/\/cdn\.nookara\.cc\/uploads\//i, `${origin}/uploads/`);
  return alt === u ? [u] : [alt, u];
}
