// Discovery: a full page (it takes over the conversation area) instead of a pop-up. A big animated "Discovery" header with
// the search, then Servers / Bots. Servers come in sections, one per homeserver (nookara.cc first, then the biggest).
// The directory listings are untrusted text (shown as text; a card only opens Add a server).
import { useEffect, useState } from 'react';
import { HsVerified } from './verifiedHomes.jsx';
import { HomeChip } from './homeLabels.jsx';
import { ArrowLeft, Bot, Compass, Globe, Search, ShieldCheck, Users, X } from 'lucide-react';
import { loadDirectory, mergeGroups, filterGroups } from './directory.js';
import { joinLabel } from './community.js';
import { useChat } from './store.js';
import { initials } from './initials.js';
import { BotGallery } from './BotGallery.jsx';
import { EMBER_API } from '../compat.js';
import { DISCOVER_TABS, isListedAdded, pickListed } from './discover.js';

export function DiscoverSidebar({ tab, onTab }) {
  return (
    <div className="vc-side vc-disc-side">
      <div className="vc-side-head"><div className="vc-side-title static"><span><Compass size={16} className="vc-inline-ico" /> Discover</span></div></div>
      <div className="vc-side-list" role="tablist" aria-label="Discover">
        {DISCOVER_TABS.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`vc-ch vc-home-link${tab === id ? ' on' : ''}`} onClick={() => onTab(id)}><Icon size={18} /> <span>{label}</span></button>
        ))}
      </div>
    </div>
  );
}

export default function DiscoverPage({ onClose, tab: tabIn = 'servers', onTab }) {
  const [own, setOwn] = useState(tabIn); // (on its own, without Chat.jsx keeping the section)
  const tab = onTab ? tabIn : own, setTab = onTab || setOwn;
  const [q, setQ] = useState('');
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !document.querySelector('.vc-modal-back')) onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="vc-disc-page">
      <header className="vc-disc-hero">
        <HeroTiles />
        <button type="button" className="vc-ico-btn vc-disc-back" onClick={onClose} title="Back" aria-label="Back"><ArrowLeft size={20} /></button>
        <div className="vc-disc-hero-in">
          <span className="vc-disc-kicker"><Compass size={15} /> Explore Ember</span>
          <h1>Discovery</h1>
          <p>{tab === 'servers' ? 'Find communities to join, grouped by the homeserver they live on. Every server here lists itself in the directory.' : 'Bots approved by Nookara staff. Verified bots were looked at before they were listed.'}</p>
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

// directory pictures are untrusted links: only https ones show (the banner across the top of the card, its tint where there's none)
const safeImg = u => /^https:\/\//i.test(u || '');
function ServerResults({ q, onClose }) {
  const [deb, setDeb] = useState('');
  const [d, setD] = useState(null); // { groups, page, has_more, grouped } (directory.js)
  const [err, setErr] = useState(false);
  const mine = useChat(s => s.instances);
  const servers = useChat(s => s.servers);
  useEffect(() => { const t = setTimeout(() => setDeb(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(Object.assign(new Error('request_failed'), { status: r.status }))));
  const load = (page = 1) => loadDirectory(getJson, EMBER_API, { q: deb, page })
    .then(x => { setErr(false); setD(cur => (page > 1 && cur ? { ...x, groups: mergeGroups(cur.groups, x.groups) } : x)); }).catch(() => setErr(true));
  useEffect(() => { setD(null); load(1); }, [deb]); // eslint-disable-line react-hooks/exhaustive-deps
  const isAdded = r => isListedAdded(r, servers, mine);
  const pick = r => { pickListed(r, servers, mine).then(ok => { if (ok) onClose(); }); };
  // the grouped listing may come whole: the search then filters it here too, across every homeserver
  const groups = d ? (d.grouped ? filterGroups(d.groups, deb) : d.groups) : [];
  const total = groups.reduce((n, g) => n + g.communities.length, 0);
  let n = 0;
  return (
    <>
      {d && <div className="vc-disc-count">{deb ? `${total}${d.has_more ? '+' : ''} result${total === 1 ? '' : 's'} for "${deb}"` : 'Featured and recently active'}</div>}
      {!d && !err && <div className="vc-disc-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="vc-disc-card skel" />)}</div>}
      {err && <div className="vc-empty-note">Couldn't load the directory - try again in a bit.</div>}
      {d && !total && !err && <div className="vc-empty-note">{deb ? 'No servers match that.' : 'No servers are listed yet.'}</div>}
      {groups.map(g => (
        <section key={g.domain} className="vc-disc-hs">
          <header className="vc-disc-hs-head">
            <span className="vc-srv-ico">{safeImg(g.icon_url) ? <img src={g.icon_url} alt="" /> : initials(g.name)}</span>
            <div><b>{g.name}<HsVerified domain={g.domain} on={g.verified} /></b>{g.name !== g.domain && <small><Globe size={11} /> {g.domain}</small>}</div>
            <span className="vc-disc-hs-n">{g.communities.length} server{g.communities.length === 1 ? '' : 's'}</span>
          </header>
          <div className="vc-disc-grid">
            {g.communities.map(r => {
              const added = isAdded(r);
              return (
                <div key={r.key} className="vc-disc-card vl-rise" style={{ '--i': Math.min(n++, 12) }}>
                  <div className="vc-disc-banner" style={{ '--hue': hueOf(r.name) }}>{safeImg(r.banner_url) && <img src={r.banner_url} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} />}</div>
                  <HomeChip domain={r.address ? r.address.split('@')[1] : g.domain} className="on-banner" />
                  <span className="vc-srv-ico lg">{safeImg(r.icon_url) ? <img src={r.icon_url} alt="" /> : initials(r.name)}</span>
                  <div className="vc-disc-body">
                    <b>{r.name}{r.trusted && <ShieldCheck size={14} className="vc-inline-ico vc-disc-trusted" title="Trusted by Nookara" />}</b>
                    <small className="vc-disc-host" title="Its homeserver"><Globe size={11} /> {r.address ? r.address.split('@')[1] : r.url ? r.url.replace(/^https?:\/\//, '') : g.domain}</small>
                    <p>{r.description || 'No description.'}</p>
                    {r.tags.length > 0 && <div className="vc-disc-tags">{r.tags.slice(0, 6).map(t => <span key={t} className="vc-chip">{t}</span>)}</div>}
                    <div className="vc-disc-foot">
                      <span><Users size={13} /> {r.member_count} member{r.member_count === 1 ? '' : 's'}</span>
                      <button type="button" className={`btn ${added ? 'btn-surface' : 'btn-primary'}`} disabled={!r.url && !r.address} onClick={() => pick(r)}>{added ? 'Open' : joinLabel(r.join_policy, 'Join')}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {d?.has_more && <div className="vc-disc-more"><button type="button" className="btn btn-surface" onClick={() => load((d.page || 1) + 1)}>Load more</button></div>}
    </>
  );
}

// the hero's background, like Nookara's homepage: a tilted wall of server banners with their icons, drifting slowly.
// Tiles come from the directory (its first page) and the servers you're in; a server with no banner gets a tinted card.
const hueOf = name => (Array.from(String(name || '')).reduce((h, c) => h + c.charCodeAt(0), 0) * 37) % 360;
function HeroTiles() {
  const mine = useChat(s => s.servers);
  const [dir, setDir] = useState([]);
  useEffect(() => { fetch(`${EMBER_API}/directory?q=&page=1`).then(r => (r.ok ? r.json() : null)).then(d => setDir(d?.results || [])).catch(() => {}); }, []);
  const safe = u => (/^https:\/\//i.test(u || '') || /^\/(uploads|assets)\//.test(u || '') ? u : null);
  const items = [
    ...dir.map(r => ({ k: `d${r.id || r.url}`, name: r.name, icon: safe(r.icon_url), banner: safe(r.banner_url) })),
    ...mine.map(s => ({ k: `m${s.sid}`, name: s.name, icon: safe(s.icon), banner: safe(s.banner) })),
  ];
  const base = items.length ? items : Array.from({ length: 8 }, (_, i) => ({ k: `x${i}`, name: ['Pixel', 'Night', 'Den', 'Arcade', 'Studio', 'Lounge', 'Garden', 'Lab'][i] }));
  const row = n => { const out = []; for (let i = 0; out.length < 12; i++) out.push(base[(i * 3 + n * 5) % base.length]); return [...out, ...out]; }; // doubled for a seamless loop
  return (
    <div className="vc-disc-bg" aria-hidden="true">
      <div className="vc-disc-wall">
        {[0, 1, 2, 3].map(n => (
          <div key={n} className={`vc-disc-wall-row${n % 2 ? ' rev' : ''}`}>
            {row(n).map((t, i) => (
              <span key={`${t.k}-${i}`} className="vc-disc-tile" style={{ '--hue': hueOf(t.name) }}>
                {t.banner && <img className="vc-disc-tile-bg" src={t.banner} alt="" loading="lazy" />}
                <span className="vc-disc-tile-ico">{t.icon ? <img src={t.icon} alt="" loading="lazy" /> : initials(t.name)}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <i className="vc-disc-shade" />
    </div>
  );
}
