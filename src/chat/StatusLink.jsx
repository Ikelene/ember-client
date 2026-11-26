import { Activity } from 'lucide-react';
import { statusUrl } from './status.js';
import { desktopBridge } from '../compat.js';

// "Status page" link for the can't-connect notes: opens ikelene.net/status with that service already open (id: see status.js).
// The desktop app opens it in the system browser; elsewhere it's a plain new-tab link.
export function StatusLink({ id = 'ember', className = '', label = 'Status page', icon = true, size = 14 }) {
  const url = statusUrl(id);
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer"
      onClick={e => { const d = desktopBridge(); if (d?.openExternal) { e.preventDefault(); Promise.resolve(d.openExternal(url)).catch(() => {}); } }}>
      {icon && <Activity size={size} />}{icon ? ' ' : ''}{label}
    </a>
  );
}
