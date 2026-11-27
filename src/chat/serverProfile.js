import { useChat, ask } from './store.js';
import { hasAccountProfile, accountTarget } from './accountProfileCore.js';

// the cropped part of a picture as a PNG (the server keeps what it's given)
export function cropToBlob(file, crop, max) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const c = crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        const k = Math.min(1, max / Math.max(c.w, c.h));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(c.w * k)); cv.height = Math.max(1, Math.round(c.h * k));
        cv.getContext('2d').drawImage(img, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(src);
        cv.toBlob(b => (b ? resolve(b) : reject(new Error('bad_image'))), 'image/png');
      } catch (e) { URL.revokeObjectURL(src); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('images_only')); };
    img.src = src;
  });
}

// the "which profile" dropdown at the top of Settings > Profile: your global one, an Ember server that has server profiles, or -
// on a server with its own accounts - your account's profile there (AccountProfileEditor: `account` = that server's address)
export function useProfileTargets() {
  const servers = useChat(s => s.servers);
  const instances = useChat(s => s.instances);
  const home = useChat(s => s.home); // (signed in on a homeserver: that account's profile is the one people see everywhere)
  const accounts = instances.filter(hasAccountProfile).map(i => {
    if (home && i.origin === home.origin) return { sid: accountTarget(i.origin), name: home.account?.handle || i.name, icon: i.homeserver?.icon_url || i.icon || null, account: i.origin, home: true };
    // an account on a homeserver with several servers belongs to the homeserver, not to the first server I'm in there
    if (i.v2) return { sid: accountTarget(i.origin), name: i.user?.username && i.homeserver?.domain ? (i.user.username.includes('@') ? i.user.username : `${i.user.username}@${i.homeserver.domain}`) : i.homeserver?.domain || i.name, icon: i.homeserver?.icon_url || i.icon || null, account: i.origin };
    const srv = servers.find(x => x.inst === i.origin);
    return { sid: accountTarget(i.origin), name: srv?.name || i.name, icon: srv?.icon || i.icon || null, account: i.origin };
  }).sort((a, b) => !!b.home - !!a.home);
  const own = new Set(accounts.map(a => a.account));
  return [...accounts, ...servers.filter(x => x.inst && !own.has(x.inst) && instances.find(i => i.origin === x.inst)?.features?.server_profiles).map(x => ({ sid: x.sid, name: x.name, icon: x.icon || null }))];
}

export const askLeave = () => ask({ title: 'Leave without saving?', text: 'Your changes to this profile will be lost.', confirm: 'Leave', danger: true });
