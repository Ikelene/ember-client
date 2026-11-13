// what an encrypted file shows as. Pure, the node tests load it.
const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska', ogv: 'video/ogg', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', weba: 'audio/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', gif: 'image/gif' };
const extOf = name => (/\.([a-z0-9]{1,5})$/i.exec(String(name || '')) || [])[1]?.toLowerCase() || '';
const generic = mime => !mime || /^application\/(octet-stream|x-binary)$/i.test(mime);
// the type to open it as: its own, or (when that says nothing) the one its name implies
export const mimeOf = (mime, name) => (generic(mime) ? MIME[extOf(name)] || mime || 'application/octet-stream' : mime);
export const fileKindOfMime = (mime, name) => {
  const m = mimeOf(mime, name);
  return /^image\/gif$/.test(m) ? 'gif' : /^image\//.test(m) ? 'image' : /^video\//.test(m) ? 'video' : /^audio\//.test(m) ? 'audio' : 'file';
};
// pictures, GIFs, videos and sounds open by themselves (when they come into view, up to AUTO_MAX); other files wait for a click
export const opensByItself = a => ['image', 'gif', 'audio', 'video'].includes(a.type);
// the most that opens by itself: less on a metered / data-saver connection. Bigger ones show their size and open on a click.
export function autoMax() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  return c && (c.saveData || /cellular|2g|3g/.test(String(c.type || c.effectiveType || ''))) ? 8 * 1024 * 1024 : 40 * 1024 * 1024;
}
