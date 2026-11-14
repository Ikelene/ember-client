// Pinned DM categories (Ikelene 2026-11-14): categories at the top of the DM list, each with a name and a colour.
// Right-click (long-press) a DM or group chat > Pin to... / Move to... / Unpin; right-click a category > Rename, Change
// colour, Delete. Dragging (HomeSidebar in Parts.jsx) moves conversations into, between and out of categories and moves
// categories around. Saved as the chat setting dm_pins on Nookara, so every device has the same ones (live, via
// chat_settings_changed). Which categories are folded is this device's own (localStorage).
import { useEffect, useState } from 'react';
import { Pin, PinOff, FolderPlus, Pencil, Palette, Trash2, Check } from 'lucide-react';
import { Dialog } from './Dialogs.jsx';
import { getState, saveSettings, loadSettings, toast, errorText, ask } from './store.js';
import { cleanPins, moveItem, moveCat, addCat, editCat, removeCat, catOf, PIN_COLORS, MAX_CATS } from './dmPinsCore.js';
import { homeMenuItem } from './PinItems.jsx';

export const getPins = () => cleanPins(getState().settings?.dm_pins);
export function setPins(next) {
  saveSettings({ dm_pins: next }).catch(e => { toast(errorText(e?.message)); loadSettings(); });
}
export const pinItem = (key, catId, index = -1) => setPins(moveItem(getPins(), key, catId, index));
export const unpinItem = key => setPins(moveItem(getPins(), key, null));
export const moveCategory = (id, index) => setPins(moveCat(getPins(), id, index));

// the category dialog: a new one (item = the conversation to put in it) or an existing one (cat)
const openCatDialog = detail => dispatchEvent(new CustomEvent('vc-pin-cat', { detail }));

// right-click items for a DM / group chat / channel (key = d:<name> | g:<room> | c:<sid> <cid>), with Add to Home
export function pinMenuItems(key) {
  const cats = getPins();
  const cur = catOf(cats, key);
  const newOne = { label: 'New category...', icon: FolderPlus, onClick: () => openCatDialog({ item: key }) };
  const others = cats.filter(c => c !== cur).map(c => ({ label: c.name, onClick: () => pinItem(key, c.id) }));
  if (!cur) return [{ label: 'Pin to', icon: Pin, sub: [...others, ...(others.length ? ['sep'] : []), newOne] }, homeMenuItem(key)];
  return [
    { label: 'Move to', icon: Pin, sub: [...others, ...(others.length ? ['sep'] : []), newOne] },
    { label: `Unpin from ${cur.name}`, icon: PinOff, onClick: () => unpinItem(key) },
    homeMenuItem(key),
  ];
}
// right-click items for a category's header
export function catMenuItems(cat) {
  return [
    { label: 'Rename', icon: Pencil, onClick: () => openCatDialog({ cat, focus: 'name' }) },
    { label: 'Change colour', icon: Palette, onClick: () => openCatDialog({ cat, focus: 'color' }) },
    'sep',
    { label: 'Delete category', icon: Trash2, danger: true, onClick: async () => {
      if (cat.items.length && !(await ask({ title: `Delete ${cat.name}?`, text: 'The conversations in it go back to the normal list.', confirm: 'Delete', danger: true }))) return;
      setPins(removeCat(getPins(), cat.id));
    } },
  ];
}

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
