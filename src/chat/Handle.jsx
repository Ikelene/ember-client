// username@domain as text: the name as it is, the @domain small and grey (and free of name colours, gradients and fonts).
// handle: the full handle string (or user: { handle } / { username, domain }); at: a leading "@". Titles stay plain strings.
export const splitAt = h => { const s = String(h ?? ''), i = s.lastIndexOf('@'); return i > 0 && i < s.length - 1 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };

export function Handle({ handle, user, at = false }) {
  const full = handle ?? user?.handle ?? (user?.username && user?.domain ? `${user.username}@${user.domain}` : user?.username || '');
  const [name, domain] = splitAt(full);
  return <span className="vc-hdl">{at ? '@' : ''}{name}{domain && <span className="vc-hdl-domain">@{domain}</span>}</span>;
}
