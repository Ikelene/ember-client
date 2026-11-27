import { useChat } from './store.js';
import { useState, useEffect } from 'react';

// true once the home socket has been down for `ms` in a row. Short drops (a server restart, a network blip) reconnect by
// themselves, so nothing should say so until then.
export const CONN_LOST_MS = 15000;

export function useConnLost(ms = CONN_LOST_MS) {
  const up = useChat(s => s.conn === 'open');
  const [lost, setLost] = useState(false);
  // (counted while the app is on screen: coming back from another app restarts it, so a phone that was away doesn't get the
  // popup the moment it's back while the socket is reconnecting anyway - Ikelene 2026-11-22)
  const [shown, setShown] = useState(0);
  useEffect(() => { const v = () => { if (document.visibilityState === 'visible') { setLost(false); setShown(n => n + 1); } }; document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v); }, []);
  useEffect(() => { if (up) { setLost(false); return undefined; } const t = setTimeout(() => setLost(true), ms); return () => clearTimeout(t); }, [up, ms, shown]);
  return !up && lost;
}
