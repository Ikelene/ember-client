import { useState, useEffect } from 'react';

// "retrying in 12 s" (it never gives up; the network / tab coming back tries at once too)
export function RetryIn({ at, busy }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.ceil(((at || 0) - now) / 1000));
  return <small>{busy || !at || !s ? 'Trying again...' : `Retrying in ${s} s`}</small>;
}
