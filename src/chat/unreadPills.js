// The sidebar lists (server channels, Home's DMs and groups): when an unread row is scrolled out of view, a pill sits on that
// edge of the list - "New Mentions" (red) if any of the hidden ones there mention you, else "New Unreads" (white). Clicking it
// scrolls to the nearest one of that kind (Ikelene 2026-11-15). This file is the part without React or the DOM, so it can be tested.

// rows: [{ top, bottom, mention }] in the same coordinates as view { top, bottom } (the list's visible box).
// A row counts as out of view once less than half of it shows. Returns { up, down }: each null or { kind, index } where kind is
// 'mention' | 'unread' and index points at the nearest row of that kind on that side.
export function pillsFor(rows, view) {
  const side = { up: null, down: null };
  rows.forEach((r, index) => {
    if (!(r.bottom > r.top)) return; // (not drawn: a closed category)
    const mid = (r.top + r.bottom) / 2;
    const dir = mid < view.top ? 'up' : mid > view.bottom ? 'down' : null;
    if (!dir) return;
    const kind = r.mention ? 'mention' : 'unread';
    const cur = side[dir];
    const nearer = !cur || (dir === 'up' ? r.top > rows[cur.index].top : r.top < rows[cur.index].top);
    // a mention wins over plain unreads; among the same kind, the nearest one
    if (!cur || (kind === 'mention' && cur.kind === 'unread') || (kind === cur.kind && nearer)) side[dir] = { kind, index };
  });
  return side;
}

const STRINGS = {
  en: { mention: 'New Mentions', unread: 'New Unreads' },
  de: { mention: 'Neue Erwähnungen', unread: 'Neue Nachrichten' },
  pt: { mention: 'Novas menções', unread: 'Novas mensagens' },
};
export function pillText(kind, lang = (typeof navigator !== 'undefined' && navigator.language) || 'en') {
  const t = STRINGS[String(lang).toLowerCase().split('-')[0]] || STRINGS.en;
  return t[kind] || STRINGS.en[kind];
}
