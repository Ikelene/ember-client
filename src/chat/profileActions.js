import { savedEmberAccounts, switchEmberAccount, signOutNookara } from './session.js';
import { SITE_SAVED, SITE_TOKEN, SITE_ACCENT, SITE_ACCENT_AT, SITE_ME_CACHE, desktopBridge } from '../compat.js';
import { toast } from './store.js';
import { isWebEmber } from '../api.js';

// local time from a UTC offset in minutes (what other people get), or from a time zone name (the editor's draft)
export function localTimeFrom({ tzOffsetMin, timeZone }) {
  try {
    // (Alberta stays on UTC-6 since 2026-11-01, newer than browsers' time zone data)
    if (timeZone) return new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timeZone === 'America/Edmonton' ? 'Etc/GMT+6' : timeZone });
    if (Number.isFinite(tzOffsetMin)) return new Date(Date.now() + (tzOffsetMin + new Date().getTimezoneOffset()) * 60000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { /* bad zone */ }
  return '';
}

// the accounts saved on this device (same list as the login page's "Choose an account" and the site's account menu)
export const web = () => isWebEmber();

export function savedAccounts() {
  if (web()) return savedEmberAccounts();
  try { const a = JSON.parse(localStorage.getItem(SITE_SAVED) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.username && x.token) : []; } catch { return []; }
}

export async function switchTo(a, setBusy) {
  setBusy(a.username);
  if (web()) {
    try { await switchEmberAccount(a); } catch (e) {
      setBusy('');
      toast(e.message === 'ended' ? `${a.username} was signed out - sign in again with "Add another account".` : "Couldn't reach Nookara - try again.");
    }
    return;
  }
  try {
    const r = await fetch('/auth/validate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ token: a.token }) });
    const d = await r.json().catch(() => ({}));
    if (!d?.valid) throw new Error('ended');
    localStorage.setItem(SITE_TOKEN, a.token);
    [SITE_ACCENT, SITE_ACCENT_AT, SITE_ME_CACHE].forEach(k => localStorage.removeItem(k));
    location.reload();
  } catch {
    try { localStorage.setItem(SITE_SAVED, JSON.stringify(savedAccounts().filter(x => x.username.toLowerCase() !== a.username.toLowerCase()))); } catch { /* fine */ }
    setBusy('');
    toast(`${a.username} was signed out on this device - sign in again with "Add another account".`);
  }
}

// the switcher's Sign out (the other one is Settings > Account): the same as Settings' Log out (the lockout screen uses it too)
export async function signOut() {
  if (isWebEmber()) { await signOutNookara(); return; } // Ember's own sign-in only; the website's session stays
  try { localStorage.removeItem(SITE_TOKEN); localStorage.removeItem(SITE_ME_CACHE); } catch { /* fine */ }
  if (desktopBridge()?.logout) await desktopBridge().logout();
  else location.assign('/login');
}
