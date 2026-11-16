// Crop a picked picture in the browser (server settings: the server icon and banner; Ikelene 2026-11-16). The servers' icon /
// banner uploads take a file as it is, so the cut happens here: the chosen box ({ x, y, w, h } in the picture's own pixels,
// from ImageCropper), shrunk to at most maxW x maxH, saved as WebP (PNG where the browser can't write WebP).

// the output size for a crop box: never bigger than the box itself, never bigger than the target
export function cropSize(box, maxW, maxH) {
  const k = Math.min(1, maxW / box.w, maxH / box.h);
  return { w: Math.max(1, Math.round(box.w * k)), h: Math.max(1, Math.round(box.h * k)) };
}

// an Ember server keeps GIFs animated; a crop would turn one into a still, so those go up uncropped
export const keepsAnimation = (file, inst) => !!inst && /^image\/gif$/i.test(file?.type || '');

// A photo from Android's picker can be a file whose blob: address won't load as a picture (the cropper stayed black on
// phones), while reading its bytes works. A copy in memory always loads, so the cropper and the cut work on one.
export async function inMemory(file) {
  if (!file || file.__inMemory) return file;
  const copy = new File([await file.arrayBuffer()], file.name || 'image', { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(copy, '__inMemory', { value: true });
  return copy;
}

export async function cropToFile(file, box, maxW, maxH) {
  file = await inMemory(file);
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      try {
        const { w, h } = cropSize(box, maxW, maxH);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, w, h);
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        cv.toBlob(b => {
          if (!b) { reject(new Error('bad_image')); return; }
          const ext = b.type === 'image/webp' ? 'webp' : 'png';
          resolve(new File([b], `${base}.${ext}`, { type: b.type }));
        }, 'image/webp', 0.92);
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('bad_image')); };
    img.src = src;
  });
}
