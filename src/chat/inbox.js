// The side panel's Inbox data: saved messages (Nookara keeps references; saved-messages.js on the server), mentions across
// my servers, and Translate (on-device first, Nookara's /chat/translate as the fallback).
import { apiFetch } from '../api.js';
import { patchState, getState, toast, errorText, ask, imToMsg } from './store.js';
import { isInst } from './ids.js';
import * as E2EE from './e2ee/session.js';

// ── saved messages ──
// what a message is to the saved list: { kind, id } (or a group snapshot); null = can't be saved here (instances, modmail, system)
export function saveRef(view, m) {
  if (!m || m.system || m.ephemeral || m.pending) return null;
  if (view.kind === 'channel') return !isInst(view.sid) && /^\d+$/.test(String(m.id)) ? { kind: 'channel', id: String(m.id) } : null;
  if (view.kind === 'dm') return m.imId ? { kind: 'dm', id: String(m.imId) } : null;
  if (view.kind === 'group') {
    const g = getState().groups.find(x => x.room === view.room);
    return { kind: 'group', ref: `${view.room}:${m.gid || m.created_at}`, snapshot: { room: view.room, room_name: g?.name || '', user: m.author?.username || '', message: m.body || '', created_at: m.created_at, id: m.gid || null } };
  }
  return null;
}
const refKey = r => `${r.kind}:${r.ref || r.id}`;
let savedKeys = new Map(); // `${kind}:${ref}` -> saved id (from the last list + this session's saves)
export const savedIdOf = r => (r ? savedKeys.get(refKey(r)) || null : null);

async function openDm(x) {
  if (!x.message) return x;
  const o = await E2EE.openMessage(x.message).catch(() => null);
  const msg = imToMsg(o || { ...x.message, body: 'Encrypted message' });
  if (o?.sealed && o.sealed.state !== 'open') msg.body = 'Encrypted message';
  return { ...x, message: msg };
}
export async function loadSaved({ more = false } = {}) {
  const cur = getState().savedMsgs;
  if (cur?.loading || (more && !cur?.has_more)) return;
  patchState(s => ({ savedMsgs: { list: [], ...(s.savedMsgs || {}), loading: true, error: false } }));
  try {
    const last = more ? cur.list[cur.list.length - 1]?.id : null;
    const d = await apiFetch(`/chat/saved?limit=50${last ? `&before=${last}` : ''}`);
    const items = await Promise.all((d.saved || []).map(x => (x.kind === 'dm' ? openDm(x) : x)));
    items.forEach(x => { if (x.missing || x.hidden || !x.message) return; const r = x.kind === 'group' ? `${x.message.room}:${x.message.id || x.message.created_at}` : x.kind === 'dm' ? x.message.imId : x.message.id; if (r) savedKeys.set(`${x.kind}:${r}`, x.id); });
    patchState(s => ({ savedMsgs: { list: more ? [...(s.savedMsgs?.list || []), ...items] : items, has_more: !!d.has_more, loading: false, error: false } }));
  } catch { patchState(s => ({ savedMsgs: { list: [], ...(s.savedMsgs || {}), loading: false, error: true } })); }
}
export async function saveMessage(view, m) {
  const r = saveRef(view, m);
  if (!r) return;
  try {
    const d = await apiFetch('/chat/saved', { method: 'POST', body: JSON.stringify(r.kind === 'group' ? { kind: 'group', snapshot: r.snapshot } : { kind: r.kind, id: r.id }) });
    savedKeys.set(refKey(r), d.id);
    toast('Saved. Find it in the Inbox under Saved.', true);
    if (getState().savedMsgs) loadSaved();
  } catch (e) { toast(e.message === 'too_many_saved' ? "You've saved 500 messages - remove some first." : errorText(e.message)); }
}
export async function unsaveMessage(savedId) {
  for (const [k, v] of savedKeys) if (v === savedId) savedKeys.delete(k);
  patchState(s => (s.savedMsgs ? { savedMsgs: { ...s.savedMsgs, list: s.savedMsgs.list.filter(x => x.id !== savedId) } } : {}));
  try { await apiFetch(`/chat/saved/${savedId}`, { method: 'DELETE' }); toast('Removed from saved.', true); } catch (e) { toast(errorText(e.message)); }
}
// the menu asks once per message whether it's saved (so it can say Remove from saved)
export async function checkSaved(view, m) {
  const r = saveRef(view, m);
  if (!r || savedKeys.has(refKey(r)) || r.kind === 'group') return savedIdOf(r);
  try {
    const d = await apiFetch('/chat/saved/check', { method: 'POST', body: JSON.stringify({ kind: r.kind, ids: [r.id] }) });
    if (d.saved?.[r.id]) savedKeys.set(refKey(r), d.saved[r.id]);
  } catch { /* the menu just says Save */ }
  return savedIdOf(r);
}

// ── mentions across my servers ──
export async function loadMentions({ more = false } = {}) {
  const cur = getState().inboxMentions;
  if (cur?.loading || (more && !cur?.has_more)) return;
  patchState(s => ({ inboxMentions: { list: [], ...(s.inboxMentions || {}), loading: true, error: false } }));
  try {
    const last = more ? cur.list[cur.list.length - 1]?.id : null;
    const d = await apiFetch(`/chat/inbox/mentions?limit=30${last ? `&before=${last}` : ''}`);
    patchState(s => ({ inboxMentions: { list: more ? [...(s.inboxMentions?.list || []), ...d.messages] : d.messages, has_more: !!d.has_more, loading: false, error: false, at: Date.now() } }));
  } catch { patchState(s => ({ inboxMentions: { list: [], ...(s.inboxMentions || {}), loading: false, error: true } })); }
}

// ── translate ──
const targetLang = () => { const l = (navigator.language || 'en').toLowerCase(); return /^zh/.test(l) ? (/tw|hk|hant/.test(l) ? 'zh-TW' : 'zh-CN') : l.split('-')[0]; };
export const langName = code => { try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) || code; } catch { return code; } };
let askedServer = false;
async function onDevice(text, to) {
  const T = globalThis.Translator, D = globalThis.LanguageDetector;
  if (!T || !D) return null;
  const det = await D.create();
  const [best] = await det.detect(text);
  const from = best?.detectedLanguage;
  if (!from || from === 'und') return null;
  if (from.split('-')[0] === to.split('-')[0]) return { text, from, same: true, local: true };
  const av = await T.availability({ sourceLanguage: from, targetLanguage: to });
  if (av === 'unavailable') return null;
  const tr = await T.create({ sourceLanguage: from, targetLanguage: to });
  return { text: await tr.translate(text), from, local: true };
}
// { text, from, same?, local? } or null (cancelled / nothing to do)
export async function translate(text, { encrypted = false } = {}) {
  const t = String(text || '').trim();
  if (!t) return null;
  const to = targetLang();
  try { const r = await onDevice(t, to); if (r) return r; } catch { /* no on-device model here: the fallback */ }
  if (encrypted && !askedServer) {
    const ok = await ask({ title: 'Translate through Nookara?', text: "This device has no built-in translator, so the text goes through Nookara's server to a translation service. This message is end-to-end encrypted - translating it this way sends its text out. Nothing says who you are or who sent it.", confirm: 'Translate' });
    if (!ok) return null;
    askedServer = true;
  }
  const d = await apiFetch('/chat/translate', { method: 'POST', body: JSON.stringify({ text: t.slice(0, 3000), to }) });
  return { text: d.text, from: d.from, same: !!d.from && d.from.split('-')[0] === to.split('-')[0] };
}
