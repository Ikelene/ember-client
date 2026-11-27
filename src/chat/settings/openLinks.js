// whether this app can open links in the browser (OpenLinksCard.jsx)
import { desktopBridge } from '../../compat.js';

export function canOpenLinks() {
  if (typeof navigator === 'undefined' || typeof navigator.registerProtocolHandler !== 'function' || desktopBridge()?.isDesktop) return false;
  return location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}
