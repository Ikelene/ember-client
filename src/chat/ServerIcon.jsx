import { useEffect, useState } from 'react';

// a server's picture; when it can't be loaded the initials stay, so a rail icon is never an empty square
export function ServerIcon({ src, name }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  const initials = String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return src && !bad ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : initials;
}

// for menus that pick a server (Clone emoji, Add to server...): the server's icon at the size of the menu's line, instead of a
// generic glyph. Menu items draw `icon` as <Icon size={16} />, so this is a component made for one server.
const menuIcons = new Map();
export function serverMenuIcon(s) {
  const k = `${s?.icon || ''}|${s?.name || ''}`;
  if (!menuIcons.has(k)) menuIcons.set(k, function SrvMenuIcon({ size = 16 }) { return <span className="vc-srv-ico vc-srv-menu-ico" style={{ width: size + 2, height: size + 2 }}><ServerIcon src={s?.icon} name={s?.name} /></span>; });
  return menuIcons.get(k);
}
