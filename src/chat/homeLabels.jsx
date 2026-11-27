// Which homeserver a server is on (its header, the rail, Discovery and invites). People don't carry a homeserver label in
// lists: their profile shows their full @username@domain.
import { Globe } from 'lucide-react';
import { useHomeTint } from './homeTint.js';

// a small label with a homeserver's domain
export function HomeChip({ domain, title, icon = true, className = '' }) {
  const tint = useHomeTint(domain || null); // (tinted with the homeserver's own accent when this device knows it)
  if (!domain) return null;
  return <span className={`vc-hs-chip ${className}${tint ? ' tinted' : ''}`} style={tint || undefined} title={title || `On the homeserver ${domain}`}>{icon && <Globe size={10} aria-hidden="true" />}{domain}</span>;
}
