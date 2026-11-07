// Settings pages for how Ember looks (Modern only: Theme, Text & layout) and two that work in both looks (Blocking, and the
// per-server notification levels shown on the Notifications page). Appearance lives in look.js (per device).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Palette, Type, ShieldOff, Bell, ImagePlus, Trash2, Upload, MessageCircle, Server, Check, RotateCcw, UserX } from 'lucide-react';
import { SettingsPage, SCard, SRow, OptionCards, Switch, ResetButton, PreviewArea, usePv } from './ui.jsx';
import { getLook, setLook, subscribeLook, resetLook, THEMES, FONTS, getBgImage, setBgImage, setCustomFont, hasCustomFont, DEFAULT_LOOK } from '../look.js';
import { useChat, setNotify, notifyOf, toggleBlock, toast, ask } from '../store.js';
import { ServerIcon } from '../ServerIcon.jsx';
import { Avatar } from '../Profile.jsx';
import './look-pages.css';

const useLook = () => useSyncExternalStore(subscribeLook, getLook);
const ACCENTS = ['#e88fb4', '#5865f2', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a78bfa'];

// a tiny Ember: sidebar, a few messages (one mentions you), the composer. Parts get outlined while their setting is hovered.
export function MiniChat() {
  const hl = usePv;
  return (
    <PreviewArea>
      <div className={`lp-mini${hl(['bg', 'theme'])}`}>
        <div className={`lp-mini-side${hl(['theme', 'radius'])}`}>
          <i className="lp-ch on" /><i className="lp-ch" /><i className="lp-ch" />
        </div>
        <div className={`lp-mini-main${hl(['theme', 'radius'])}`}>
          <div className={`lp-msgs${hl('density')}`}>
            <div className="lp-msg"><span className="lp-av" style={{ background: '#d68ee0' }} /><div><b style={{ color: '#d68ee0' }}>ada</b> <small>3:41 PM</small><p className={`lp-text${hl(['text-size', 'font', 'text'])}`}>just shipped the new sidebar <span className={`lp-emoji${hl('emoji')}`}>&#x1F389;</span></p></div></div>
            <div className="lp-msg"><span className="lp-av" style={{ background: '#6fcf8f' }} /><div><b style={{ color: '#6fcf8f' }}>deploybot</b> <small>3:42 PM</small><p className={`lp-text${hl(['text-size', 'font', 'text'])}`}>Build #412 passed in 48s.</p></div></div>
            <div className={`lp-msg mention${hl('mention')}`}><span className="lp-av" style={{ background: '#8ab4f8' }} /><div><b style={{ color: '#8ab4f8' }}>sol</b> <small>3:45 PM</small><p className={`lp-text${hl(['text-size', 'font', 'text'])}`}><span className={`lp-at${hl('accent')}`}>@you</span> can you check the popout too?</p></div></div>
          </div>
          <div className={`lp-composer${hl('radius')}`}><span>Message #general</span><i className={`lp-send${hl('accent')}`} /></div>
        </div>
      </div>
    </PreviewArea>
  );
}

function ColorField({ label, value, fallback, onChange }) {
  return (
    <label className="lp-color">
      <span>{label}</span>
      <span className="lp-color-row">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : fallback} onChange={e => onChange(e.target.value)} aria-label={`${label} colour`} />
        <input className="form-input" value={value} placeholder={fallback} maxLength={7} onChange={e => onChange(e.target.value.trim())} />
        <button type="button" className="btn btn-surface btn-sm" disabled={!value} onClick={() => onChange('')}>Reset</button>
      </span>
    </label>
  );
}

// ── Theme ──
export function ThemePage() {
  const L = useLook();
  const t = THEMES[L.theme] || THEMES.dark;
  const [bg, setBgState] = useState(getBgImage);
  const file = useRef(null);
  function pickBg(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('That has to be a picture.'); return; }
    if (f.size > 3 * 1024 * 1024) { toast('Pick a picture under 3 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { try { setBgImage(r.result); setBgState(r.result); } catch { toast("That picture is too big to keep on this device."); } };
    r.readAsDataURL(f);
  }
  return (
    <SettingsPage icon={Palette} title="Theme" sub="Colours, background picture and corners. Saved on this device, Modern look only.">
      <MiniChat />
      <SCard title="Choose a theme" target="theme">
        <div className="lp-themes">
          {Object.entries(THEMES).map(([k, th]) => (
            <button type="button" key={k} className={`lp-theme${L.theme === k ? ' on' : ''}`} onClick={() => setLook({ theme: k, bg: '', panel: '', text: '' })} aria-pressed={L.theme === k}>
              <span className="lp-theme-art" style={{ background: th.app }}>
                <i style={{ background: th.side }} /><i style={{ background: th.main }}><em style={{ background: th.accent || '#e88fb4' }} /><em style={{ background: th.raised }} /></i>
              </span>
              <span className="lp-theme-name">{th.name}{L.theme === k && <Check size={14} />}</span>
            </button>
          ))}
        </div>
      </SCard>
      <SCard title="Your own colours" sub="Start from a theme, then change the background, panels or text." target="theme">
        <div className="lp-colors">
          <ColorField label="Background" value={L.bg} fallback={t.app} onChange={v => setLook({ bg: v })} />
          <ColorField label="Panels and menus" value={L.panel} fallback={t.raised} onChange={v => setLook({ panel: v })} />
          <ColorField label="Text" value={L.text} fallback={t.text} onChange={v => setLook({ text: v })} />
        </div>
      </SCard>
      <SCard title="Accent colour" sub="Buttons, highlights and links. Leave it on Theme default to use your theme's (or your profile's) colour." target="accent">
        <div className="lp-swatches">
          <button type="button" className={`lp-swatch-def${!L.accent ? ' on' : ''}`} onClick={() => setLook({ accent: '' })}>Theme default</button>
          {ACCENTS.map(c => <button type="button" key={c} className={`lp-swatch${L.accent === c ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setLook({ accent: c })} />)}
        </div>
        <ColorField label="Custom" value={L.accent} fallback={t.accent || '#e88fb4'} onChange={v => setLook({ accent: v })} />
      </SCard>
      <SCard title="Background picture" sub="Shows behind the server list and around the panels. Only on this device." target="bg">
        <div className="lp-bgpick">
          <span className="lp-bgthumb" style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>{!bg && <ImagePlus size={22} />}</span>
          <button type="button" className="btn btn-surface" onClick={() => file.current?.click()}><Upload size={15} /> {bg ? 'Change picture' : 'Upload picture'}</button>
          {bg && <button type="button" className="btn btn-danger" onClick={() => { setBgImage(''); setBgState(''); }}><Trash2 size={15} /> Remove</button>}
          <input ref={file} type="file" accept="image/*" hidden onChange={pickBg} />
        </div>
      </SCard>
      <SCard title="Corner roundness" target="radius">
        <OptionCards cols={4} value={L.radius} onPick={v => setLook({ radius: v })} options={[
          { v: 'none', label: 'None', sub: 'Sharp corners', art: <span className="lp-corner" style={{ '--r': '0px' }} /> },
          { v: 'small', label: 'Small', sub: 'Subtle', art: <span className="lp-corner" style={{ '--r': '5px' }} /> },
          { v: 'medium', label: 'Medium', sub: 'Default', art: <span className="lp-corner" style={{ '--r': '10px' }} /> },
          { v: 'large', label: 'Large', sub: 'Very round', art: <span className="lp-corner" style={{ '--r': '18px' }} /> },
        ]} />
      </SCard>
      <SCard title="Mention highlight colour" sub="The colour of messages that mention you. Leave it empty to use your accent colour." target="mention">
        <ColorField label="Highlight" value={L.mention} fallback="#e0b25a" onChange={v => setLook({ mention: v })} />
      </SCard>
      <ResetButton onClick={() => { resetLook(['theme', 'bg', 'panel', 'text', 'accent', 'radius', 'mention']); setBgImage(''); setBgState(''); }} />
    </SettingsPage>
  );
}

// ── Text & layout ──
export function TextLayoutPage() {
  const L = useLook();
  const file = useRef(null);
  const [custom, setCustom] = useState(hasCustomFont);
  function pickFont(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) { toast('Pick a .ttf, .otf or .woff font file.'); return; }
    if (f.size > 2.5 * 1024 * 1024) { toast('Pick a font file under 2.5 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { try { setCustomFont(r.result); setCustom(true); setLook({ font: 'custom' }); } catch { toast("That font is too big to keep on this device."); } };
    r.readAsDataURL(f);
  }
  const size = Number(L.textSize) || 15.5;
  return (
    <SettingsPage icon={Type} title="Text & layout" sub="Font, text size, how tightly messages sit, emoji size and scrollbars. Modern look only.">
      <MiniChat />
      <SCard title="Message text size" sub="Ctrl + and Ctrl - still zoom everything." target="text-size">
        <div className="lp-slider">
          <input type="range" min="12" max="20" step="0.5" value={size} onChange={e => setLook({ textSize: Number(e.target.value) })} aria-label="Message text size" />
          <b>{size}px</b>
        </div>
        <div className="lp-ticks"><span>Small</span><span>Default</span><span>Large</span><span>Extra large</span></div>
      </SCard>
      <SCard title="Font" target="font">
        <OptionCards cols={3} value={L.font} onPick={v => (v === 'custom' && !custom ? file.current?.click() : setLook({ font: v }))} options={Object.entries(FONTS).map(([k, f]) => ({ v: k, label: f.name, sub: k === 'custom' && !custom ? 'Choose a file' : f.sub, art: <span className="lp-aa" style={{ fontFamily: f.stack }}>Aa</span> }))} />
        <div className="lp-fontfile">
          <button type="button" className="btn btn-surface btn-sm" onClick={() => file.current?.click()}><Upload size={14} /> {custom ? 'Replace font file' : 'Browse font file'}</button>
          {custom && <button type="button" className="btn btn-danger btn-sm" onClick={() => { setCustomFont(''); setCustom(false); if (L.font === 'custom') setLook({ font: 'roboto' }); }}><Trash2 size={14} /> Remove</button>}
          <small>Stored on this device only.</small>
          <input ref={file} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={pickFont} />
        </div>
      </SCard>
      <SCard title="Density" target="density">
        <OptionCards value={L.density} onPick={v => setLook({ density: v })} options={[
          { v: 'spacious', label: 'Spacious', sub: 'More room between messages', art: <span className="lp-lines g3" /> },
          { v: 'comfortable', label: 'Comfortable', sub: 'Standard spacing', art: <span className="lp-lines g2" /> },
          { v: 'compact', label: 'Compact', sub: 'Tighter rows', art: <span className="lp-lines g1" /> },
        ]} />
      </SCard>
      <SCard title="Emoji size" target="emoji">
        <OptionCards value={L.emoji} onPick={v => setLook({ emoji: v })} options={[
          { v: 'small', label: 'Small', sub: '16px, subtle', art: <span style={{ fontSize: 16 }}>&#x1F389;</span> },
          { v: 'default', label: 'Default', sub: '22px', art: <span style={{ fontSize: 22 }}>&#x1F389;</span> },
          { v: 'large', label: 'Large', sub: '30px, expressive', art: <span style={{ fontSize: 30 }}>&#x1F389;</span> },
        ]} />
      </SCard>
      <SCard>
        <SRow title="Hide scrollbars" sub="Lists still scroll; the bars just stay out of sight.">
          <Switch on={L.hideScroll} onChange={v => setLook({ hideScroll: v })} label="Hide scrollbars" />
        </SRow>
        <SRow title="Show who posted recently" sub="Up to 3 pictures next to a channel of people who posted there in the last 10 minutes.">
          <Switch on={L.recentPosters} onChange={v => setLook({ recentPosters: v })} label="Show who posted recently" />
        </SRow>
        <SRow title="Show client icons" sub="Which app a message was sent from, next to the name, where Nookara shares it with you.">
          <Switch on={L.clientIcons} onChange={v => setLook({ clientIcons: v })} label="Show client icons" />
        </SRow>
      </SCard>
      <ResetButton onClick={() => { resetLook(['textSize', 'font', 'density', 'emoji', 'hideScroll', 'recentPosters', 'clientIcons']); }} />
    </SettingsPage>
  );
}

// ── Blocking (both looks) ──
function BlockArt({ mode }) {
  return (
    <span className="lp-block-art">
      <i />
      {mode === 'button' ? <em>Blocked - Show</em> : mode === 'show' ? <i className="hot" /> : null}
      <i />
    </span>
  );
}
export function BlockingPage() {
  const L = useLook();
  const blocks = useChat(s => s.blocks);
  const people = useChat(s => s.people);
  async function unblock(u) {
    if (!(await ask({ title: `Unblock ${u}?`, text: 'They can message you and see you again, as before.', confirm: 'Unblock' }))) return;
    toggleBlock(u, true);
  }
  return (
    <SettingsPage icon={ShieldOff} title="Blocking" sub="Who you've blocked, and how their messages show.">
      <SCard title="Blocked people">
        {!blocks?.length && <div className="sx-empty"><UserX size={26} /><b>No blocked people</b><span>People you block show up here.</span></div>}
        {blocks?.map(b => (
          <div key={b.username} className="sx-list-row">
            <Avatar user={{ username: b.username, pfp: b.pfp_url || people[b.username]?.pfp }} size={34} />
            <div className="sx-row-txt"><b>{b.username}</b>{b.blocked_at && <span>Blocked {new Date(b.blocked_at).toLocaleDateString()}</span>}</div>
            <button type="button" className="btn btn-surface btn-sm" onClick={() => unblock(b.username)}>Unblock</button>
          </div>
        ))}
      </SCard>
      <SCard title="Messages from blocked people in servers">
        <OptionCards value={L.blocked} onPick={v => setLook({ blocked: v })} options={[
          { v: 'hide', label: 'Hide fully', sub: "Their messages aren't shown at all", art: <BlockArt mode="hide" /> },
          { v: 'button', label: 'Hide with a button', sub: 'A small notice you can click to show it', art: <BlockArt mode="button" /> },
          { v: 'show', label: 'Show', sub: 'Show their messages like anyone else\'s', art: <BlockArt mode="show" /> },
        ]} />
      </SCard>
    </SettingsPage>
  );
}

// ── Notifications: a level per server (both looks; shown on the Notifications page) ──
export function NotifLevels() {
  const servers = useChat(s => s.servers);
  useChat(s => s.notify);
  const levelOf = target => { const n = notifyOf(target); return n?.muted_until && n.muted_until > Date.now() ? 'mute' : n?.level === 'all' ? 'all' : n?.level === 'none' ? 'mute' : 'mentions'; };
  const pick = (target, v) => setNotify(target, v === 'mute' ? { mute_minutes: -1 } : { level: v, mute_minutes: 0 }).catch?.(() => {});
  const Seg = ({ target }) => {
    const cur = levelOf(target);
    return <div className="sx-seg">{[['all', 'All'], ['mentions', 'Mentions'], ['mute', 'Mute']].map(([v, l]) => <button type="button" key={v} className={cur === v ? 'on' : ''} onClick={() => pick(target, v)}>{l}</button>)}</div>;
  };
  if (!servers.length) return null;
  return (
    <SCard title="Servers" sub="What each server notifies you about. Mute also stops unread badges. Right-click a channel to set it on its own.">
      {servers.map(s => (
        <div key={s.sid} className="sx-list-row">
          <span className="lp-srv"><ServerIcon src={s.icon} name={s.name} /></span>
          <div className="sx-row-txt"><b>{s.name}</b>{s.inst && <span>{String(s.inst).replace(/^https?:\/\//, '')}</span>}</div>
          <Seg target={s.sid} />
        </div>
      ))}
    </SCard>
  );
}
export const useLookValue = useLook;
export { DEFAULT_LOOK, RotateCcw, Bell, MessageCircle, Server };
