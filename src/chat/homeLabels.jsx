// Which homeserver a server is on (its header, the rail, Discovery and invites). People don't carry a homeserver label in
// lists: their profile shows their full @username@domain.
import { Globe } from 'lucide-react';

// a small label with a homeserver's domain
export function HomeChip({ domain, title, icon = true, className = '' }) {
  if (!domain) return null;
  return <span className={`vc-hs-chip ${className}`} title={title || `On the homeserver ${domain}`}>{icon && <Globe size={10} aria-hidden="true" />}{domain}</span>;
}
