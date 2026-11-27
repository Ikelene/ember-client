// Pinned DM categories (Ikelene 2026-11-14): categories at the top of the DM list, each with a name and a colour.
// Right-click (long-press) a DM or group chat > Pin to... / Move to... / Unpin; right-click a category > Rename, Change
// colour, Delete. Dragging (HomeSidebar in Parts.jsx) moves conversations into, between and out of categories and moves
// categories around. Saved as the chat setting dm_pins on Nookara, so every device has the same ones (live, via
// chat_settings_changed). Which categories are folded is this device's own (localStorage).
import { useEffect, useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { Dialog } from './Dialogs.jsx';
import { addCat, editCat, PIN_COLORS, MAX_CATS } from './dmPinsCore.js';
import { getPins, setPins } from './dmPinActions.js';

// mounted once in the Home sidebar: shows the dialog when a menu asks for it
export function PinCategoryHost() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const on = e => setD(e.detail || {});
    addEventListener('vc-pin-cat', on);
    return () => removeEventListener('vc-pin-cat', on);
  }, []);
  return d ? <PinCategoryDialog key={d.cat?.id || 'new'} {...d} onClose={() => setD(null)} /> : null;
}

function PinCategoryDialog({ cat, item = null, focus, onClose }) {
  const [name, setName] = useState(cat?.name || '');
  const [color, setColor] = useState(cat?.color || PIN_COLORS[getPins().length % PIN_COLORS.length]);
  const full = !cat && getPins().length >= MAX_CATS;
  const save = close => {
    const n = name.trim();
    if (!n) return;
    const cats = getPins();
    setPins(cat ? editCat(cats, cat.id, { name: n, color }) : addCat(cats, { name: n, color }, item));
    close();
  };
  return (
    <Dialog title={cat ? 'Edit category' : 'New category'} sub={cat ? null : 'Pinned at the top of your direct messages, on all your devices.'} onClose={onClose} className="vc-pin-dialog">
      {close => (
        <form onSubmit={e => { e.preventDefault(); save(close); }}>
          <label className="vc-field"><span>Name</span>
            <input className="form-input" value={name} maxLength={40} autoFocus={focus !== 'color'} placeholder="Friends, Work, Besties..." onChange={e => setName(e.target.value)} />
          </label>
          <div className="vc-field"><span>Colour</span>
            <div className="vc-pin-swatches" role="radiogroup" aria-label="Colour">
              {PIN_COLORS.map(c => (
                <button key={c} type="button" role="radio" aria-checked={color.toLowerCase() === c} title={c} className={`vc-pin-sw${color.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)}>
                  {color.toLowerCase() === c && <Check size={14} />}
                </button>
              ))}
              <label className={`vc-pin-sw custom${PIN_COLORS.includes(color.toLowerCase()) ? '' : ' on'}`} title="Custom colour" style={{ background: PIN_COLORS.includes(color.toLowerCase()) ? undefined : color }}>
                <Palette size={14} />
                <input type="color" value={color} autoFocus={focus === 'color'} onChange={e => setColor(e.target.value)} aria-label="Custom colour" />
              </label>
            </div>
          </div>
          <div className="vc-pin-preview" style={{ '--pin': color }}><span className="vc-pin-dot" />{name.trim() || 'Category'}</div>
          {full && <p className="vc-dialog-sub">You have as many categories as you can ({MAX_CATS}).</p>}
          <div className="vc-dialog-btns">
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || full}>{cat ? 'Save' : 'Create'}</button>
            <button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
