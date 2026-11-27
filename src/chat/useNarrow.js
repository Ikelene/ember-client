import { useState, useEffect } from 'react';

// phones: the pages come as a full-width list first, then slide in one at a time (see SettingsDialog.css .bf-sd.m)
const NARROW = '(max-width: 700px)';

export function useNarrow() {
  const [n, setN] = useState(() => !!window.matchMedia?.(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW);
    if (!m) return undefined;
    const on = () => setN(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}
