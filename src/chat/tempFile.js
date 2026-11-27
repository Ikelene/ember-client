import { TEMP_LINK, tempFileInfoNow, onTempInfo, tempFileInfo } from './store.js';
import { useState, useEffect } from 'react';
import { tempId } from './upload-dest.js';

// a file in Nookara's temporary storage: { left: 'N days' } while it's there, 'gone' once it expired, null = don't know (yet)
const leftText = s => (s < 3600 ? 'under an hour' : s < 86400 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`);

// re-renders when the answers for these temporary-storage links arrive or change; `enabled` = start asking (a message scrolled into view)
export function useTempTick(urls, enabled) {
  const [, bump] = useState(0);
  const key = urls.join('\n');
  useEffect(() => {
    const ids = new Set(urls.map(tempId).filter(Boolean));
    if (!ids.size || !enabled) return undefined;
    const off = onTempInfo(id => { if (ids.has(id)) bump(n => n + 1); });
    urls.forEach(u => tempFileInfo(u));
    return off;
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useTempFile(url, enabled = true) {
  const temp = TEMP_LINK.test(String(url || ''));
  useTempTick(temp ? [url] : [], enabled);
  const info = temp ? tempFileInfoNow(url) : null;
  if (!temp || !info) return null;
  if (info === 'gone') return 'gone';
  return { left: leftText(Math.max(0, info.expires_in - (Date.now() - info.at) / 1000)), ttl: info.ttl_days };
}
