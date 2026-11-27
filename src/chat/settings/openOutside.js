// open a link outside the app (the browser)
import { desktopBridge } from '../../compat.js';

export function openOutside(url) {
  const d = desktopBridge();
  if (d?.openExternal) { Promise.resolve(d.openExternal(url)).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
