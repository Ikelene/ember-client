// The look of Ember: Modern (stored 'rounded', the default) or Classic (stored 'square', the original sharp one). A per-device
// choice kept in localStorage ('bf_design'); the class on <html> is what the Modern CSS hangs off. index.html sets it before the
// first paint, and moves anyone still on Classic to Modern once (bf_modern_default: 'notice' until ModernNotice is answered).
import { applyLook } from './look.js';
const KEY = 'bf_design';
const subs = new Set();
export const getDesign = () => { try { return localStorage.getItem(KEY) === 'square' ? 'square' : 'rounded'; } catch { return 'rounded'; } };
export const effectiveDesign = (d = getDesign()) => d;
let applied = false;
export const applyDesign = (d = getDesign()) => { applied = true; document.documentElement.classList.toggle('vc-rounded', effectiveDesign(d) === 'rounded'); applyLook(); }; // (look.js: the Modern appearance settings)
export const clearDesign = () => { applied = false; document.documentElement.classList.remove('vc-rounded'); applyLook(); };
export function setDesign(d) {
  const v = d === 'rounded' ? 'rounded' : 'square';
  try { localStorage.setItem(KEY, v); } catch { /* private mode: it lasts until the page closes */ }
  applyDesign(v);
  subs.forEach(f => f(v));
}
export const subscribeDesign = f => { subs.add(f); return () => subs.delete(f); };
