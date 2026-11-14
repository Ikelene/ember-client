// Appearance settings for the Modern look (Theme + Text & layout pages), kept per device in localStorage 'bf_look'.
// applyLook() writes them onto <html> (CSS variables + a few classes) while Modern is on, and clears them in Classic, which
// always looks exactly as it did. A few behaviour settings (blocked messages, client icons) apply in both looks.
const KEY = 'bf_look';
const BG_KEY = 'bf_look_bg';     // background image (data URL), kept apart because it's big
const FONT_KEY = 'bf_look_font'; // a custom .ttf (data URL)

export const THEMES = {
  dark: { name: 'Dark', app: '#0b0b0d', side: '#131316', main: '#18181b', raised: '#202024', hover: '#222226', on: '#2c2c32', text: '#e2e2e6' },
  midnight: { name: 'Midnight', app: '#060912', side: '#0c1120', main: '#101629', raised: '#172036', hover: '#1a2440', on: '#24304f', text: '#e3e8f5', accent: '#7aa2ff' },
  dim: { name: 'Dim', app: '#1a1a1f', side: '#222228', main: '#28282f', raised: '#313139', hover: '#33333b', on: '#3d3d47', text: '#ececf1', accent: '#f0a37a' },
  amoled: { name: 'AMOLED', app: '#000000', side: '#000000', main: '#050505', raised: '#111111', hover: '#141414', on: '#1f1f1f', text: '#f2f2f2', accent: '#b6f36a' },
  ocean: { name: 'Ocean', app: '#04131a', side: '#081d26', main: '#0b2530', raised: '#11313e', hover: '#133744', on: '#1b4555', text: '#e0f4f8', accent: '#3fd0e0' },
  forest: { name: 'Forest', app: '#07120b', side: '#0d1b12', main: '#112217', raised: '#182d1f', hover: '#1b3223', on: '#244030', text: '#e4f2e8', accent: '#7bd88f' },
  dracula: { name: 'Dracula', app: '#191a21', side: '#21222c', main: '#282a36', raised: '#313343', hover: '#343746', on: '#44475a', text: '#f8f8f2', accent: '#bd93f9' },
  nord: { name: 'Nord', app: '#242933', side: '#2b313c', main: '#2e3440', raised: '#3b4252', hover: '#3d4454', on: '#4c566a', text: '#eceff4', accent: '#88c0d0' },
  rose: { name: 'Rosé', app: '#150b10', side: '#1d1017', main: '#23131c', raised: '#2e1925', hover: '#321b28', on: '#432435', text: '#f6e6ee', accent: '#f39ac7' },
  mocha: { name: 'Mocha', app: '#11111b', side: '#181825', main: '#1e1e2e', raised: '#28283b', hover: '#2b2b3f', on: '#36364d', text: '#cdd6f4', accent: '#cba6f7' },
  sunset: { name: 'Sunset', app: '#160c0a', side: '#1f110e', main: '#261612', raised: '#331e18', hover: '#38211a', on: '#4a2c22', text: '#f8e7df', accent: '#ff9966' },
  // light themes (html.vc-light: modern.css light tokens + the generated light.css)
  light: { name: 'Light', light: true, app: '#e4e4ea', side: '#f0f0f4', main: '#ffffff', raised: '#f3f3f6', hover: '#eaeaef', on: '#dedee6', text: '#1d1d23', accent: '#c94f8a' },
  paper: { name: 'Paper', light: true, app: '#e9e3d8', side: '#f3eee5', main: '#fbf8f2', raised: '#f1ebe0', hover: '#ebe4d8', on: '#e1d8c9', text: '#2b241c', accent: '#b5562b' },
  frost: { name: 'Frost', light: true, app: '#dde6ee', side: '#eaf0f5', main: '#f8fbfd', raised: '#edf2f7', hover: '#e4ebf2', on: '#d6e0ea', text: '#17212b', accent: '#2f6fd1' },
};
export const RADIUS = { none: 0, small: 0.5, medium: 1, large: 1.6 };
export const FONTS = {
  roboto: { name: 'Roboto', sub: 'Ember Modern default', stack: "'Ember Roboto', Roboto, system-ui, sans-serif" },
  system: { name: 'System', sub: 'Segoe UI / San Francisco', stack: "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" },
  humanist: { name: 'Humanist', sub: 'Verdana / Tahoma', stack: "Verdana, Tahoma, 'DejaVu Sans', sans-serif" },
  serif: { name: 'Serif', sub: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  mono: { name: 'Monospace', sub: 'Consolas / SF Mono', stack: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace" },
  custom: { name: 'Custom', sub: 'Your .ttf file', stack: "'Ember Custom', 'Ember Roboto', sans-serif" },
};
export const DENSITY = { spacious: 22, comfortable: 14, compact: 6 };
export const EMOJI = { small: 16, default: 22, large: 30 };

export const DEFAULT_LOOK = {
  theme: 'dark', bg: '', panel: '', text: '', accent: '', mention: '',
  radius: 'medium', textSize: 15.5, font: 'roboto', density: 'comfortable', emoji: 'default', hideScroll: false,
  recentPosters: true, clientIcons: true, blocked: 'button',
};

const subs = new Set();
let cache = null;
export function getLook() {
  if (cache) return cache;
  try { cache = { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { cache = { ...DEFAULT_LOOK }; }
  return cache;
}
export function setLook(patch) {
  cache = { ...getLook(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode: lasts until the page closes */ }
  applyLook();
  subs.forEach(f => f(cache));
}
export const subscribeLook = f => { subs.add(f); return () => subs.delete(f); };
export function resetLook(keys) { setLook(Object.fromEntries(keys.map(k => [k, DEFAULT_LOOK[k]]))); }

export const getBgImage = () => { try { return localStorage.getItem(BG_KEY) || ''; } catch { return ''; } };
export function setBgImage(dataUrl) {
  try { if (dataUrl) localStorage.setItem(BG_KEY, dataUrl); else localStorage.removeItem(BG_KEY); } catch { throw new Error('too_big'); }
  applyLook(); subs.forEach(f => f(getLook()));
}
export const hasCustomFont = () => { try { return !!localStorage.getItem(FONT_KEY); } catch { return false; } };
export function setCustomFont(dataUrl) {
  try { if (dataUrl) localStorage.setItem(FONT_KEY, dataUrl); else localStorage.removeItem(FONT_KEY); } catch { throw new Error('too_big'); }
  loadedFont = null;
  applyLook(); subs.forEach(f => f(getLook()));
}
let loadedFont = null;
function loadCustomFont() {
  if (loadedFont) return;
  let url = '';
  try { url = localStorage.getItem(FONT_KEY) || ''; } catch { /* none */ }
  if (!url) return;
  loadedFont = new FontFace('Ember Custom', `url(${url})`);
  loadedFont.load().then(f => document.fonts.add(f)).catch(() => { loadedFont = null; });
}

const VARS = ['--m-app', '--m-side', '--m-main', '--m-raised', '--m-hover', '--m-on', '--m-text-color', '--rk', '--m-text', '--m-emoji', '--m-jumbo', '--m-gap-msg', '--m-font', '--m-mention', '--m-bgimg'];
const hexOk = v => /^#[0-9a-f]{6}$/i.test(v || '');
const mix = (a, b, p) => `color-mix(in srgb, ${a} ${100 - p}%, ${b} ${p}%)`;
export function applyLook() {
  const root = document.documentElement;
  const body = document.body;
  const modern = root.classList.contains('vc-rounded');
  const L = getLook();
  // behaviour, both looks
  root.classList.toggle('vc-no-client-icons', !L.clientIcons);
  if (!modern) {
    VARS.forEach(v => root.style.removeProperty(v));
    body?.style.removeProperty('--accent'); body?.style.removeProperty('--accent-dim');
    root.classList.remove('vc-hide-scroll', 'vc-recent-off', 'vc-has-bgimg', 'vc-light');
    return;
  }
  const t = THEMES[L.theme] || THEMES.dark;
  const app = hexOk(L.bg) ? L.bg : t.app;
  const panel = hexOk(L.panel) ? L.panel : t.raised;
  const set = (k, v) => root.style.setProperty(k, v);
  set('--m-app', app);
  set('--m-side', hexOk(L.bg) ? mix(app, '#ffffff', 4) : t.side);
  set('--m-main', hexOk(L.bg) ? mix(app, '#ffffff', 6) : t.main);
  set('--m-raised', panel);
  set('--m-hover', hexOk(L.panel) ? mix(panel, '#ffffff', 3) : t.hover);
  set('--m-on', hexOk(L.panel) ? mix(panel, '#ffffff', 9) : t.on);
  set('--m-text-color', hexOk(L.text) ? L.text : t.text);
  set('--rk', String(RADIUS[L.radius] ?? 1));
  set('--m-text', `${Math.min(22, Math.max(12, Number(L.textSize) || 15.5))}px`);
  // emojis grow and shrink with the message text size too (Ikelene 2026-11-14), on top of their own small / default / large
  const textK = Math.min(22, Math.max(12, Number(L.textSize) || 15.5)) / 15.5;
  set('--m-emoji', `${Math.round((EMOJI[L.emoji] || 22) * textK)}px`);
  set('--m-jumbo', `${Math.round(48 * textK)}px`);
  set('--m-gap-msg', `${DENSITY[L.density] ?? 14}px`);
  if (L.font === 'custom') loadCustomFont();
  set('--m-font', (FONTS[L.font] || FONTS.roboto).stack);
  set('--m-mention', hexOk(L.mention) ? L.mention : 'var(--accent)');
  const accent = hexOk(L.accent) ? L.accent : t.accent || '';
  if (accent && body) {
    const n = parseInt(accent.slice(1), 16);
    body.style.setProperty('--accent', accent);
    body.style.setProperty('--accent-dim', `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .14)`);
  } else { body?.style.removeProperty('--accent'); body?.style.removeProperty('--accent-dim'); }
  // (the background picture setting is gone: an old one is dropped)
  if (getBgImage()) setBgImage('');
  root.style.removeProperty('--m-bgimg');
  root.classList.remove('vc-has-bgimg');
  root.classList.toggle('vc-hide-scroll', !!L.hideScroll);
  root.classList.toggle('vc-recent-off', !L.recentPosters);
  root.classList.toggle('vc-light', !!t.light);
}
