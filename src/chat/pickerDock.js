// Phones: the composer's emoji and media (GIF) pickers take the keyboard's place (Ikelene 2026-11-15): opening one closes the
// keyboard, the picker sits under the chat box at the keyboard's height, and nothing in it focuses by itself (that would
// bring the keyboard straight back). Tapping the chat box closes the picker and the keyboard comes back; the Android back
// button closes it first (sheets.js). Desktop keeps the pop-up pickers.
import { useEffect, useState } from 'react';

export const DOCK_QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1100px)'; // (the same as sheets.js)
const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DOCK_QUERY) : null);

export function useDocked() {
  const [on, setOn] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq();
    if (!m) return undefined;
    const f = () => setOn(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  return on;
}

// ── the keyboard's height, learned while typing (visualViewport), so the picker can be just as tall ──
const KEY = 'vc_kb_h';
let kb = 0;
try { kb = Number(localStorage.getItem(KEY)) || 0; } catch { kb = 0; }
let base = typeof window !== 'undefined' ? window.innerHeight : 0; // the page's height without a keyboard
const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)); };
let watching = false;
export function watchKeyboard() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const vv = window.visualViewport;
  const measure = () => {
    if (!typing()) { base = Math.max(window.innerHeight, vv ? vv.height : 0); return; }
    const h = Math.round(base - (vv ? vv.height : window.innerHeight));
    if (h > 120 && h < base * 0.75 && Math.abs(h - kb) > 4) { kb = h; try { localStorage.setItem(KEY, String(h)); } catch { /* fine */ } }
  };
  vv?.addEventListener('resize', measure);
  addEventListener('resize', measure);
  addEventListener('orientationchange', () => { base = 0; setTimeout(measure, 300); });
}
// how tall the docked picker is: the keyboard's last height, else 40% of the screen
export function dockHeight() {
  const h = window.innerHeight;
  const want = kb || Math.round(h * 0.4);
  return Math.max(220, Math.min(want, Math.round(h * 0.6)));
}

// close the keyboard (the chat box loses focus)
export function closeKeyboard() {
  const a = document.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName))) a.blur();
}

// put something into the chat box without opening the keyboard (the picker stays open for more)
export function withoutKeyboard(el, fn) {
  const prev = el.getAttribute('inputmode');
  el.setAttribute('inputmode', 'none');
  try { fn(); } finally {
    el.blur();
    if (prev == null) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', prev);
  }
}

// the back button (Android, browsers) closes an open docked picker first, like a sheet (sheets.js does the same for sheets)
export function useBackCloses(open, close) {
  useEffect(() => {
    if (!open) return undefined;
    let mine = true;
    history.pushState({ vcDock: 1 }, '', location.href);
    const onPop = () => { if (mine) { mine = false; close(); } };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      if (mine && history.state?.vcDock) { mine = false; history.back(); } // closed some other way: drop our history entry
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
