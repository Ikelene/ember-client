// The letters shown where a server or homeserver has no icon: the first letter or digit of each of the first two words, so
// "B Test (devstack HS-B)" is BT and "Alice's Garden" is AG. Pure: the node tests load it.
export function initials(name) {
  const words = String(name || '').split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  return words.slice(0, 2).map(w => Array.from(w)[0]).join('').toUpperCase() || '?';
}
