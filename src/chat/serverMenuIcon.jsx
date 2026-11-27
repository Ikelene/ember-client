import { ServerIcon } from './ServerIcon.jsx';

// for menus that pick a server (Clone emoji, Add to server...): the server's icon at the size of the menu's line, instead of a
// generic glyph. Menu items draw `icon` as <Icon size={16} />, so this is a component made for one server.
const menuIcons = new Map();

export function serverMenuIcon(s) {
  const k = `${s?.icon || ''}|${s?.name || ''}`;
  if (!menuIcons.has(k)) menuIcons.set(k, function SrvMenuIcon({ size = 16 }) { return <span className="vc-srv-ico vc-srv-menu-ico" style={{ width: size + 2, height: size + 2 }}><ServerIcon src={s?.icon} name={s?.name} /></span>; });
  return menuIcons.get(k);
}
