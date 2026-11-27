// A homeserver's branding as its admins edit it (PROTOCOL §5e: GET / PATCH / DELETE /api/v2/homeserver/branding): how its own
// pages (sign-in, account, invites, landing) look. The form is a copy of the saved object; a save sends only what changed, and
// null puts a key back to its default. BrandingTab.jsx draws it.
import { isHex } from '../homeTint.js';

export { isHex };
export const COLOR_KEYS = [['accent', 'Accent'], ['background', 'Background'], ['surface', 'Cards'], ['text', 'Text'], ['muted', 'Quiet text'], ['border', 'Borders']];
export const IMAGE_KINDS = [['icon', 'icon_url', 'Icon'], ['logo', 'logo_url', 'Logo'], ['banner', 'banner_url', 'Banner'], ['background', 'theme.background_url', 'Page background']];
export const FONTS = [['system', 'System'], ['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Monospace'], ['rounded', 'Rounded'], ['humanist', 'Humanist'], ['custom', 'Your own (upload)']];
export const SCHEMES = [['auto', 'Follow the device'], ['dark', 'Always dark'], ['light', 'Always light']];
export const DENSITIES = [['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Roomy']];
export const BANNER_POS = [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']];
export const HEADERS = [['icon', 'Icon and name'], ['logo', 'Logo']];
// [path, label, [min, max] from limits (key), unit]
export const NUMBERS = [['theme.radius', 'Corner roundness', 'radius', 'px'], ['theme.button_radius', 'Button roundness', 'button_radius', 'px'], ['theme.font_size', 'Text size', 'font_size', 'px'],
  ['theme.banner_height', 'Banner height', 'banner_height', 'px'], ['theme.page_width', 'Page width', 'page_width', 'px']];
export const DEFAULT_LIMITS = { name: 64, custom_css_bytes: 51200, radius: [0, 24], button_radius: [0, 24], font_size: [12, 20], banner_height: [0, 320], page_width: [320, 960] };

// every key the form edits, as a path
export const LEAVES = ['name', 'icon_url', 'banner_url', 'logo_url', 'accent', 'custom_css',
  'theme.scheme', ...['dark', 'light'].flatMap(s => COLOR_KEYS.map(([k]) => `theme.${s}.${k}`)),
  'theme.radius', 'theme.button_radius', 'theme.font', 'theme.font_url', 'theme.font_size', 'theme.density',
  'theme.banner_height', 'theme.banner_position', 'theme.header', 'theme.page_width', 'theme.background_url'];

export const getPath = (o, path) => path.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
export function setPath(o, path, v) {
  const [k, ...rest] = path.split('.');
  const base = o && typeof o === 'object' ? o : {};
  return { ...base, [k]: rest.length ? setPath(base[k], rest.join('.'), v) : v };
}
const blank = v => v === undefined || v === null || v === '';
const same = (a, b) => (blank(a) && blank(b)) || String(a) === String(b);
const NUMERIC = new Set(NUMBERS.map(([p]) => p));

// saved, draft -> the PATCH body (only what changed; null = back to the default), {} when nothing did
export function brandingPatch(saved, draft) {
  let out = {};
  for (const p of LEAVES) {
    const a = getPath(saved, p), b = getPath(draft, p);
    if (same(a, b)) continue;
    out = setPath(out, p, blank(b) ? null : NUMERIC.has(p) ? Number(b) : b);
  }
  return out;
}
export const changedCount = (saved, draft) => LEAVES.filter(p => !same(getPath(saved, p), getPath(draft, p))).length;
export const byteLength = s => new TextEncoder().encode(String(s || '')).length;

// a field the server named (theme.dark.text) -> the words for its reason
const REASONS = {
  invalid: "isn't valid.", unknown: "isn't a setting this homeserver knows.", out_of_range: 'is out of range.', https_or_own: 'has to be an https address or one of your uploads.',
  missing: 'needs a value (a custom font needs its file).', low_contrast: "doesn't stand out enough from the colours around it to be read.", too_large: 'is too big.',
  import: "can't use @import.", expression: "can't use expression().", script_url: "can't use javascript: or vbscript: addresses.", behavior: "can't use behavior.",
  binding: "can't use -moz-binding.", markup: "can't contain </style>, <!-- or <script>.", src_function: "can't use src().", url_not_allowed: 'can only point at https addresses, this homeserver, or data: pictures.',
};
export function brandingErrorText(field, reason) {
  const what = field === 'custom_css' ? 'The custom CSS' : `This ${String(field || 'value').split('.').pop().replace(/_/g, ' ')}`;
  if (reason === 'low_contrast' && /text|muted/.test(field || '')) return 'Not readable enough on the background and cards (text needs 4.5:1, quiet text 3:1).';
  return `${what} ${REASONS[reason] || "can't be saved."}`;
}
