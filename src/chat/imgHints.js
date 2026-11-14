// What size to upload where (Ikelene 2026-11-14: "add suggested sizes to all image uploads"). The limits are the real ones
// of whoever takes the file:
//   Nookara (Nookara-hosted servers, routes/chat.js; your account, routes/media.js + personal-emojis.js): emojis 2 MB kept
//     animated at 128 px; server icons 256 px and banners 960x320, role / channel icons 64 px, webhook pictures 128 px and
//     bot pictures 256 px, all made into stills (12 MB upload cap); profile pictures 620 px and banners 1200x400 (GIF = Pro).
//   Ember servers (ember-server uploads.js): pictures stored as they are (animation kept), 4 MB; emojis 2 MB; stickers
//     512 KB and PNG / GIF / WebP only.
// imgHint() is the muted line under an upload button; checkImage() a gentle warning for a picture that's far off (still
// uploaded: only the server's own limits refuse anything).
import { toast } from './store.js';

const ANY = 'PNG, JPG, WebP or GIF';
const STILL = 'PNG, JPG or WebP';
// [width, height, max MB, types, note]
const NOOKARA = {
  emoji: [128, 128, 2, ANY, 'GIFs and animated WebP stay animated'],
  personalEmoji: [128, 128, 2, ANY, 'GIFs and animated WebP stay animated'],
  personalSticker: [320, 320, 4, ANY, 'shown at about 160 px; GIFs and animated WebP stay animated (1 MB after shrinking)'],
  serverIcon: [512, 512, 12, STILL, 'saved as a still picture'],
  serverBanner: [960, 320, 12, STILL, 'cropped to 3:1, saved as a still picture'],
  roleIcon: [64, 64, 12, STILL, 'shown small, saved as a still picture'],
  channelIcon: [64, 64, 12, STILL, 'shown small, saved as a still picture'],
  webhookAvatar: [256, 256, 12, ANY, 'saved as a still picture'],
  botAvatar: [512, 512, 12, STILL, 'saved as a still picture'],
  pfp: [620, 620, 60, ANY, 'GIFs need Nookara Pro'],
  banner: [1200, 400, 60, ANY, 'GIFs need Nookara Pro'],
};
const EMBER = {
  emoji: [128, 128, 2, ANY, 'GIFs and animated WebP stay animated'],
  sticker: [320, 320, 0.5, 'PNG, WebP or GIF', 'animated ones stay animated'],
  serverIcon: [512, 512, 4, ANY, 'GIFs stay animated'],
  serverBanner: [960, 480, 4, ANY, 'GIFs stay animated'],
  roleIcon: [64, 64, 4, ANY, 'shown small'],
  channelIcon: [64, 64, 4, ANY, 'shown small'],
  webhookAvatar: [256, 256, 4, ANY, 'GIFs stay animated'],
  botAvatar: [512, 512, 4, ANY, 'GIFs stay animated'],
};
// inst = an Ember server (true) or Nookara (false)
export function imgSpec(kind, inst = false) {
  const s = (inst ? EMBER[kind] : null) || NOOKARA[kind] || EMBER[kind];
  if (!s) return null;
  const [w, h, mb, types, note] = s;
  return { w, h, mb, types, note };
}
const sizeText = mb => (mb < 1 ? `${Math.round(mb * 1024)} KB` : `${mb} MB`);
const ratioText = (w, h) => (w === h ? 'square' : w / h === 3 ? '3:1' : w / h === 2 ? '2:1' : w / h === 2.5 ? '5:2' : `${w}:${h}`);
export function imgHint(kind, inst = false) {
  const s = imgSpec(kind, inst);
  if (!s) return '';
  return `Recommended: ${s.w}×${s.h}${s.w === s.h ? '' : ` (${ratioText(s.w, s.h)})`}. ${s.types}, up to ${sizeText(s.mb)}${s.note ? `; ${s.note}` : ''}.`;
}

const dims = file => new Promise(res => {
  if (!file || !/^image\//.test(file.type || '')) { res(null); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); res({ w: img.naturalWidth, h: img.naturalHeight }); };
  img.onerror = () => { URL.revokeObjectURL(url); res(null); };
  img.src = url;
});
// a warning for a picture that's far off, or null. cropped = the user already picked the part to keep (ImageCropper)
export async function checkImage(file, kind, inst = false, { cropped = false } = {}) {
  const s = imgSpec(kind, inst);
  if (!s || !file) return null;
  if (file.size > s.mb * 1024 * 1024) return `That picture is ${sizeText(Math.ceil(file.size / 104857.6) / 10)} - the most here is ${sizeText(s.mb)}, so it may not upload.`;
  const d = await dims(file);
  if (!d || !d.w || !d.h) return null;
  const want = s.w / s.h;
  const off = Math.abs(Math.log((d.w / d.h) / want)) > Math.log(1.3);
  if (off && !cropped) return `That picture is ${d.w}×${d.h}; this spot is ${ratioText(s.w, s.h)}, so it ${inst ? 'may look squashed or cut off' : 'gets cropped to fit'}. ${s.w}×${s.h} works best.`;
  if (Math.min(d.w / s.w, d.h / s.h) < 0.5) return `That picture is small (${d.w}×${d.h}), so it may look blurry. ${s.w}×${s.h} works best.`;
  return null;
}
// checkImage as a toast (the upload carries on either way)
export function warnImage(file, kind, inst = false, opts) {
  checkImage(file, kind, inst, opts).then(w => { if (w) toast(w); }).catch(() => {});
}
