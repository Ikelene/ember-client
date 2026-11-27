import { toast } from './store.js';
import { saveMedia } from './mediaDownload.js';

// viewMedia({ items: [{ url, name, type }], index, author, at })
export function viewMedia(detail) {
  if (!detail?.items?.length) return;
  dispatchEvent(new CustomEvent('vc-view-media', { detail }));
}

// right-click a picture: copy it (as PNG - what the clipboard takes) or save it
export async function copyImage(url) {
  try {
    const blob = await (await fetch(url, { credentials: 'omit' })).blob();
    let png = blob;
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      png = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Image copied', true);
  } catch { toast("Couldn't copy that image - try Download image instead."); }
}

export async function downloadImage(url, name) {
  try {
    await saveMedia(url, name);
  } catch { window.open(url, '_blank', 'noopener,noreferrer'); }
}

export function viewPicture(url, extra = {}) { viewMedia({ items: [{ url, type: /\.gif(\?|$)/i.test(url) ? 'gif' : 'image' }], index: 0, ...extra }); }
