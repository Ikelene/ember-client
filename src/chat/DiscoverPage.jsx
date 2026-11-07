// Discovery: a full page (it takes over the conversation area) instead of a pop-up. A big animated "Discovery" header with
// the search, then Servers / Bots. The directory listings are untrusted text (shown as text; a card only opens Add a server).
import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Compass, Globe, Search, ShieldCheck, Users, X } from 'lucide-react';
import { useChat, go } from './store.js';
import { normOrigin } from './ids.js';
import { initials } from './Parts.jsx';
import { BotGallery } from './BotGallery.jsx';

export default function DiscoverPage({ onClose }) {
  const [tab, setTab] = useState('servers');
  const [q, setQ] = useState('');
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !document.querySelector('.vc-modal-back')) onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="vc-disc-page">
      <header className="vc-disc-hero">
        <div className="vc-disc-bg" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="grid" /></div>
        <button type="button" className="vc-ico-btn vc-disc-back" onClick={onClose} title="Back" aria-label="Back"><ArrowLeft size={20} /></button>
        <div className="vc-disc-hero-in">
          <span className="vc-disc-kicker"><Compass size={15} /> Explore Ember</span>
          <h1>Discovery</h1>
          <p>{tab === 'servers' ? 'Find communities to join. Every server here runs on its own and lists itself in the directory.' : 'Bots approved by Nookara staff. Verified bots were looked at before they were listed.'}</p>
          {tab === 'servers' && (
            <label className="vc-disc-search"><Search size={18} /><input autoFocus placeholder="Search servers by name, description or tag" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><X size={16} /></button>}</label>
          )}
          <div className="vc-disc-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'servers'} className={tab === 'servers' ? 'on' : ''} onClick={() => setTab('servers')}><Globe size={15} /> Servers</button>
            <button type="button" role="tab" aria-selected={tab === 'bots'} className={tab === 'bots' ? 'on' : ''} onClick={() => setTab('bots')}><Bot size={15} /> Bots</button>
          </div>
        </div>
      </header>
      <div className="vc-disc-content">
        {tab === 'servers' ? <ServerResults q={q} onClose={onClose} /> : <div className="vc-disc-bots"><BotGallery /></div>}
      </div>
    </div>
  );
}

function ServerResults({ q, onClose }) {
  const [deb, setDeb] = useState('');
  const [d, setD] = useState(null); // { results, page, has_more }
  const [err, setErr] = useState(false);
  const mine = useChat(s => s.instances);
  useEffect(() => { const t = setTimeout(() => setDeb(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = (page = 1) => fetch(`/bonfire/directory?q=${encodeURIComponent(deb)}&page=${page}`).then(r => (r.ok ? r.json() : Promise.reject()))
    .then(x => { setErr(false); setD(cur => ({ ...x, results: page > 1 && cur ? [...cur.results, ...x.results] : x.results })); }).catch(() => setErr(true));
  useEffect(() => { setD(null); load(1); }, [deb]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = r => {
    const url = normOrigin(r.url);
    if (!url) return;
    if (mine.some(i => i.origin === url)) { onClose(); go({ kind: 'instance', inst: url }); return; }
    dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url } }));
  };
  return (
    <>
      {d && <div className="vc-disc-count">{deb ? `${d.results.length}${d.has_more ? '+' : ''} result${d.results.length === 1 ? '' : 's'} for "${deb}"` : 'Featured and recently active'}</div>}
      <div className="vc-disc-grid">
        {!d && !err && Array.from({ length: 6 }, (_, i) => <div key={i} className="vc-disc-card skel" />)}
        {err && <div className="vc-empty-note">Couldn't load the directory - try again in a bit.</div>}
        {d && !d.results.length && <div className="vc-empty-note">{deb ? 'No servers match that.' : 'No servers are listed yet.'}</div>}
        {d?.results.map((r, i) => {
          const url = normOrigin(r.url);
          const added = mine.some(x => x.origin === url);
          return (
            <div key={r.id || r.url} className="vc-disc-card vl-rise" style={{ '--i': Math.min(i, 12) }}>
              <div className="vc-disc-banner" style={{ '--hue': (Array.from(String(r.name || '')).reduce((h, c) => h + c.charCodeAt(0), 0) * 37) % 360 }} />
              <span className="vc-srv-ico lg">{/^https:\/\//i.test(r.icon_url || '') ? <img src={r.icon_url} alt="" /> : initials(r.name)}</span>
              <div className="vc-disc-body">
                <b>{r.name}{r.trusted && <ShieldCheck size={14} className="vc-inline-ico vc-disc-trusted" title="Trusted by Nookara" />}</b>
                <small className="vc-disc-host"><Globe size={11} /> {url ? url.replace(/^https?:\/\//, '') : ''}</small>
                <p>{r.description || 'No description.'}</p>
                {r.tags?.length > 0 && <div className="vc-disc-tags">{r.tags.slice(0, 6).map(t => <span key={t} className="vc-chip">{t}</span>)}</div>}
                <div className="vc-disc-foot">
                  <span><Users size={13} /> {Number(r.member_count) || 0} member{Number(r.member_count) === 1 ? '' : 's'}</span>
                  <button type="button" className={`btn ${added ? 'btn-surface' : 'btn-primary'}`} disabled={!url} onClick={() => pick(r)}>{added ? 'Open' : 'Join'}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {d?.has_more && <div className="vc-disc-more"><button type="button" className="btn btn-surface" onClick={() => load((d.page || 1) + 1)}>Load more</button></div>}
    </>
  );
}
