// Nookara's own "are you sure?" box, instead of the browser's confirm(): await confirmBox('Remove X?', { confirm: 'Remove', danger: true })
// <ConfirmHost /> is mounted once in App.jsx.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { setConfirmHost } from './confirm.js';

export function ConfirmHost() {
  const [q, setQ] = useState(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => { setConfirmHost(o => { setClosing(false); setQ(o); }); return () => setConfirmHost(null); }, []);
  useEffect(() => {
    if (!q) return undefined;
    const k = e => { if (e.key === 'Escape') answer(false); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  function answer(v) {
    if (!q || closing) return;
    q.resolve(v);
    setClosing(true);
    setTimeout(() => { setQ(null); setClosing(false); }, 170);
  }
  if (!q) return null;
  const [title, ...rest] = String(q.text).split('\n\n');
  return createPortal(
    <div className={`vl-ask-back${closing ? ' out' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) answer(false); }}>
      <form className="vl-ask" onSubmit={e => { e.preventDefault(); answer(true); }}>
        <h3>{q.title || title}</h3>
        {(q.title ? [title, ...rest] : rest).map((p, i) => <p key={i}>{p}</p>)}
        <div className="vl-ask-btns">
          <button type="button" className="btn btn-surface" onClick={() => answer(false)}>{q.cancel || 'Cancel'}</button>
          <button type="submit" autoFocus className={`btn ${q.danger ? 'vl-ask-danger' : 'btn-primary'}`}>{q.confirm || 'OK'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
