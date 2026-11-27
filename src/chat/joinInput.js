// What someone typed or pasted into Join (the "+" dialog, CreateOnHomeserver.jsx): a server's address, an invite (Nookara's or an
// instance's), or the address of an instance. Pure: the node tests load it.
import { parseAddress } from './addresses.js';
import { inviteRef } from './inviteLink.js';

const CODE = /^[A-Za-z0-9]{4,32}$/;
const OWN_HASH = /^#?\/?invite\/([A-Za-z0-9]{4,32})\/?$/;
// -> { kind: 'address', address } | { kind: 'invite', code, inst } (inst: an instance origin, null = Nookara) | { kind: 'instance', url } | null
export function joinTarget(input) {
  const s = String(input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  const address = parseAddress(s);
  if (address) return { kind: 'address', address };
  if (/^https?:\/\//i.test(s)) {
    const inv = inviteRef(s);
    if (inv) return { kind: 'invite', code: inv.code, inst: inv.inst };
  }
  const own = OWN_HASH.exec(s); // (#/invite/<code>, as copied from the address bar)
  if (own) return { kind: 'invite', code: own[1], inst: null };
  if (CODE.test(s) && !/^\d+$/.test(s)) return { kind: 'invite', code: s, inst: null }; // a bare invite code (an instance address has a dot or a port)
  return { kind: 'instance', url: s };
}
