// The look of Ember: rounded (flat greys, small radii; chat/rounded.css) or the original square one. A per-device choice kept in
// localStorage ('bf_design'); the class on <html> is what rounded.css hangs off. index.html sets it before the first paint.
import { applyLook } from './look.js';
import { isBeta, subscribeBeta } from './beta.js';
const KEY = 'bf_design';
const subs = new Set();
export const getDesign = () => { try { return localStorage.getItem(KEY) === 'rounded' ? 'rounded' : 'square'; } catch { return 'square'; } };
// Modern (stored 'rounded') is Ember Beta only for now (beta.js): without it the app shows Classic, and the choice is kept for later
export const effectiveDesign = (d = getDesign()) => (d === 'rounded' && isBeta() ? 'rounded' : 'square');
let applied = false;
export const applyDesign = (d = getDesign()) => { applied = true; document.documentElement.classList.toggle('vc-rounded', effectiveDesign(d) === 'rounded'); applyLook(); }; // (look.js: the Modern appearance settings)
subscribeBeta(() => { if (applied) { applyDesign(); subs.forEach(f => f(getDesign())); } });
export const clearDesign = () => { applied = false; document.documentElement.classList.remove('vc-rounded'); applyLook(); };
export function setDesign(d) {
  const v = d === 'rounded' ? 'rounded' : 'square';
  try { localStorage.setItem(KEY, v); } catch { /* private mode: it lasts until the page closes */ }
  applyDesign(v);
  subs.forEach(f => f(v));
}
export const subscribeDesign = f => { subs.add(f); return () => subs.delete(f); };
