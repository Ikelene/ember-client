// A homeserver's own colours (its discovery's homeserver.theme.colors, PROTOCOL §5e) on the bits of this app that stand for it:
// homeserver chips, its initials when it has no icon, its rows in Settings > Homeservers. Only the accent is used, as a tint
// under this app's own text, so whatever the homeserver picked stays readable here.
import { useChat } from './store.js';

export const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
function lum(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
// black or white, whichever reads better on hex
export const inkFor = hex => (lum(hex) > 0.179 ? '#000000' : '#ffffff');
// the app's own scheme right now (light themes put vc-light on <html>)
export const appScheme = () => (document.documentElement.classList.contains('vc-light') ? 'light' : 'dark');

// hs: a discovery homeserver object -> CSS variables { --hs-accent, --hs-ink } | null
export function homeTint(hs, scheme = appScheme()) {
  const c = hs?.theme?.colors?.[scheme] || hs?.theme?.colors?.dark || null;
  const accent = isHex(c?.accent) ? c.accent : isHex(hs?.accent) ? hs.accent : null;
  if (!accent) return null;
  return { '--hs-accent': accent, '--hs-ink': isHex(c?.accent_ink) ? c.accent_ink : inkFor(accent) };
}
const NONE = null;
// the tint of a homeserver this device is connected to, by domain (null when it isn't, or it set no colours)
export function useHomeTint(domain) {
  const hs = useChat(s => (domain ? s.instances.find(i => i.homeserver?.domain === domain)?.homeserver || NONE : NONE));
  return hs ? homeTint(hs) : null;
}
