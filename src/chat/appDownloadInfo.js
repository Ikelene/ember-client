// The Ember apps people can download, and which one this device most likely wants (no React, so it can be tested).
// /ember/download sends ?os=mac to the Mac dmg and anything else to the Windows installer; Android has its own page.
export const APP_TARGETS = {
  windows: { name: 'Windows', path: '/ember/download?os=windows', about: 'Desktop notifications, game status and more.' },
  mac: { name: 'macOS', path: '/ember/download?os=mac', about: 'Desktop notifications, game status and more.' },
  linux: { name: 'Linux', path: '/ember/latest.json', about: 'AppImage, .deb (Debian, Ubuntu) and Arch package.' },
  android: { name: 'Android', path: '/ember/android/', about: 'Notifications, swipe gestures and a smoother phone experience.' },
};

// 'windows', 'mac', 'linux', 'android', or null when there is no app for this device (iPhone, iPad): the person picks one
export function detectAppTarget(ua = '', touchPoints = 0) {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return null;
  if (/Macintosh|Mac OS X/i.test(ua)) return touchPoints > 1 ? null : 'mac'; // an iPad's browser says it is a Mac, but a Mac has no touch screen
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return null;
}

// Linux comes as three packages; /ember/latest.json lists them under linux: { version, appimage: { url, size }, deb, pacman }
export const LINUX_PACKAGES = [
  { id: 'appimage', name: 'AppImage', who: 'Any distribution', how: f => `chmod +x ${f} && ./${f}`, note: 'Updates itself.' },
  { id: 'deb', name: '.deb package', who: 'Debian, Ubuntu, Linux Mint', how: f => `sudo apt install ./${f}`, note: '' },
  { id: 'pacman', name: 'Arch package', who: 'Arch, Manjaro, EndeavourOS', how: f => `sudo pacman -U ${f}`, note: '' },
];
// latest.json -> { version, items: [{ id, name, who, note, url, file, command, mb }] }, or null while there's no Linux build
export function linuxDownloads(latest) {
  const l = latest?.linux;
  if (!l || typeof l !== 'object') return null;
  const items = [];
  for (const p of LINUX_PACKAGES) {
    const url = String(l[p.id]?.url || '');
    if (!/^https:\/\/[^\s]+$/i.test(url)) continue;
    const file = decodeURIComponent(url.split('?')[0].split('/').pop() || '').replace(/[^\w.+-]/g, '');
    if (!file) continue;
    const size = Number(l[p.id].size) || 0;
    items.push({ id: p.id, name: p.name, who: p.who, note: p.note, url, file, command: p.how(file), mb: size ? Math.round(size / 1048576) : 0 });
  }
  return items.length ? { version: String(l.version || ''), items } : null;
}
