import { cleanShortcuts, MAX_SHORTCUTS, toggleShortcut, moveShortcut } from './dmPinsCore.js';
import { pinMenuItems } from './dmPinActions.js';
import { getState, saveSettings, toast, errorText, loadSettings } from './store.js';
import { House, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { userMenu, openMenu } from './menus.js';

// ── Home shortcuts ──
export const getShortcuts = () => cleanShortcuts(getState().settings?.home_shortcuts);

function setShortcuts(next) {
  saveSettings({ home_shortcuts: next }).catch(e => { toast(errorText(e?.message)); loadSettings(); });
}

export function homeMenuItem(k) {
  const list = getShortcuts();
  const on = list.includes(k);
  return { label: on ? 'Remove from Home' : 'Add to Home', icon: House, disabled: !on && list.length >= MAX_SHORTCUTS, hint: !on && list.length >= MAX_SHORTCUTS ? `Home has ${MAX_SHORTCUTS} already` : '', onClick: () => setShortcuts(toggleShortcut(getShortcuts(), k)) };
}

// the right-click / long-press menu of an item (tile = Home shortcut: also move left / right)
export function itemMenu(e, k, it, { tile = false } = {}) {
  const list = tile ? getShortcuts() : [];
  const i = list.indexOf(k);
  const more = [
    ...pinMenuItems(k),
    ...(tile ? [i > 0 && { label: 'Move left', icon: ChevronLeft, onClick: () => setShortcuts(moveShortcut(getShortcuts(), k, -1)) },
      i >= 0 && i < list.length - 1 && { label: 'Move right', icon: ChevronRight, onClick: () => setShortcuts(moveShortcut(getShortcuts(), k, 1)) }] : []),
  ].filter(Boolean);
  if (it.kind === 'dm' && !it.gone && it.username !== 'System') {
    userMenu(e, it.username, { onProfile: () => dispatchEvent(new CustomEvent('vc-open-big', { detail: { username: it.username, dm: true } })), extra: ['sep', ...more] });
    return;
  }
  openMenu(e, [{ label: 'Open', icon: MessageCircle, onClick: it.open }, 'sep', ...more]);
}
