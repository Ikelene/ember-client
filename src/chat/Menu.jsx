// Right-click menus for everything in Ember (servers, channels, messages, people, DMs, links).
// openMenu(e, items): item = { label, icon: LucideIcon, onClick, danger, checked, radio, hint, disabled, sub: [items] } | 'sep'
//   | { type: 'head', label }  - a small section title
//   | { type: 'slider', label, value, min, max, step, format(v), onChange(v), hint, meter() }  - stays open while you drag;
//     meter() -> 0..1 on the slider's own scale (or null) draws a live level bar above it (e.g. mic sensitivity)
// e may be a plain { clientX, clientY, touch } (long-press menus); touch menus ignore the press's own trailing events.
// Developer mode (Chat settings) adds "Copy ... ID" items at the bottom (dev: true).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Check, Hash } from 'lucide-react';
import { useChat, setMenu } from './store.js';
import { instOpt } from './ids.js';
import { reactionId } from './msg-actions.js';
import { myReactions } from './msg-actions.js';
import { QuickReactions } from './Reactions.jsx';
import { userScrolled } from './userscroll.js';
import { mobileBridge } from '../compat.js';

function Panel({ items, x, y, onDone, nested, reaction }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [open, setOpen] = useState(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x, top = y;
    if (left + w > innerWidth - 6) left = nested ? x - w - (nested.w || 0) : innerWidth - w - 6;
    if (top + h > innerHeight - 6) top = Math.max(6, innerHeight - h - 6);
    setPos({ left: Math.max(6, left), top, ready: true });
  }, [x, y]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={`vc-ctx${nested ? ' nested' : ''}`} style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }} onContextMenu={e => e.preventDefault()}>
      {reaction && <QuickReactions id={reaction.id} inst={reaction.inst} selected={reaction.selected} onDone={onDone} />}

      {items.map((it, i) => {
        if (it === 'sep') return <div key={`s${i}`} className="vc-menu-sep" />;
        if (it.type === 'head') return <div key={`h${i}`} className="vc-ctx-head">{it.label}</div>;
        if (it.type === 'slider') return <SliderRow key={it.label + i} it={it} onHover={() => setOpen(-1)} />;
        const Icon = it.icon;
        return (
          <div key={it.label + i} className="vc-ctx-row" onMouseEnter={() => setOpen(it.sub ? i : -1)}>
            <button type="button" disabled={it.disabled} className={`${it.danger ? 'danger' : ''}${it.dev ? ' dev' : ''}`}
              onClick={() => { if (it.sub) { setOpen(i); return; } onDone(); it.onClick?.(); }}>
              {Icon && it.checked === undefined && <span className="vc-ctx-ico"><Icon size={16} /></span>}
              <span className="vc-ctx-label">{it.label}{it.hint && <small>{it.hint}</small>}</span>
              {it.checked !== undefined ? <span className={`vc-ctx-check${it.radio ? ' radio' : ''}${it.checked ? ' on' : ''}`}>{it.checked && (it.radio ? <i /> : <Check size={12} />)}</span>
                : it.sub ? <ChevronRight size={14} className="vc-ctx-more" /> : null}
            </button>
            {it.sub && open === i && <SubPanel items={it.sub} onDone={onDone} />}
          </div>
        );
      })}
    </div>
  );
}
// a slider inside a menu: keeps its own value while you drag (the menu's item list is a snapshot)
function SliderRow({ it, onHover }) {
  const [val, setVal] = useState(Number(it.value) || 0);
  const fill = useRef(null);
  const min = it.min ?? 0, max = it.max ?? 100;
  const pct = x => `${((x - min) / ((max - min) || 1)) * 100}%`;
  const valRef = useRef(val);
  valRef.current = val;
  useEffect(() => {
    if (!it.meter) return undefined;
    const t = setInterval(() => {
      const el = fill.current, m = it.meter();
      if (!el) return;
      el.style.width = m == null ? '0%' : `${Math.round(m * 100)}%`;
      el.classList.toggle('hot', m != null && min + m * (max - min) >= valRef.current && valRef.current > min);
    }, 50);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="vc-ctx-slider" onMouseEnter={onHover}>
      <span className="vc-ctx-slider-top"><span>{it.label}</span><b>{it.format ? it.format(val) : val}</b></span>
      {it.meter && <span className="vc-ctx-meter"><i ref={fill} /><b style={{ left: pct(val) }} /></span>}
      <input type="range" min={min} max={max} step={it.step ?? 1} value={val} aria-label={it.label}
        onChange={e => { const v = Number(e.target.value); setVal(v); it.onChange?.(v); }} />
      {it.hint && <small>{it.hint}</small>}
    </div>
  );
}
function SubPanel({ items, onDone }) {
  const anchor = useRef(null);
  const [at, setAt] = useState(null);
  useLayoutEffect(() => {
    const r = anchor.current?.parentElement?.getBoundingClientRect();
    if (r) setAt({ x: r.right + 2, y: r.top - 6, w: r.width + 4 });
  }, []);
  return <span ref={anchor} className="vc-ctx-anchor">{at && createPortal(<Panel items={items} x={at.x} y={at.y} onDone={onDone} nested={{ w: at.w }} />, document.body)}</span>;
}

export function MenuHost() {
  const m = useChat(s => s.menu);
  useEffect(() => {
    if (!m) return undefined;
    // a long-press menu: the same press's trailing mousedown / native contextmenu must not close it again
    const own = () => mobileBridge()?.holdingMenu?.() || (m.touch && (m.press?.down || Date.now() - Math.max(m.k, m.press?.ended || 0) < 600));
    const close = e => {
      // Android may retarget its trailing native contextmenu onto the backdrop
      // inserted during this same hold. Only an outside press bypasses own().
      const backdropPress = e.type === 'mousedown' && e.target.closest?.('.vc-sheet-back');
      if (!e.target.closest?.('.vc-ctx') && (backdropPress || !own())) setMenu(null);
    };
    const key = e => { if (e.key === 'Escape') setMenu(null); };
    const off = e => { if (own()) return; if (e?.type === 'scroll' && (e.target?.closest?.('.vc-ctx') || !userScrolled())) return; setMenu(null); }; // scrolling inside a tall menu keeps it
    const attach = setTimeout(() => { addEventListener('mousedown', close); addEventListener('contextmenu', close, true); }, 0);
    addEventListener('keydown', key);
    addEventListener('resize', off);
    addEventListener('blur', off);
    document.addEventListener('scroll', off, true);
    return () => {
      clearTimeout(attach);
      removeEventListener('mousedown', close); removeEventListener('contextmenu', close, true); removeEventListener('keydown', key);
      removeEventListener('resize', off); removeEventListener('blur', off); document.removeEventListener('scroll', off, true);
    };
  }, [m]);
  if (!m) return null;
  return createPortal(<Panel key={m.k} items={m.items} x={m.x} y={m.y} reaction={m.reaction} onDone={() => setMenu(null)} />, document.body);
}

export { Hash };
