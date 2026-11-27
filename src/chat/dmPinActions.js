// pinned DM categories as the chat setting dm_pins: reading / saving them and their right-click items (DmPins.jsx draws them)
import { getState, saveSettings, toast, errorText, loadSettings, ask } from './store.js';
import { FolderPlus, Pin, PinOff, Pencil, Palette, Trash2 } from 'lucide-react';
import { homeMenuItem } from './pinItems.js';
import { cleanPins, catOf, moveItem, moveCat, removeCat } from './dmPinsCore.js';

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
