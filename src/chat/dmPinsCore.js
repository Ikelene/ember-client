// Pinned DM categories (Ember Home: right-click a DM > Pin to..., or drag it). Pure list helpers, the node tests load them.
// A category is { id, name, color: '#rrggbb', items: ['d:<username lower-case>' | 'g:<room>'] }; the list is the chat
// setting dm_pins on Nookara (synced to your other devices). A conversation is in one category at most.
// A server channel can be pinned too: 'c:<sid> <cid>' (Ember's own keys: an Ember server's are 'origin|id').
export const MAX_CATS = 30;
export const MAX_ITEMS = 200;
export const PIN_COLORS = ['#e8547a', '#f08a3c', '#e8c547', '#5bb37a', '#3fb8c4', '#5b8def', '#9a6cf0', '#a1a1aa'];
export const dmKey = username => `d:${String(username || '').toLowerCase()}`;
export const groupKey = room => `g:${room}`;
export const chanKey = (sid, cid) => `c:${sid} ${cid}`;
const ITEM = /^(d:[a-z0-9_.-]{1,40}|g:[A-Za-z0-9_.:-]{1,80}|c:[!-~]{1,300} [!-~]{1,300})$/;
export const validItem = k => typeof k === 'string' && ITEM.test(k);
// what a key is: { kind: 'dm', name } | { kind: 'group', room } | { kind: 'channel', sid, cid } | null
export function parseItem(k) {
  if (!validItem(k)) return null;
  if (k.startsWith('d:')) return { kind: 'dm', name: k.slice(2) };
  if (k.startsWith('g:')) return { kind: 'group', room: k.slice(2) };
  const [sid, cid] = k.slice(2).split(' ');
  return { kind: 'channel', sid, cid };
}
// the key the rest of Ember uses for it (unread counts, the open conversation)
export const viewKeyOf = k => { const x = parseItem(k); return !x ? '' : x.kind === 'channel' ? `c:${x.cid}` : k; };

// Home shortcuts (chat setting home_shortcuts): up to 24 conversations / channels as tiles on Ember's Home
export const MAX_SHORTCUTS = 24;
export function cleanShortcuts(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  return v.filter(k => validItem(k) && !seen.has(k) && seen.add(k)).slice(0, MAX_SHORTCUTS);
}
export const toggleShortcut = (list, k) => (list.includes(k) ? list.filter(x => x !== k) : list.length >= MAX_SHORTCUTS ? list : [...list, k]);
export function moveShortcut(list, k, by) {
  const i = list.indexOf(k), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  out.splice(i, 1);
  out.splice(j, 0, k);
  return out;
}

// whatever came from the server (or nothing): a clean list
export function cleanPins(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  return v.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string').slice(0, MAX_CATS).map(c => ({
    id: c.id, name: c.name.slice(0, 40), color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : PIN_COLORS[0],
    items: (Array.isArray(c.items) ? c.items : []).filter(k => validItem(k) && !seen.has(k) && seen.add(k)).slice(0, MAX_ITEMS),
  }));
}
export const pinnedSet = cats => new Set(cats.flatMap(c => c.items));
export const catOf = (cats, key) => cats.find(c => c.items.includes(key)) || null;
export const newCatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// key into category toId at index (clamped; -1 / past the end = last). toId null = unpin. Returns a new list.
export function moveItem(cats, key, toId, index = -1) {
  const out = cats.map(c => ({ ...c, items: c.items.filter(k => k !== key) }));
  if (toId == null) return out;
  const t = out.find(c => c.id === toId);
  if (!t || t.items.length >= MAX_ITEMS) return cats;
  const i = index < 0 || index > t.items.length ? t.items.length : index;
  t.items.splice(i, 0, key);
  return out;
}
// a whole category to position index (in the list without it)
export function moveCat(cats, id, index) {
  const c = cats.find(x => x.id === id);
  if (!c) return cats;
  const rest = cats.filter(x => x.id !== id);
  const i = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, i), c, ...rest.slice(i)];
}
export function addCat(cats, { id = newCatId(), name, color }, key = null) {
  if (cats.length >= MAX_CATS) return cats;
  const out = [...cats, { id, name: String(name).trim().slice(0, 40), color, items: [] }];
  return key ? moveItem(out, key, id) : out;
}
export const editCat = (cats, id, patch) => cats.map(c => (c.id === id ? { ...c, ...patch, ...(patch.name != null ? { name: String(patch.name).trim().slice(0, 40) } : {}) } : c));
export const removeCat = (cats, id) => cats.filter(c => c.id !== id);
