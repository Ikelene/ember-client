// What someone typed or pasted into Join (the "+" dialog, CreateOnHomeserver.jsx): an invite link (<url_base><code>, or an older
// form), a bare invite code (for a homeserver picked beside it), or the address of an instance. Servers have no addresses people
// see any more: a bare name@domain is turned away. Pure: the node tests load it.
import { parseAddress, parseInviteUrl, parseInviteLink } from './addresses.js';
import { inviteRef } from './inviteLink.js';

const CODE = /^[A-Za-z0-9]{4,32}$/;
const OWN_HASH = /^#?\/?invite\/([A-Za-z0-9]{4,32})\/?$/;
// -> { kind: 'link', invite } (invite: { code, origin, link, slug }) | { kind: 'address', address } (an older invite: { slug, domain, code }
// or, from a link, { slug, code, origin }) | { kind: 'no-address' } (name@domain, no code) | { kind: 'invite', code, inst } (an old
// Nookara / instance invite link) | { kind: 'code', code } | { kind: 'instance', url } | null
export function joinTarget(input) {
  const s = String(input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  const invite = parseInviteLink(s);
  if (invite) return { kind: 'link', invite };
  const address = parseAddress(s);
  if (address) return address.code ? { kind: 'address', address } : { kind: 'no-address' };
  const link = parseInviteUrl(s); // an invite link whose host isn't the domain (its homeserver says which one it is)
  if (link) return { kind: 'address', address: link };
  if (/^https?:\/\//i.test(s)) {
    const inv = inviteRef(s);
    if (inv) return { kind: 'invite', code: inv.code, inst: inv.inst };
  }
  const own = OWN_HASH.exec(s); // (#/invite/<code>, as copied from the address bar)
  if (own) return { kind: 'invite', code: own[1], inst: null };
  if (CODE.test(s) && !/^\d+$/.test(s)) return { kind: 'code', code: s }; // a bare invite code (an instance address has a dot or a port): for the homeserver picked
  return { kind: 'instance', url: s };
}
