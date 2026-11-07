// Ember Beta: early versions of Ember (right now the Modern look) are for people with a running Ember Beta membership on
// Nookara (GET /chat/beta, ember-beta.js on the server; selling the product doesn't count, everyone needs the membership).
// The last answer is kept in localStorage 'bf_beta' so the first paint (index.html) doesn't flash Modern for someone who
// isn't in, or Classic for someone who is.
import { apiFetch } from '../api.js';

const KEY = 'bf_beta';
const cached = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
let state = { beta: cached(), membership: null, product: null, loaded: false, error: false };
const subs = new Set();
export const getBeta = () => state;
export const isBeta = () => state.beta === true;
export const subscribeBeta = f => { subs.add(f); return () => subs.delete(f); };
function set(patch) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, state.beta ? '1' : '0'); } catch { /* private mode */ }
  subs.forEach(f => f(state));
}
let last = 0;
let inflight = null;
// signedIn false (web Ember without a Nookara sign-in): never beta
export function loadBeta({ force = false, signedIn = true } = {}) {
  if (!signedIn) { if (state.beta || !state.loaded) set({ beta: false, membership: null, loaded: true }); return Promise.resolve(state); }
  if (inflight) return inflight;
  if (!force && Date.now() - last < 60000 && state.loaded) return Promise.resolve(state);
  last = Date.now();
  inflight = apiFetch(force ? '/chat/beta/refresh' : '/chat/beta', force ? { method: 'POST' } : undefined)
    .then(d => { set({ beta: !!d.beta, membership: d.membership || null, product: d.product || null, loaded: true, error: false }); return state; })
    .catch(() => { set({ loaded: true, error: true }); return state; }) // (keeps the last known answer)
    .finally(() => { inflight = null; });
  return inflight;
}
// Join: put the membership in the Nookara cart and open checkout in the browser
export async function joinBeta() {
  const id = state.product?.id;
  if (!id) throw new Error('beta_unavailable');
  const d = await apiFetch('/cart/items', { method: 'POST', body: JSON.stringify({ product_id: id }) });
  return d.checkout_url || '/checkout';
}
