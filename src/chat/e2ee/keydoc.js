// Other people's keys as their home homeserver publishes them (the key document, GET <api_url>/social/keys/<id>), checked here:
// a homeserver passing a document on can drop or swap things, so what counts is what the account key itself signed.
// And the rules for the secret that locks my own keys at my home. Pure: nke1.js only.
import * as N from './nke1.js';

const KID = /^[\w-]{22}$/;
// "l:5@a.example" -> { name: 'l:5', domain: 'a.example' } (domain lower case), or null
export function splitId(id) {
  const s = String(id ?? ''), at = s.lastIndexOf('@');
  return at > 0 && at < s.length - 1 ? { name: s.slice(0, at), domain: s.slice(at + 1).toLowerCase() } : null;
}
export const normId = id => { const p = splitId(id); return p ? `${p.name}@${p.domain}` : String(id ?? ''); };
// a Nookara account, wherever it is signed in: v:<number>@<domain>
export const isNookaraId = id => /^v:\d+$/.test(splitId(id)?.name || '');
// the string an account's own signatures carry: its whole id, or (Nookara accounts, whose signatures are older than ids) the number
export function ownerOk(id, owner) {
  const p = splitId(id);
  if (!p || typeof owner !== 'string' || !owner) return false;
  return owner === id || owner === `${p.name}@${p.domain}` || (/^\d+$/.test(owner) && p.name === `v:${owner}`);
}
const bad = () => new Error('bad_key_list');

// a key document -> { none: true } (no keys yet, or not an nke1 document) | { b: bundle }; throws bad_key_list.
// bundle = { id, owner, kid, enc_pub, sig_pub, clients: { seq, list }, clients_sig, past, fp, stale }
export async function bundleOfDoc(doc, id) {
  const want = normId(id);
  if (!doc || typeof doc !== 'object' || normId(doc.id) !== want) throw bad();
  if (doc.format !== 'nke1' || !Array.isArray(doc.keys) || !doc.keys.length) return { none: true };
  const accounts = doc.keys.filter(k => k?.kind === 'account');
  if (accounts.length !== 1) throw bad();
  const a = accounts[0];
  if (a.alg !== 'p256' || typeof a.public_key !== 'string' || typeof a.enc_public_key !== 'string' || !KID.test(String(a.kid))) throw bad();
  if (!ownerOk(want, doc.owner)) throw bad();
  let kid; try { kid = await N.kidOf(a.enc_public_key); } catch { throw bad(); }
  if (kid !== a.kid) throw bad();
  const clients = doc.clients && typeof doc.clients === 'object' && Array.isArray(doc.clients.list) ? { seq: Number(doc.clients.seq || 0), list: doc.clients.list } : { seq: 0, list: [] };
  if (clients.list.length > 200) throw bad();
  // the list of linked clients has to be signed by the account key itself, or a homeserver could add a reader
  if (clients.list.length) {
    if (!doc.clients_sig || !(await N.verifyClients(doc.owner, a.kid, clients, doc.clients_sig, a.public_key))) throw bad();
    for (const c of clients.list) { if (!c || !KID.test(String(c.kid)) || (!c.revoked_at && (await N.kidOf(c.enc_pub).catch(() => '')) !== c.kid)) throw bad(); }
  }
  const past = (Array.isArray(doc.past) ? doc.past : []).filter(p => p && KID.test(String(p.kid)) && typeof p.sig_pub === 'string').slice(0, 20);
  return { b: { id: want, owner: doc.owner, kid: a.kid, enc_pub: a.enc_public_key, sig_pub: a.public_key, clients, clients_sig: doc.clients_sig || null, past, fp: await N.fingerprint(a.enc_public_key, a.public_key), ...(doc.stale ? { stale: true } : {}) } };
}
// a Nookara bundle (GET /im/keys/me, /im/keys/user/<name>) in the same shape
export const bundleOfNookara = async (b, id) => ({ id, owner: String(b.owner ?? b.user_id), kid: b.kid, enc_pub: b.enc_pub, sig_pub: b.sig_pub, clients: b.clients || { seq: 0, list: [] }, clients_sig: b.clients_sig || null, past: b.past || [], fp: b.fp || await N.fingerprint(b.enc_pub, b.sig_pub) });

// what I remembered of someone's keys (pin = { fp, seq, first } | null) against what I am shown now:
//   'new' never seen | 'same' | 'changed' another key (say so) | 'older' the same key with an older client list (refuse: a replay)
export function pinState(pin, fp, seq) {
  if (!pin) return 'new';
  if (pin.fp !== fp) return 'changed';
  return Number(pin.seq || 0) > Number(seq || 0) ? 'older' : 'same';
}
// every key a message for this person is wrapped to: the account key and the linked clients that are not revoked
export const activeKeys = b => [{ kid: b.kid, enc_pub: b.enc_pub }, ...((b.clients?.list || []).filter(c => !c.revoked_at).map(c => ({ kid: c.kid, enc_pub: c.enc_pub })))];
// the public key a signer kid stands for: the account key, a linked client (revoked ones too: older messages), a replaced account key
export const signerKey = (b, kid) => (b.kid === kid ? b.sig_pub : (b.clients?.list || []).find(c => c.kid === kid)?.sig_pub || (b.past || []).find(p => p.kid === kid)?.sig_pub || null);

// ── the secret that locks my keys at my home ──
// Nookara keeps its PIN (6 digits or more) or password (10 or more). Any other homeserver is run by someone who holds the salt
// and the check value and could try every PIN in hours: there it is a passphrase of 12 characters or more (or the recovery code).
export const PASSPHRASE_MIN = 12;
export const secretKinds = home => (home?.nookara === false ? ['passphrase'] : ['pin', 'password']);
export function validSecret(home, type, v) {
  const s = String(v ?? '');
  if (home?.nookara === false) return type !== 'pin' && s.length >= Math.max(PASSPHRASE_MIN, Number(home.min) || 0) && !/^\d+$/.test(s); // (min: what the home's passcode_rules ask, never less than 12)
  return type === 'pin' ? /^\d{6,}$/.test(s) : s.length >= 10;
}
// the `passcode` and `recovery` halves of a setup call say what they were locked with on a homeserver (Nookara's take no such field)
export const secretKindOf = (home, half) => (home?.nookara === false ? { secret_kind: half === 'recovery' ? 'recovery' : 'passphrase' } : {});
