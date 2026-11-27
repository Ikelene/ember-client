import { useEffect, useState } from 'react';

// Server pictures are kept on this device as small copies (96px, by their address), so after a reload the rail shows them straight
// away instead of the initials or an empty square while the real one downloads. The real picture replaces the copy once it's loaded.
// Only pictures whose host allows it (CORS) can be copied; the rest just load as before.
const KEY = 'bf_srv_icon_cache';
const MAX = 60;
let cache = null;
const cached = () => (cache ||= (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } })());
const asked = new Set();
function keepCopy(src) {
  if (!/^https?:\/\//.test(src) || cached()[src] || asked.has(src)) return;
  asked.add(src);
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const side = Math.min(im.naturalWidth, im.naturalHeight);
      if (!side) return;
      c.getContext('2d').drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
      const data = c.toDataURL('image/webp', 0.85);
      if (data.length > 40000) return;
      const all = { ...cached(), [src]: data };
      const keys = Object.keys(all);
      while (keys.length > MAX) delete all[keys.shift()];
      cache = all;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* not copyable here (no CORS) or storage full: it just loads normally */ }
  };
  im.src = src;
}

// a server's picture; when it can't be loaded the initials stay, so a rail icon is never an empty square
export function ServerIcon({ src, name }) {
  const [bad, setBad] = useState(false);
  const [live, setLive] = useState(false);
  useEffect(() => { setBad(false); setLive(false); }, [src]);
  const initials = String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  if (!src || bad) return initials;
  const copy = !live ? cached()[src] : null;
  return (
    <>
      {copy && <img src={copy} alt="" />}
      <img src={src} alt="" referrerPolicy="no-referrer" style={copy ? { display: 'none' } : undefined} onLoad={() => { setLive(true); keepCopy(src); }} onError={() => setBad(true)} />
    </>
  );
}
