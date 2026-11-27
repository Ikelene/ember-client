// A DM a homeserver hosts (two people or a group), end to end: who it is sealed to, sealing, opening, the link preview that
// travels inside it, and holding a message back while someone in it has no keys. Pure (nke1.js + keydoc.js): session.js and
// store.js bring the keys, the network and the storage.
//   dm = { id: '<sid>@<host domain>', group, members: [{ id: stable id, ... }] } as the social API gives it
import * as N from './nke1.js';
import { activeKeys, signerKey, normId, splitId } from './keydoc.js';

// ── who is in it ──
export const memberIds = dm => [...new Set((dm?.members || []).map(m => normId(m.id)).filter(Boolean))];
// the stable id of a message's author. On the host its own accounts go by the short id (l:5), everyone else by the whole one
export function senderId(author, dm) {
  const raw = author?.account ?? author?.id;
  if (raw == null || raw === '') return null;
  const s = String(raw), host = splitId(dm?.id)?.domain;
  return s.includes('@') ? normId(s) : host ? `${s}@${host}` : null;
}
// The member list is the host's word. A two-person DM is sealed to exactly the two people it was made with, whatever the host
// lists later; a group follows its list, and says so when it changes (a host adding someone would get them the next message).
// known = { ids } this device remembered for the DM, or null the first time
// -> { ids, added, removed, error?: 'not_a_member' | 'dm_members_changed' }
export function membersCheck(dm, me, known) {
  const ids = memberIds(dm), mine = normId(me);
  const before = known?.ids ? known.ids.map(normId) : null;
  const added = before ? ids.filter(x => !before.includes(x)) : [], removed = before ? before.filter(x => !ids.includes(x)) : [];
  const out = { ids, added, removed };
  if (!ids.includes(mine)) return { ...out, error: 'not_a_member' };
  if (!dm.group && (ids.length > 2 || added.length || removed.length)) return { ...out, error: 'dm_members_changed' };
  return out;
}
export const memberName = (dm, id) => { const m = (dm?.members || []).find(x => normId(x.id) === normId(id)); return m?.display_name || String(m?.handle || id).split('@')[0] || String(id); };
// "alice, bob and carol"
export function nameList(names) {
  const n = names.filter(Boolean);
  return n.length <= 1 ? n[0] || '' : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

// ── sealing ──
// bundles: { <stable id>: bundle } for every member that has keys (keydoc.js bundleOfDoc), mine included.
// -> the envelope (v: 2). Throws no_keys with .missing = the members without keys (nothing is sealed to only some of them),
// dm_members_changed / not_a_member, too_many_wraps
export async function sealDm({ dm, me, bundles, signer, text, quote = null, preview = null, editOf = 0, known = null }) {
  const check = membersCheck(dm, me, known);
  if (check.error) throw Object.assign(new Error(check.error), check);
  const missing = check.ids.filter(id => !bundles[id]);
  if (missing.length) throw Object.assign(new Error('no_keys'), { missing });
  const recipients = check.ids.flatMap(id => activeKeys(bundles[id]));
  if (new Set(recipients.map(r => r.kid)).size > N.MAX_WRAPS) throw new Error('too_many_wraps');
  const p = preview ? cleanPreview(preview) : null;
  const payload = { t: String(text ?? ''), ...(quote ? { r: quote } : {}), ...(p ? { p } : {}) };
  return N.encryptMessage(payload, { v: 2, dm: normId(dm.id), from: normId(me), recipients, signer, editOf });
}

// ── opening ──
const LINK_LINE = /^https?:\/\/\S+#nke=\S+$/;
// what a payload holds, however it was opened (my key, or a key a report revealed)
export function readPayload(p) {
  const wire = String(p?.t ?? ''), lines = wire.split('\n');
  const files = lines.filter(l => LINK_LINE.test(l.trim())).map(l => l.trim());
  const text = lines.filter(l => !LINK_LINE.test(l.trim())).join('\n').trimEnd();
  return { text, wire, files, quote: p?.r && typeof p.r === 'object' ? { from: String(p.r.from ?? ''), s: String(p.r.s ?? '') } : null, preview: previewOf(p, text), ts: Number.isFinite(p?.ts) ? p.ts : null };
}
// -> { state: 'failed' } | { state: 'open', text, wire, files, quote, preview, ts, key } (key = this message's K, base64url:
// what a report hands over, and nothing else ever does)
export async function openDm(enc, { dm, from, kid, encPriv }) {
  try {
    if (Number(enc?.v) !== 2 || !from) return { state: 'failed' };
    const k = await N.messageKey(enc, kid, encPriv);
    if (!k) return { state: 'failed' };
    return { state: 'open', ...readPayload(await N.openWithKey(enc, k, { v: 2, dm: normId(dm), from: normId(from) })), key: N.b64(k) };
  } catch { return { state: 'failed' }; }
}
// a reported message, opened with the key its reporter revealed (an admin's Reports tab). -> the payload's contents | null
export async function openRevealed(enc, revealed, { dm, from }) {
  try {
    const k = N.unb64(revealed);
    if (Number(enc?.v) !== 2 || k.length !== 32 || (await N.commitOf(k)) !== enc.commit) return null;
    return readPayload(await N.openWithKey(enc, k, { v: 2, dm: normId(dm), from: normId(from) }));
  } catch { return null; }
}
// 'valid' | 'invalid' | 'unknown' (signed by a key the sender's bundle doesn't list). An edit is signed with the message's id
export async function signatureOf(enc, bundle, { dm, from, id, edited }) {
  if (!enc?.sig) return 'none';
  const key = bundle ? signerKey(bundle, enc.signer) : null;
  if (!key) return 'unknown';
  return (await N.verifyMessage(enc, key, { v: 2, dm: normId(dm), from: normId(from), editOf: edited ? id : 0 })) ? 'valid' : 'invalid';
}

// ── the link preview inside a message ──
// No server is asked about a link in a sealed DM (it would learn the link). The sender's device makes the preview, if the page
// lets a browser read it, and it goes in the payload as p = { url, title, description, image }: image is a sealed upload's
// file link (nke1.js fileLink), never a plain address someone's browser would be sent to.
const URL_RE = /https?:\/\/[^\s<>"']+/g;
export function firstLink(text) {
  for (const raw of String(text ?? '').match(URL_RE) || []) {
    if (/#nke=/.test(raw)) continue;
    const u = raw.replace(/[),.;:!?\]]+$/, '');
    try { const x = new URL(u); if (x.hostname.includes('.') || x.hostname === 'localhost') return u; } catch { /* not one */ }
  }
  return null;
}
const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// -> { url, title, description, image } or null when there is nothing to show
export function cleanPreview(p) {
  if (!p || typeof p !== 'object') return null;
  let url = ''; try { const x = new URL(String(p.url)); if (/^https?:$/.test(x.protocol) && x.href.length <= 2000) url = String(p.url); } catch { /* none */ }
  const title = line(p.title, 200), description = line(p.description, 400);
  const image = typeof p.image === 'string' && p.image.length <= 3000 && N.parseFileLink(p.image) ? p.image : '';
  return url && (title || description || image) ? { url, title, description, image } : null;
}
// the preview a payload carries, shown only for a link the message itself has
function previewOf(p, text) {
  const c = cleanPreview(p?.p);
  return c && String(text).includes(c.url) ? c : null;
}
const unent = s => String(s).replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", apos: "'" }[e]));
// a page's own words about itself (Open Graph, then <title> / meta description). -> { title, description, image (absolute, or '') }
export function parseOg(html, url) {
  const head = String(html ?? '').slice(0, 200000), metas = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase(), content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (name && content && metas[name] === undefined) metas[name] = unent(content[1] ?? content[2] ?? '');
  }
  const title = metas['og:title'] || metas['twitter:title'] || unent(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] || '');
  const description = metas['og:description'] || metas['twitter:description'] || metas.description || '';
  let image = ''; try { const raw = metas['og:image'] || metas['twitter:image'] || ''; if (raw) { const x = new URL(raw, url); if (/^https?:$/.test(x.protocol)) image = x.href; } } catch { /* none */ }
  return { title: line(title, 200), description: line(description, 400), image };
}

// ── holding a message back ──
// A homeserver DM never carries plain text. While someone in it has no keys, a message stays on this device (the outbox,
// which survives a reload) and goes by itself once they have set up.
//   item = { nonce, dm: <dm id>, me, wire, quote?, reply_to?, preview?, created_at }
//   deps = { dmOf(id) -> dm | null, bundlesFor(dm, { fresh }) -> { bundles, missing }, seal(args) -> envelope,
//            post(dm, envelope, item) (the ONLY thing that reaches a server, and it is only ever given an envelope),
//            hold(item), release(nonce) }
// -> { sent: true } | { held: true, missing } | throws what stopped it for good (dm gone, members changed, the post refused)
export async function sendOrHold(item, deps, { fresh = false } = {}) {
  const dm = deps.dmOf(item.dm);
  if (!dm) throw new Error('dm_not_found');
  const { bundles, missing } = await deps.bundlesFor(dm, { fresh });
  if (missing.length) { await deps.hold({ ...item, missing }); return { held: true, missing }; }
  let enc;
  try { enc = await deps.seal({ dm, bundles, text: item.wire, quote: item.quote || null, preview: item.preview || null }); }
  catch (e) { if (e.message === 'no_keys') { await deps.hold({ ...item, missing: e.missing || [] }); return { held: true, missing: e.missing || [] }; } throw e; }
  if (!enc || Number(enc.v) !== 2 || !enc.ct || !enc.wraps) throw new Error('not_sealed');
  await deps.post(dm, enc, item);
  await deps.release(item.nonce);
  return { sent: true };
}
// every held message of mine once more (keys may have appeared). -> how many went
export async function flushHeld(items, me, deps) {
  let sent = 0;
  for (const item of items) {
    if (!item?.dm || normId(item.me) !== normId(me)) continue;
    try { if ((await sendOrHold(item, deps, { fresh: true })).sent) sent++; } catch (e) { await deps.failed?.(item, e); }
  }
  return sent;
}
