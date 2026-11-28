import { bare } from './ids.js';
import { nookaraId, nookaraInfo, OLD_ORIGIN } from '../compat.js';

// the same canonical JSON the instance uses: keys sorted recursively, no spaces, integers
export function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
// sticker: the sticker id a sticker message carries (PROTOCOL §8.2), left out of the payload when there is none
export const payloadOf = ({ iss, instance, community, channel, author, ts, nonce, body, attachments, reply_to, edit_of, sticker }) => ({
  v: 1, iss, instance, community, channel, author: String(author), ts: Number(ts), nonce: String(nonce), body: String(body),
  attachments: (attachments || []).map(String), reply_to: reply_to == null ? null : String(reply_to), edit_of: edit_of == null ? null : String(edit_of),
  ...(sticker == null || sticker === '' ? {} : { sticker: String(sticker) }),
});

// Upload hashes keep v1 signatures unchanged; link-only GIFs bind their exact URL.
export function attachmentRefs(attachments = []) {
  return attachments.map(a => {
    if (/^[0-9a-f]{64}$/.test(String(a.sha256 || ''))) return a.sha256;
    if (/^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(a.url || '')) return `url:${a.url.slice(0, 512)}`;
    throw new Error('missing_attachment_hash');
  });
}

export function receivedPayload(m, iss) {
  return payloadOf({ iss, instance: m.inst, community: bare(m.server), channel: bare(m.channel), author: nookaraId(m.author),
    ts: m.signature.ts, nonce: m.signature.nonce, body: m.body, attachments: attachmentRefs(m.attachments || []),
    reply_to: m.reply_to ?? m.reply?.id ?? null, edit_of: m.edited_at ? m.id : null, sticker: m.sticker?.tid ?? null });
}

// a message of a server that moved here (imported): its signature covers what was sent on the old server, which the view hands
// back as signature.signed (instance, community, channel, author, ts, nonce, body, attachments, reply_to, edit_of, sticker,
// iss). -> that payload, or null for an ordinary message
export function signedPayload(m, iss) {
  const s = m?.signature?.signed;
  if (!s || typeof s !== 'object') return null;
  return payloadOf({ iss: s.iss || iss, instance: s.instance, community: s.community, channel: s.channel, author: s.author,
    ts: s.ts ?? m.signature.ts, nonce: s.nonce ?? m.signature.nonce, body: s.body ?? '', attachments: Array.isArray(s.attachments) ? s.attachments : [],
    reply_to: s.reply_to ?? null, edit_of: s.edit_of ?? null, sticker: s.sticker ?? null });
}
const hostOfUrl = u => { try { return new URL(u).host; } catch { return null; } };
// where a moved message was signed ("e-dementia.nookara.cc"), for its tooltip; null for an ordinary one
export const signedOnHost = m => (m?.signature?.signed ? hostOfUrl(m.signature.moved_from || m.signature.signed.instance) : null);
const normO = u => { try { return new URL(u).origin.toLowerCase(); } catch { return String(u || '').toLowerCase(); } };
// may a moved message's signed instance stand for this server? its current address, or one of the addresses it had before
export const movedInstanceOk = (signedInstance, inst, previous = []) => [inst, ...previous].map(normO).includes(normO(signedInstance));

// the "iss" to sign with for an instance, from its discovery info (/.well-known/bonfire): the first of nookara.signing_issuers
// (https://nookara.cc on Nookara); an instance older than that list checks against its own nookara_url (nookara.issuer); with
// neither, Nookara's original https://velora.ikelene.net
const originOf = u => { try { return new URL(u).origin; } catch { return null; } };
export function issuerFor(info) {
  const list = nookaraInfo(info)?.signing_issuers;
  if (Array.isArray(list) && list.length) return String(list[0]);
  return originOf(nookaraInfo(info)?.issuer) || OLD_ORIGIN;
}
