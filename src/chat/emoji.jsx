import { twemojiUrl } from './emojiNames.js';

// a Twemoji picture; falls back to the plain character if Twemoji doesn't have it
export function Twemoji({ char, className = 'vc-temoji', title, onClick, lazy }) {
  return (
    <img className={className} src={twemojiUrl(char)} alt={char} title={title} draggable={false} loading={lazy ? 'lazy' : undefined} onClick={onClick}
      onError={e => { const t = document.createElement('span'); t.textContent = char; t.className = `${className} txt`; e.currentTarget.replaceWith(t); }} />
  );
}
