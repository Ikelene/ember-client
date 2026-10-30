// Link previews under messages. The server makes them (GET /chat/unfurl: Velora, or the instance a message is on) - the
// browser never visits the linked site; pictures come from that server too. YouTube gets Ember's own player (YouTube's
// embed, or streamed through the instance / Velora), Ember invites + Velora profiles get their own cards.
import { VideoPlayer, fmtTime } from './MediaPlayer.jsx';
import { viewPicture } from './MediaViewer.jsx';
import { useEffect, useRef, useState } from 'react';
import { Play, Download, ShieldCheck, Eye, Loader2, Users, ExternalLink, BookmarkPlus, BookmarkCheck, Coins, Heart, Clock } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, getState, toast, errorText, openLink, saveSettings, loadMedia, hashFor } from './store.js';
import { K } from './ids.js';
import { inviteRef, paymentRef, glintRef } from './inviteLink.js';
import { GlintMark, GLINT_DOWNLOAD, clipLikes, setClipLike, openOutside } from './glint.jsx';

const cache = new Map(); // inst|url -> promise of the embed
function useUnfurl(url, inst) {
  const k = `${inst || ''}|${url}`;
  const [e, setE] = useState(() => (cache.get(k)?.done ? cache.get(k).value : undefined));
  useEffect(() => {
    let live = true;
    if (!cache.has(k)) {
      const entry = { done: false };
      entry.p = apiFetch(`/chat/unfurl?url=${encodeURIComponent(url)}`, { inst }).then(d => d.embed).catch(() => null)
        .then(v => { entry.done = true; entry.value = v; return v; });
      cache.set(k, entry);
    }
    cache.get(k).p.then(v => { if (live) setE(v); });
    return () => { live = false; };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return e;
}

// inst: the instance a message is on (its previews come from there), undefined for Velora's own
export function LinkEmbeds({ urls, inst }) {
  if (!urls?.length) return null;
  return urls.slice(0, 3).map(u => <OneEmbed key={u} url={u} inst={inst} />);
}
function OneEmbed({ url, inst }) {
  const ref = inviteRef(url) || paymentRef(url) || glintRef(url);
  // invite + payment + Glint cards are made by Velora even for a message on an instance (an invite asks the invited instance, see unfurl.js)
  const e = useUnfurl(url, ref ? undefined : inst);
  if (!e) return e === null && ref?.sure ? <a className="vc-invite-fallback" href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a> : null; // (its link hides in the text, so show it if there is no card)
  if (e.type === 'youtube') return <YouTubeEmbed e={e} inst={inst} />;
  if (e.type === 'glint') return <GlintEmbed e={e} />;
  if (e.type === 'invite') return <InviteEmbed e={e} />;
  if (e.type === 'profile') return <ProfileEmbed e={e} />;
  if (e.type === 'payment') return <PaymentEmbed e={e} url={url} />;
  return (
    <div className="vc-embed vc-link-embed vl-rise" style={e.color != null ? { '--ec': `#${Number(e.color).toString(16).padStart(6, '0')}` } : undefined}>
      <div className="vc-embed-main">
        {e.site && <div className="vc-embed-site">{e.site}</div>}
        {e.title && <a className="vc-embed-title" href={e.url} target="_blank" rel="noopener noreferrer nofollow">{e.title}</a>}
        {e.description && <div className="vc-embed-desc">{e.description}</div>}
        {e.image && e.large && <img className="vc-embed-image vc-viewable" src={e.image} alt="" loading="lazy" onClick={() => viewPicture(e.image)} />}
      </div>
      {e.image && !e.large && <img className="vc-embed-thumb vc-viewable" src={e.image} alt="" loading="lazy" onClick={() => viewPicture(e.image)} />}
    </div>
  );
}

// ── YouTube ──
const PRO = ['pro', 'plus', 'admin', 'mod', 'owner'];
const isPro = () => { const me = getState().me; return PRO.includes(me?.rank) || PRO.includes(me?.credit_tier); };
// who streams it: the instance (when its yt-dlp player works), else Velora (signed in), else nobody (YouTube's own player only)
function useYtVia(inst) {
  const instYt = useChat(s => !!inst && !!s.instances.find(i => i.origin === inst)?.features?.youtube);
  const signedIn = useChat(s => s.signedIn);
  return instYt ? inst : signedIn ? 'velora' : null;
}
const viaOpt = via => (via && via !== 'velora' ? { inst: via } : {});
async function prepare(id, via, onProgress) {
  for (let i = 0; i < 400; i++) {
    const d = await apiFetch(i ? `/chat/yt/${id}/status` : `/chat/yt/${id}/prepare`, i ? viaOpt(via) : { method: 'POST', ...viaOpt(via) });
    if (d.status === 'ready') return d;
    if (d.status === 'error') throw new Error(d.error);
    onProgress?.(d);
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('failed');
}
const YT_ERR = { too_long: 'That video is too long to stream here (2 hours max) - watch it on YouTube.', not_available: "That video can't be fetched (private, age-restricted or blocked).", server_busy: 'The player is busy right now - try again in a bit.', failed: "Couldn't get that video." };

function YouTubeEmbed({ e, inst }) {
  const via = useYtVia(inst);
  const onInst = !!via && via !== 'velora';
  const mode0 = useChat(s => s.settings.yt_mode || 'ask');
  const mode = !via ? 'youtube' : mode0;
  const [playing, setPlaying] = useState(null); // null | 'ask' | 'youtube' | 'velora'
  const [remember, setRemember] = useState(false);
  const [dl, setDl] = useState(null); // download progress
  const [sv, setSv] = useState(null); // saving to Saved Media: null | { progress } | 'done'
  async function saveToMedia() {
    if (sv) return;
    setSv({ progress: 0 });
    try {
      for (let i = 0; i < 400; i++) {
        const d = await apiFetch(`/chat/yt/${e.id}/save`, { method: 'POST', body: JSON.stringify({ title: e.title || '' }) }); // (Velora only: an instance's copy wouldn't be in Saved Media)
        if (d.status === 'saved') { setSv('done'); loadMedia(); toast('Saved to Saved Media.', true); return; }
        if (d.status === 'error') throw new Error(d.error);
        setSv({ progress: d.progress || 0 });
        await new Promise(r => setTimeout(r, 1500));
      }
      throw new Error('failed');
    } catch (er) { setSv(null); toast(YT_ERR[er.message] || errorText(er.message)); }
  }
  function choose(m) {
    if (remember) saveSettings({ yt_mode: m }).catch(() => {});
    setPlaying(m);
  }
  async function download() {
    if (dl) return;
    setDl({ progress: 0 });
    try {
      const d = await prepare(e.id, via, p => setDl({ progress: p.progress || 0 }));
      if (!d.download) throw new Error('pro_only');
      const a = document.createElement('a');
      a.href = d.download; a.download = `${e.title || e.id}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (er) { toast(er.message === 'pro_only' ? 'Downloading is a Nookara Pro perk.' : YT_ERR[er.message] || errorText(er.message)); }
    setDl(null);
  }
  return (
    <div className="vc-yt vl-rise">
      <div className="vc-yt-head">
        <div className="vc-yt-titles">
          <span className="vc-yt-channel">{e.channel || 'YouTube'}</span>
          <a className="vc-yt-title" href={e.url} target="_blank" rel="noopener noreferrer nofollow">{e.title || 'YouTube video'}</a>
        </div>
        {via === 'velora' && <button type="button" className={`vc-yt-dl${sv === 'done' ? ' done' : ''}`} title={sv === 'done' ? 'Saved to Saved Media' : 'Save to Saved Media (a copy in your Nookara storage)'} onClick={saveToMedia} disabled={!!sv}>
          {sv === 'done' ? <BookmarkCheck size={16} /> : sv ? <><Loader2 size={15} className="vc-spin" />{sv.progress ? ` ${sv.progress}%` : ''}</> : <BookmarkPlus size={16} />}
        </button>}
        {(onInst || (via === 'velora' && isPro())) && (
          <button type="button" className="vc-yt-dl" title={onInst ? 'Download' : 'Download (Nookara Pro)'} onClick={download} disabled={!!dl}>
            {dl ? <><Loader2 size={15} className="vc-spin" />{dl.progress ? ` ${dl.progress}%` : ''}</> : <Download size={16} />}
          </button>
        )}
      </div>
      <div className="vc-yt-stage">
        {playing === 'youtube' && (
          <iframe title={e.title || 'YouTube'} src={`https://www.youtube-nocookie.com/embed/${e.id}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        )}
        {playing === 'velora' && <VeloraPlayer id={e.id} via={via} />}
        {!playing || playing === 'ask' ? (
          <>
            {e.image && <img src={e.image} alt="" loading="lazy" />}
            {playing === 'ask' ? (
              <div className="vc-yt-ask">
                <b>How do you want to watch?</b>
                <button type="button" className="vc-yt-opt good" onClick={() => choose('velora')}>
                  <ShieldCheck size={18} /><span><b>{onInst ? 'Through this server' : 'Through Nookara'}</b><small>{onInst ? 'This server' : 'Nookara'} streams it for you - no ads, no trackers. Can take a moment to start.</small></span>
                </button>
                <button type="button" className="vc-yt-opt" onClick={() => choose('youtube')}>
                  <Eye size={18} /><span><b>YouTube's player</b><small>Starts straight away, but YouTube can track you and show ads.</small></span>
                </button>
                <label className="vc-check sm"><input type="checkbox" checked={remember} onChange={ev => setRemember(ev.target.checked)} /><span>Remember my choice (change it in My Account &gt; Chat)</span></label>
              </div>
            ) : (
              <button type="button" className="vc-yt-play" title="Play" onClick={() => setPlaying(mode === 'ask' ? 'ask' : mode)}><Play size={26} fill="currentColor" /></button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
function VeloraPlayer({ id, via }) {
  const [src, setSrc] = useState(null);
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    prepare(id, via, d => live && setP(d)).then(d => live && setSrc(d.src)).catch(er => live && setErr(YT_ERR[er.message] || (er.message === 'youtube_unavailable' ? errorText(er.message) : YT_ERR.failed)));
    return () => { live = false; };
  }, [id, via]);
  if (err) return <div className="vc-yt-wait error">{err}</div>;
  if (!src) {
    return (
      <div className="vc-yt-wait">
        <Loader2 size={26} className="vc-spin" />
        <b>{via && via !== 'velora' ? 'The server' : 'Nookara'} is getting the video ready</b>
        <span>{p?.status === 'queued' ? 'Waiting for a free slot...' : `${p?.progress || 0}%${p?.part > 1 ? ' (audio)' : ''}`}</span>
        <i className="vc-yt-bar"><i style={{ width: `${p?.progress || 0}%` }} /></i>
      </div>
    );
  }
  return <VideoPlayer src={src} autoPlay className="vc-yt-video" onError={() => setErr('That video stopped working - try playing it again.')} />;
}

// ── Glint clips (ikelene.net/glint/c/<id>) ──
// Velora reads the clip page (its glint:* meta, or just its OpenGraph video) and re-hosts the pictures; the video itself is a
// file on Velora / ikelene.net and plays in Ember's player only after a click (nothing loads before that). Likes go to
// Glint's API with Ember's token; whether I liked it is asked once the card scrolls into view.
const GLINT_MEDIA = /^https:\/\/((?:(?:ember\.)?nookara\.cc|velora\.ikelene\.net)|(www\.)?ikelene\.net)\//i;
const compact = n => (n >= 1e6 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')}K` : String(n));
const outside = url => ev => { if (window.bonfireDesktop?.openExternal) { ev.preventDefault(); openOutside(url); } }; // the desktop app opens https links in the browser
function GlintLike({ id, initial }) {
  const box = useRef(null);
  const [st, setSt] = useState({ liked: false, likes: initial ?? 0, known: false });
  const [pop, setPop] = useState(0);
  const [tip, setTip] = useState(null);
  const signedIn = useChat(s => s.signedIn);
  useEffect(() => {
    const el = box.current;
    if (!el || !id) return undefined;
    let live = true;
    const io = new IntersectionObserver(es => {
      if (!es.some(x => x.isIntersecting)) return;
      io.disconnect();
      clipLikes(id).then(v => { if (live && v) setSt(s => (s.known ? s : { ...v, known: true })); });
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [id]);
  async function toggle() {
    if (!signedIn) { setTip('Sign in to like clips'); return; }
    const was = st;
    const on = !was.liked;
    setSt({ liked: on, likes: Math.max(0, was.likes + (on ? 1 : -1)), known: true });
    if (on) setPop(p => p + 1);
    setTip(null);
    try { const v = await setClipLike(id, on); setSt({ ...v, known: true }); }
    catch (er) { setSt(was); setTip(er.status === 401 ? 'Sign in again to like clips' : er.status === 429 ? 'Slow down a little' : "Couldn't like that right now"); }
  }
  return (
    <button ref={box} type="button" className={`vc-glint-like${st.liked ? ' on' : ''}`} onClick={toggle} title={tip || (st.liked ? 'Unlike' : 'Like')} aria-pressed={st.liked}
      onMouseLeave={() => tip && setTimeout(() => setTip(null), 1500)}>
      <Heart key={pop} size={15} fill={st.liked ? 'currentColor' : 'none'} className={pop ? 'pop' : undefined} />
      <span>{compact(st.likes)}</span>
      {tip && <small className="vc-glint-tip" role="status">{tip}</small>}
    </button>
  );
}
function GlintEmbed({ e }) {
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState(false);
  const video = GLINT_MEDIA.test(e.video || '') ? e.video : null;
  const ratio = e.width && e.height ? Math.min(2.4, Math.max(0.5, e.width / e.height)) : 16 / 9;
  const stats = [
    e.duration != null && <span key="d" title="Length"><Clock size={13} />{fmtTime(e.duration)}</span>,
    e.views != null && <span key="v" title={`${e.views.toLocaleString()} view${e.views === 1 ? '' : 's'}`}><Eye size={13} />{compact(e.views)}</span>,
  ].filter(Boolean);
  return (
    <div className="vc-glint vl-rise">
      <div className="vc-glint-head">
        {e.avatar ? <img className="vc-glint-av" src={e.avatar} alt="" loading="lazy" onError={ev => { ev.currentTarget.style.visibility = 'hidden'; }} />
          : <span className="vc-glint-av none"><GlintMark size={18} /></span>}
        <div className="vc-glint-titles">
          <span className="vc-glint-line">{e.user ? <><b>{e.user}</b> shared <b>{e.title}</b>!</> : <b>{e.title}</b>}</span>
          {(e.game || stats.length > 0) && (
            <span className="vc-glint-meta">
              {e.game && <span className="vc-glint-game">{e.game_icon && <img src={e.game_icon} alt="" loading="lazy" onError={ev => { ev.currentTarget.remove(); }} />}{e.game}</span>}
              {stats}
            </span>
          )}
        </div>
        <a className="vc-glint-badge" href={GLINT_DOWNLOAD} target="_blank" rel="noopener noreferrer" onClick={outside(GLINT_DOWNLOAD)} title="Glint clip - get Glint"><GlintMark size={12} />CLIP</a>
      </div>
      <div className="vc-yt-stage vc-glint-stage" style={{ aspectRatio: String(ratio) }}>
        {playing && video && !err ? (
          <VideoPlayer src={video} poster={e.thumb || undefined} autoPlay className="vc-glint-video" onError={() => setErr(true)} />
        ) : (
          <>
            {e.thumb ? <img src={e.thumb} alt="" loading="lazy" /> : <span className="vc-glint-nothumb"><GlintMark size={40} /></span>}
            {err ? <span className="vc-glint-err">This clip can't be played here - open it in the browser.</span>
              : video && <button type="button" className="vc-glint-play" title="Play clip" onClick={() => setPlaying(true)}><Play size={24} fill="currentColor" /></button>}
            {e.duration != null && <span className="vc-glint-len">{fmtTime(e.duration)}</span>}
          </>
        )}
      </div>
      <div className="vc-glint-foot">
        <a className="vc-glint-site" href={GLINT_DOWNLOAD} target="_blank" rel="noopener noreferrer" onClick={outside(GLINT_DOWNLOAD)} title="Get Glint"><GlintMark size={12} />Glint</a>
        <span className="grow" />
        {e.id && <GlintLike id={e.id} initial={e.likes} />}
        <a className="vc-glint-open" href={e.url} target="_blank" rel="noopener noreferrer nofollow" onClick={outside(e.url)}><ExternalLink size={14} />Open in browser</a>
      </div>
    </div>
  );
}

// ── Ember invites ──
function InviteEmbed({ e }) {
  const [busy, setBusy] = useState(false);
  const mine = useChat(st => (e.server && e.inst ? st.servers.some(x => x.sid === K(e.inst, e.server.sid)) : false));
  if (e.invalid) return <div className="vc-invite-card bad vl-rise"><b>Invalid invite</b><span>This invite link doesn't work any more.</span></div>;
  const s = e.server;
  const names = (e.people || []).map(p => p.username);
  const others = Math.max(0, s.member_count - names.length);
  const line = names.length ? `Join ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}${others ? ` and ${others} other${others === 1 ? '' : 's'}` : ''}` : '';
  return (
    <div className="vc-invite-card vl-rise">
      {s.banner && <div className="vc-invite-banner" style={{ backgroundImage: `url(${s.banner})` }} />}
      <small className="vc-invite-kicker">You've been invited to join a server</small>
      <div className="vc-invite-main">
        <span className="vc-srv-ico lg">{s.icon ? <img src={s.icon} alt="" /> : s.name.slice(0, 2)}</span>
        <div className="vc-invite-info">
          <b>{s.name}</b>
          <span>{s.online != null && <><i className="dot on" /> {s.online} online </>}<i className="dot" /> {s.member_count} member{s.member_count === 1 ? '' : 's'}{e.inst && <small className="vc-invite-host">{e.inst.replace('https://', '')}</small>}</span>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); openLink(e.inst ? (mine ? hashFor({ kind: 'server', sid: K(e.inst, s.sid) }) : hashFor({ kind: 'invite', code: e.code, inst: e.inst })) : e.joined ? `#/s/${s.sid}` : `#/invite/${e.code}`); setBusy(false); }}>{e.joined || mine ? 'Open' : 'Join'}</button>
      </div>
      {line && (
        <div className="vc-invite-people">
          <span className="vc-invite-faces">{e.people.map(p => p.pfp ? <img key={p.username} src={p.pfp} alt="" onError={ev => { ev.currentTarget.style.visibility = 'hidden'; }} /> : <span key={p.username} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:22,height:22,borderRadius:'50%',background:'#6b6f76',color:'#fff',fontSize:12,fontWeight:600}}>{(p.username || '?').charAt(0).toUpperCase()}</span>)}</span>
          <span><Users size={13} /> {line}</span>
        </div>
      )}
    </div>
  );
}
function ProfileEmbed({ e }) {
  return (
    <a className="vc-profile-card vl-rise" href={`/u/${encodeURIComponent(e.username)}`} target="_blank" rel="noopener noreferrer">
      {e.banner && <span className="vc-profile-banner" style={{ backgroundImage: `url(${e.banner})` }} />}
      <span className="vc-profile-row">
        {e.pfp ? <img src={e.pfp} alt="" /> : <span className="vc-profile-noav" />}
        <span><b style={e.color ? { color: e.color } : undefined}>{e.username}</b><small>{e.bio || 'Nookara profile'}</small></span>
        <ExternalLink size={14} />
      </span>
    </a>
  );
}

// ── Velora payment links (user pay links, payment requests, bot payment requests) ──
const PAY_STATE = { pending: 'Waiting for payment', paid: 'Paid', cancelled: 'Cancelled', expired: 'Expired', failed: 'Failed' };
function PaymentEmbed({ e, url }) {
  if (e.invalid) return <div className="vc-invite-card bad vl-rise"><b>Payment link</b><span>This payment link doesn't work any more.</span></div>;
  const credits = n => `${Number(n).toLocaleString()} credit${Number(n) === 1 ? '' : 's'}`;
  const done = e.status && e.status !== 'pending';
  let title, sub, ico;
  if (e.kind === 'user') { title = `Pay ${e.username}`; sub = 'Send Nookara credits to this person.'; ico = e.pfp ? <img src={e.pfp} alt="" /> : <Coins size={20} />; }
  else if (e.kind === 'bot') { title = `${credits(e.amount)} to ${e.bot}`; sub = e.description || 'Payment request from a bot.'; ico = e.pfp ? <img src={e.pfp} alt="" /> : <Coins size={20} />; }
  else { title = `${credits(e.amount)} to ${e.to}`; sub = `Requested by ${e.project}.`; ico = <Coins size={20} />; }
  return (
    <div className="vc-invite-card vc-pay-card vl-rise">
      <small className="vc-invite-kicker">{e.kind === 'user' ? 'Payment link' : 'Payment request'}</small>
      <div className="vc-invite-main">
        <span className="vc-srv-ico lg vc-pay-ico">{ico}</span>
        <div className="vc-invite-info">
          <b>{title}</b>
          <span>{sub}{e.status && <small className={`vc-pay-state ${e.status}`}>{PAY_STATE[e.status] || e.status}</small>}</span>
        </div>
        <a className={`btn ${done ? 'btn-surface' : 'btn-primary'}`} href={url} target="_blank" rel="noopener noreferrer">{e.kind === 'user' ? 'Pay' : done ? 'View' : 'Review'}</a>
      </div>
    </div>
  );
}
