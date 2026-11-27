import { desktopBridge } from '../compat.js';

// Ember's logo: a chat bubble drawn as one soft outline (the tail's corner is rounded off). It is plain inline SVG in
// currentColor, so it takes the surrounding text colour and costs nothing to load. `tile` adds the dark rounded square behind it.
export const EMBER_MARK = 'M50 14A36 36 0 0 1 86 50A36 36 0 0 1 50 86H25Q14 86 14 75V50A36 36 0 0 1 50 14Z';

export const isDesktopApp = () => typeof window !== 'undefined' && !!desktopBridge()?.isDesktop;
