// an invite link opened before signing in, kept until there is an account to use it (AddressInvite.jsx)
import { parseAddress } from './addresses.js';

const KEPT = 'ember_pending_invite';

export function keepInvite(hash) { try { sessionStorage.setItem(KEPT, hash); } catch { /* private mode: it is just not finished after */ } }

export function dropInvite() { try { sessionStorage.removeItem(KEPT); } catch { /* fine */ } }

// the kept invite (an address with its code), taken off the list -> { slug, domain, address, code } | null
export function takeInvite() {
  let h = null;
  try { h = sessionStorage.getItem(KEPT); sessionStorage.removeItem(KEPT); } catch { /* none */ }
  return h ? parseAddress(h) : null;
}
