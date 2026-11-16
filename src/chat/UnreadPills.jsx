// "New Mentions" / "New Unreads" pills on the top and bottom edges of a sidebar list (unreadPills.js has the rules). It reads
// the rows the list already draws: an unread row has the .unread class, a mention shows a red count (.vc-ping on channels,
// .vc-count on DMs). It looks again when the list scrolls, resizes or redraws, at most once a frame.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { pillsFor, pillText } from './unreadPills.js';

const ROW = '.vc-ch, .vc-dm, .vc-pin-head';
function unreadRows(list) {
  const rows = new Set();
  for (const el of list.querySelectorAll('.vc-ch.unread, .vc-dm.unread, .vc-ping, .vc-count')) {
    const row = el.matches(ROW) ? el : el.closest(ROW);
    if (row && list.contains(row) && !row.closest('.dd-body:not(.open)')) rows.add(row);
  }
  // a red count on a DM or a channel is a mention; a folded pinned category's count stands for anything unread in it
  return [...rows].map(el => ({ el, mention: !el.matches('.vc-pin-head') && !!el.querySelector('.vc-ping, .vc-count') }));
}
const same = (a, b) => (a?.kind || null) === (b?.kind || null);

export function UnreadPills({ listRef }) {
  const [pills, setPills] = useState({ up: null, down: null });
  const targets = useRef({ up: null, down: null });
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    let frame = 0;
    const scan = () => {
      frame = 0;
      const box = list.getBoundingClientRect();
      const rows = unreadRows(list);
      const rects = rows.map(r => { const b = r.el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, mention: r.mention }; });
      const p = pillsFor(rects, { top: box.top, bottom: box.bottom });
      targets.current = { up: p.up && rows[p.up.index].el, down: p.down && rows[p.down.index].el };
      setPills(cur => (same(cur.up, p.up) && same(cur.down, p.down) ? cur : { up: p.up && { kind: p.up.kind }, down: p.down && { kind: p.down.kind } }));
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(scan); };
    list.addEventListener('scroll', queue, { passive: true });
    const mo = new MutationObserver(queue);
    mo.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : null;
    ro?.observe(list);
    addEventListener('resize', queue);
    queue();
    return () => { cancelAnimationFrame(frame); list.removeEventListener('scroll', queue); mo.disconnect(); ro?.disconnect(); removeEventListener('resize', queue); };
  }, [listRef]);

  const jump = dir => {
    const list = listRef.current, el = targets.current[dir];
    if (!list || !el) return;
    const box = list.getBoundingClientRect(), r = el.getBoundingClientRect();
    const top = list.scrollTop + (r.top - box.top) - (list.clientHeight - r.height) / 2; // the row ends up in the middle
    const calm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top, behavior: calm ? 'auto' : 'smooth' });
  };
  const pill = dir => {
    const p = pills[dir];
    if (!p) return null;
    const Icon = dir === 'up' ? ArrowUp : ArrowDown;
    return (
      <button type="button" key={dir} className={`vc-unread-pill ${dir} ${p.kind}`} onClick={() => jump(dir)}>
        <Icon size={13} /> {pillText(p.kind)}
      </button>
    );
  };
  return <>{pill('up')}{pill('down')}</>;
}
