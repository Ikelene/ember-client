// Generates src/chat/light.css: the Light theme's overrides for every hard-coded colour in Ember's stylesheets.
// Ember's CSS was written dark-first with literal colours (white text, near-black panels, gradients), so a light theme
// can't come from variables alone. This walks each stylesheet, finds rules that set a literal colour, and re-emits them
// under html.vc-rounded.vc-light with the colour flipped: light text -> dark text, dark surfaces -> light surfaces,
// saturated colours kept in hue but darkened (text) or washed out (backgrounds), white tints -> black tints.
// Run after changing colours in any of the files below:  node scripts/gen-light-css.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['src/styles.css', 'src/chat/chat.css', 'src/chat/rounded.css', 'src/chat/modern.css', 'src/chat/panel.css', 'src/chat/dashboard.css', 'src/chat/home.css', 'src/chat/settings/beta-page.css',
  'src/chat/SettingsDialog.css', 'src/chat/ProfilePopout.css', 'src/chat/Bots.css', 'src/chat/Commands.css', 'src/chat/Insights.css', 'src/chat/Reactions.css', 'src/chat/E2ee.css',
  'src/chat/settings/settings-ui.css', 'src/chat/settings/look-pages.css', 'src/chat/settings/accounts-pages.css', 'src/chat/settings/voice-page.css'];
const PREFIX = 'html.vc-rounded.vc-light';
const COLOR_PROPS = new Set(['color', 'background', 'background-color', 'background-image', 'border-color', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-top-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'fill', 'stroke', 'box-shadow', '-webkit-text-fill-color', 'caret-color', 'text-shadow']);

const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = ([r, g, b]) => `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// a literal colour, as text (color property): light -> dark, mid -> mid-dark, saturated -> same hue, darker
function textColor(rgb) {
  const L = lum(rgb), S = sat(rgb);
  if (S > 0.22) return rgb2hex(mixc(rgb, [0, 0, 0], L > 0.55 ? 0.42 : 0.2));
  if (L > 0.8) return '#16161b';
  if (L > 0.6) return '#2a2a32';
  if (L > 0.42) return '#4a4a55';
  if (L > 0.25) return '#6b6b77';
  return '#8a8a96';
}
// as a surface (background, border, shadow tint): dark greys -> light greys, saturated darks -> washed-out tints
function surfaceColor(rgb, prop) {
  const L = lum(rgb), S = sat(rgb);
  if (S > 0.22) return L < 0.35 ? rgb2hex(mixc(rgb, [255, 255, 255], 0.86)) : rgb2hex(rgb);
  if (prop.startsWith('border') || prop === 'outline-color') return L < 0.35 ? rgb2hex([214, 214, 222]) : rgb2hex(rgb);
  if (L < 0.35) { const v = 255 - L * 150; return rgb2hex([v, v, v + 3]); }
  return rgb2hex(rgb);
}
function flipValue(prop, value) {
  const isText = prop === 'color' || prop === '-webkit-text-fill-color' || prop === 'caret-color' || prop === 'fill' && false;
  let changed = false;
  let v = value.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, m => { const out = isText ? textColor(hex2rgb(m)) : surfaceColor(hex2rgb(m), prop); if (out.toLowerCase() !== m.toLowerCase()) changed = true; return out; });
  v = v.replace(/rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*([\d.]+))?\s*\)/g, (m, _a, a) => { if (prop === 'text-shadow') return m; changed = true; return isText ? `rgba(22, 22, 27, ${a ?? 1})` : `rgba(0, 0, 0, ${Math.min(0.12, Number(a ?? 1) * 1.2)})`; });
  if (prop === 'text-shadow' && /rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(v)) { v = 'none'; changed = true; }
  if (/^\s*#fff(fff)?\s*$/i.test(value) && isText) { v = '#16161b'; changed = true; }
  return changed ? v : null;
}

function strip(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
// split a block into { sel, body } rules and nested at-blocks (only @media / @supports are kept)
function parse(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) out.push({ at: head, rules: parse(body) });
    else if (!head.startsWith('@')) out.push({ sel: head.replace(/^[;}\s]+/, ''), body });
    i = j;
  }
  return out;
}
function prefixSel(sel) {
  return sel.split(',').map(s => {
    s = s.trim();
    if (!s) return s;
    if (/^html\.vc-rounded/.test(s)) return s.replace(/^html\.vc-rounded/, PREFIX);
    if (/^html(?=[.:\[ ]|$)/.test(s)) return s.replace(/^html/, PREFIX);
    if (/^:root/.test(s)) return s.replace(/^:root/, PREFIX);
    if (/^body\b/.test(s)) return `${PREFIX} ${s}`;
    return `${PREFIX} ${s}`;
  }).join(', ');
}
function emit(rules, indent = '') {
  let o = '';
  for (const r of rules) {
    if (r.at) { const inner = emit(r.rules, indent + '  '); if (inner) o += `${indent}${r.at} {\n${inner}${indent}}\n`; continue; }
    if (/(^|,)\s*html\.vc-rounded\.vc-light/.test(r.sel)) continue; // already light-specific
    const decls = r.body.split(';').map(d => d.trim()).filter(Boolean);
    const outDecls = [];
    // text sitting on a coloured fill (a red badge, an accent button, a status colour) keeps its light colour
    const onColour = decls.some(d => /^background(-color)?\s*:/i.test(d) && (/var\(--(red|accent|st-|green|danger)/.test(d) || [...d.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})/gi)].some(m => { const c = hex2rgb(m[0]); return sat(c) > 0.3 && lum(c) > 0.18; })));
    for (const d of decls) {
      const k = d.indexOf(':');
      if (k < 0) continue;
      const prop = d.slice(0, k).trim().toLowerCase();
      if (!COLOR_PROPS.has(prop) || prop.startsWith('--')) continue;
      const val = d.slice(k + 1).trim().replace(/\s*!important$/, '');
      if (onColour && (prop === 'color' || prop === '-webkit-text-fill-color')) continue;
      const nv = flipValue(prop, val);
      if (nv != null) outDecls.push(`${prop}: ${nv}${/!important$/.test(d) ? ' !important' : ''}`);
    }
    if (outDecls.length) o += `${indent}${prefixSel(r.sel)} { ${outDecls.join('; ')}; }\n`;
  }
  return o;
}

let out = `/* GENERATED by scripts/gen-light-css.mjs - do not edit by hand. The Light theme (Modern look): every literal colour in
   Ember's stylesheets, flipped for a light background. Hand-written light rules live at the end of modern.css. */\n`;
for (const f of FILES) {
  let css;
  try { css = readFileSync(f, 'utf8'); } catch { continue; }
  const body = emit(parse(strip(css)));
  if (body) out += `\n/* ── ${f} ── */\n${body}`;
}
writeFileSync('src/chat/light.css', out);
console.log('wrote src/chat/light.css', out.length, 'bytes');
