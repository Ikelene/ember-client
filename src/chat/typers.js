// who's typing in a conversation right now
export function typersOf(typing, key) {
  const now = Date.now();
  return Object.entries(typing[key] || {}).filter(([, until]) => until > now).map(([n]) => n);
}
