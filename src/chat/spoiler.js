// A spoilered attachment is one whose name starts with SPOILER_ (Discord's convention): every server already keeps the
// name, so no server needs to know about spoilers, and bridged files keep it both ways.
const PREFIX = 'SPOILER_';
export const isSpoiler = a => String(a?.name || '').startsWith(PREFIX);
export const spoilerName = (name, on) => {
  const bare = String(name || 'file').replace(/^(SPOILER_)+/, '');
  return on ? PREFIX + bare : bare;
};
// what to show people (the prefix is only a marker)
export const shownName = name => String(name || '').replace(/^(SPOILER_)+/, '');
// a picture link in a DM (catbox #n=<name>): the name it carries, if any
export function nameInLink(url) {
  try { return decodeURIComponent(/#n=([^#\s]+)$/.exec(String(url))?.[1] || ''); } catch { return ''; }
}
