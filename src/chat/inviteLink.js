// Ember invite links, recognised in message text so they show as an invite card (LinkEmbeds.jsx InviteEmbed):
//   https://velora.ikelene.net/chat#/invite/<code>                    (a Velora-hosted server)
//   https://velora.ikelene.net/chat#/i/<instance origin, encoded>/invite/<code>
//   https://<instance>/invite/<code>                                  (the instance's own invite page)
// The server (unfurl.js) makes the card data - the instance is asked from Velora, never from the browser.
const VELORA_HOST = /^(www\.)?velora\.ikelene\.net$/i;
const CODE = '[A-Za-z0-9]{4,32}';
const HASH_OWN = new RegExp(`^#/invite/(${CODE})/?$`);
const HASH_INST = new RegExp(`^#/i/([^/]+)/invite/(${CODE})/?$`);
const PATH_INV = new RegExp(`^/invite/(${CODE})/?$`);

// -> { inst: origin | null (Velora), code, sure } or null. sure = certainly an Ember invite (so its link can hide behind the card);
// a plain https://host/invite/code only counts as sure on ikelene.net hosts (Ember instances).
export function inviteRef(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (VELORA_HOST.test(u.hostname)) {
    if (!/^\/chat\/?$/.test(u.pathname)) return null;
    let m = HASH_OWN.exec(u.hash);
    if (m) return { inst: null, code: m[1], sure: true };
    m = HASH_INST.exec(u.hash);
    if (!m) return null;
    try { const o = new URL(decodeURIComponent(m[1])); return o.protocol === 'https:' ? { inst: o.origin, code: m[2], sure: true } : null; } catch { return null; }
  }
  const m = PATH_INV.exec(u.pathname);
  if (!m || u.protocol !== 'https:') return null;
  return { inst: u.origin, code: m[1], sure: /(^|\.)ikelene\.net$/i.test(u.hostname) };
}
// Velora payment links, shown as a payment card (LinkEmbeds.jsx PaymentEmbed; unfurl.js makes the data):
//   https://velora.ikelene.net/pay/<username>          (pay a person)
//   https://velora.ikelene.net/pay/bp_<32 hex>         (a bot's payment request)
//   https://velora.ikelene.net/payment/<32 hex>        (a payment request, e.g. from a project or a chat bot)
// -> { kind: 'user' | 'bot' | 'request', sure: true } or null
export function paymentRef(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' || !VELORA_HOST.test(u.hostname) || u.hash) return null;
  if (/^\/payment\/[a-f0-9]{32}\/?$/.test(u.pathname)) return { kind: 'request', sure: true };
  if (/^\/pay\/bp_[a-f0-9]{32}\/?$/.test(u.pathname)) return { kind: 'bot', sure: true };
  if (/^\/pay\/[A-Za-z0-9_.-]{2,32}\/?$/.test(u.pathname)) return { kind: 'user', sure: true };
  return null;
}
// what a link to a card is called where the card itself isn't shown (a reply preview)
export function embedLabel(href) {
  if (inviteRef(href)?.sure) return 'Server Invite';
  if (paymentRef(href)) return 'Payment';
  return null;
}
// a line that is only an invite / payment link: the link hides (the card replaces it)
export function isHiddenInviteLine(line) {
  const t = String(line || '').trim();
  if (!/^https?:\/\/\S+$/.test(t)) return false;
  return !!(inviteRef(t)?.sure || paymentRef(t));
}
