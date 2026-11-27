import { useMemo } from 'react';
import { renderBody } from './text.jsx';

// a profile bio: the same markdown as chat (bold, italic, underline, strike, code, spoilers, links, lists, quotes,
// small headers, -# subtext), but a link on its own line stays a link (no pictures / players) and headers stay small.
// inert = a preview (the /me profile tab): links don't do anything, there is no Ember pop-up host there.
const BIO_CTX = { linkImages: false, bio: true, legacy: true };
export function BioText({ text, className = 'pe-bio', inert = false }) {
  const nodes = useMemo(() => renderBody(text || '', BIO_CTX).nodes, [text]);
  return <div className={`${className} vc-bio`} onClickCapture={inert ? e => { if (e.target.closest?.('a')) { e.preventDefault(); e.stopPropagation(); } } : undefined}>{nodes}</div>;
}
