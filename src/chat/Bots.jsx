// Ember bots: the BOT tag, "Add to server" on a bot's profile, and managing bots: your own on Nookara (My Account > Chat), or an
// instance's (Server settings > Bots; its own b: accounts, its own bot API).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Server, Plus, Copy, Check, RefreshCw, Trash2, Upload, ServerCog, ChevronDown, KeyRound, BookOpen, BadgeCheck, Lock, ShieldCheck, Info, FlaskConical } from 'lucide-react';
import { ServerIcon } from './ServerIcon.jsx';
import { apiFetch, uploadFetch } from '../api.js';
import { confirmBox } from '../components/confirm.js';
import { NOOKARA } from './ids.js';
import { imgHint, warnImage } from './imgHints.js';
import { BotGallerySection } from './BotGalleryDev.jsx';
import { PlanGate, PlanNotice, PlanUsage } from './PlanGate.jsx';
import { usePlan } from './plans.js';
import './Bots.css';
import { pictureAccept } from './accept.js';
import { useAddTargets, addBotToServer, errText } from './bots.js';

export function BotTag({ small, verified }) {
  const z = small ? 13 : 15;
  return (
    <span className={`vc-bot-tag${small ? ' sm' : ''}${verified ? ' ver' : ''}`}>
      <span className="vc-bot-ico" title="Bot - an automated account" aria-label="Bot"><Bot size={z} /></span>
      {verified && <span className="vc-bot-ver" title="Verified bot - approved in the Ember bot gallery" aria-label="Verified bot"><BadgeCheck size={z} /></span>}
    </span>
  );
}

// "Trusted in N servers!" on a verified (gallery-approved) bot's profile; other bots just say "In N servers". Nothing when unknown.
export function TrustedIn({ n, verified = false }) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return null;
  const c = Number(n);
  return verified
    ? <div className="vc-card-sub vc-trusted"><ShieldCheck size={12} /> Trusted in {c} server{c === 1 ? '' : 's'}!</div>
    : <div className="vc-card-sub vc-trusted plain"><Server size={12} /> In {c} server{c === 1 ? '' : 's'}</div>;
}

// the Add to server control: a menu of my servers; locked when the bot is private
export function AddBotButton({ username, info, onDone, className = 'btn btn-primary' }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [pos, setPos] = useState(null);
  const box = useRef(null);
  const menu = useRef(null);
  const targets = useAddTargets();
  useEffect(() => {
    if (!open) return undefined;
    const off = e => { if (box.current && !box.current.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    setTimeout(() => addEventListener('mousedown', off), 0);
    return () => removeEventListener('mousedown', off);
  }, [open]);
  if (!info?.bot?.id) return null;
  const bot = { id: info.bot.id, username: info.bot.username || username };
  // staff see the state of any bot (they may test it); everyone else only owns / sees approved ones
  const locked = !info.bot.public && !info.bot.mine && !info.bot.state;
  if (locked) {
    return (
      <span className="vc-addbot locked">
        <button type="button" className={className} disabled title="This bot is private."><Plus size={14} /> <span>Add to server</span></button>
        <small className="vc-addbot-private"><Lock size={12} /> This bot is private.</small>
      </span>
    );
  }
  // staff (they alone see the state of somebody else's bot) get the test-install dialog for a bot that is not approved yet
  if (!info.bot.mine && !info.bot.public && info.bot.state && info.bot.state !== 'approved' && info.bot.state !== 'banned') {
    return (
      <span className="vc-addbot">
        <button type="button" className={className} title="Adds it as a test install: not counted, nothing changes for its developer"
          onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'test-bot', id: String(bot.id) } }))}><FlaskConical size={14} /> <span>Add as test install</span></button>
      </span>
    );
  }
  const ownPrivate = !!info.bot.mine && !info.bot.public; // my own bot that is not approved in the gallery: only I can add it
  const legacy = Array.isArray(info.can_add_to) ? new Set(info.can_add_to.map(x => x?.sid).filter(Boolean)) : null;
  const list = targets.filter(s => s.inst || !legacy || legacy.has(s.sid));
  async function add(s) {
    setMsg(''); setBusy(s.sid);
    try { const r = await addBotToServer(bot, s); setDone(d => ({ ...d, [s.sid]: r.test ? 'test' : 'ok' })); onDone?.(s); }
    catch (e) { setMsg(errText(e)); }
    setBusy('');
  }
  return (
    <span className="vc-addbot" ref={box}>
      <button type="button" className={className} onClick={e => {
        // the menu floats above everything (cards and dialogs clip their insides), below the button or above it if there's no room
        const r = e.currentTarget.getBoundingClientRect();
        const below = innerHeight - r.bottom > 260;
        setPos({ left: Math.max(8, Math.min(r.left, innerWidth - 268)), ...(below ? { top: r.bottom + 6 } : { bottom: innerHeight - r.top + 6 }) });
        setOpen(o => !o);
      }}><Plus size={14} /> <span>Add to server</span></button>
      {ownPrivate && <small className="vc-addbot-private vc-addbot-ownnote"><Lock size={12} /> Only you can add this bot while it is private.</small>}
      {open && pos && createPortal(
        <div className="vc-addbot-menu" ref={menu} style={pos}>
          <div className="vc-addbot-head">Add {bot.username} to...</div>
          {list.map(s => (
            <button type="button" key={s.sid} disabled={!!done[s.sid] || !!busy} onClick={() => add(s)}>
              <span className="vc-srv-ico sm"><ServerIcon src={s.icon} name={s.name} /></span>
              <span className="grow">{s.name}{s.inst && s.inst !== NOOKARA && <small className="vc-addbot-host"> {s.inst.replace(/^https?:\/\//, '')}</small>}</span>
              {busy === s.sid && <RefreshCw size={13} className="vc-spin" />}
              {done[s.sid] && <><Check size={14} />{done[s.sid] === 'test' && <small>test</small>}</>}
            </button>
          ))}
          {!list.length && <div className="vc-empty-note">No servers to add it to - you need Manage server on one.</div>}
          {Object.values(done).some(Boolean) && <div className="vc-addbot-ok">Added!{Object.values(done).includes('test') ? ' This was a test install (it is not counted).' : ''} Connect the bot to that server's address with its token to bring it online.</div>}
          {msg && <div className="vc-addbot-err">{msg}</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}


function CommandAccess({ sid }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');
  const [err, setErr] = useState('');
  const load = () => apiFetch(`/chat/servers/${sid}/commands/manage`).then(setData).catch(() => setErr("Couldn't load the commands."));
  useEffect(() => { load(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="inline-msg error">{err}</div>;
  if (!data || !data.bots.some(b => b.commands.length)) return null;
  async function setRole(bot, cmd, perms, rid, value) {
    const rest = perms.filter(x => !(x.type === 'role' && x.id === rid));
    const next = value === 'default' ? rest : [...rest, { type: 'role', id: rid, allow: value === 'allow' }];
    try { await apiFetch(`/chat/servers/${sid}/commands/permissions`, { method: 'PUT', body: JSON.stringify({ bot: bot.id, command: cmd?.id || null, permissions: next }) }); await load(); }
    catch (e) { setErr(errText(e)); }
  }
  const editor = (bot, cmd) => {
    const perms = (cmd || bot).perms;
    return (
      <div className="bm-perms">
        {data.roles.map(r => {
          const cur = perms.find(x => x.type === 'role' && x.id === r.rid);
          return (
            <label key={r.rid}>
              <span>{r.is_default ? '@everyone' : r.name}</span>
              <select className="form-input" value={cur ? (cur.allow ? 'allow' : 'deny') : 'default'} onChange={e => setRole(bot, cmd, perms, r.rid, e.target.value)}>
                <option value="default">Default</option>
                <option value="allow">Allowed</option>
                <option value="deny">Blocked</option>
              </select>
            </label>
          );
        })}
      </div>
    );
  };
  return (
    <div className="bm-cmds">
      <div className="bm-cmds-head"><b>Command access</b><small>Choose which roles can use each bot's slash commands and message menu commands.</small></div>
      {data.bots.filter(b => b.commands.length).map(b => (
        <div className="bm-cmd-bot" key={b.id}>
          <button type="button" className="bm-cmd-toggle" onClick={() => setOpen(open === b.id ? '' : b.id)}>
            <ChevronDown size={14} style={{ transform: open === b.id ? 'none' : 'rotate(-90deg)' }} /> {b.username} <small>{b.commands.length} {b.commands.length === 1 ? 'command' : 'commands'}</small>
          </button>
          {open === b.id && (
            <div className="bm-cmd-body">
              <div className="bm-cmd-row"><b>All commands</b>{editor(b, null)}</div>
              {b.commands.map(c => (
                <div className="bm-cmd-row" key={c.id}>
                  <b>{c.type === 1 ? '/' : ''}{c.name}</b>{c.type !== 1 && <small>{c.type === 2 ? 'user menu' : 'message menu'}</small>}
                  {editor(b, c)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── My Account > Chat > Bots (Nookara), or Server settings > Bots (inst = the instance's origin, sid = its community) ──
export function BotsManager({ inst, sid }) {
  const o = inst ? { inst } : {}; // every bot route of an instance goes to that instance
  const api = inst ? `${inst}/bot/v1` : `${location.origin}/chat/api/v1`;
  const gateway = inst ? `${inst.replace(/^http/, 'ws')}/bot/gateway` : `${location.origin.replace(/^http/, 'ws')}/chat/gateway`;
  const [list, setList] = useState(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [token, setToken] = useState(null); // { id, token } - shown once
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const plan = usePlan('bots', inst && list ? list.length : undefined); // (only a server's own bots count against its plan)
  const load = () => { if (inst && plan.gate) { setList([]); return; } apiFetch('/chat/bots', o).then(d => setList(inst ? (d.bots || []).filter(b => !b.gallery) : d.bots)).catch(e => { if (inst && plan.catchPlan(e)) setList([]); else setErr("Couldn't load the bots."); }); }; // (gated: nothing to ask for, the page shows empty behind the overlay)
  useEffect(() => { load(); }, [inst]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = (t, k) => navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1400); });
  async function create(e) {
    e.preventDefault(); setErr('');
    try { const d = await apiFetch('/chat/bots', { ...o, method: 'POST', body: JSON.stringify({ name: name.trim(), description: desc }) }); setToken({ id: d.bot.id, token: d.token }); setName(''); setDesc(''); load(); }
    catch (er) { if (!(inst && plan.catchPlan(er))) setErr(errText(er)); }
  }
  const bid = b => encodeURIComponent(b.id);
  async function patch(b, body) { try { await apiFetch(`/chat/bots/${bid(b)}`, { ...o, method: 'PATCH', body: JSON.stringify(body) }); load(); } catch (er) { setErr(errText(er)); } }
  async function avatar(b, file) {
    if (!file) return;
    warnImage(file, 'botAvatar', !!inst);
    const fd = new FormData(); fd.append('file', file);
    try { await uploadFetch(`/chat/bots/${bid(b)}/avatar`, fd, o); } catch { setErr("That picture didn't upload."); }
    load();
  }
  async function reset(b) {
    if (inst && !(await confirmBox(`Make a new token for ${b.username}? The old one stops working and its gateway connections close.`, { confirm: 'New token' }))) return;
    try { const d = await apiFetch(`/chat/bots/${bid(b)}/token`, { ...o, method: 'POST' }); setToken({ id: b.id, token: d.token }); } catch (er) { setErr(errText(er)); }
  }
  async function addHere(b) { try { await apiFetch(`/chat/bots/by-name/${encodeURIComponent(b.username)}/add`, { ...o, method: 'POST', body: JSON.stringify({ sid }) }); load(); } catch (er) { setErr(errText(er)); } }
  async function del(b) {
    if (!(await confirmBox(`Delete ${b.username}? It leaves every server and its token stops working.`, { confirm: 'Delete bot', danger: true }))) return;
    try { await apiFetch(`/chat/bots/${bid(b)}`, { ...o, method: 'DELETE' }); load(); } catch (er) { setErr(errText(er)); }
  }
  const body = (
      <div className={inst ? 'bm-wrap' : 'card-body bm-wrap'}>
        <p className="bm-intro">{inst ? "Bot accounts that live on this server. They show up as members with a BOT tag and can't be messaged directly. Add one to the server, then give it roles like anyone else. The API works like Discord's, so most Discord bot code works with a few changes." : "Make bot accounts for Ember. They show up as members with a BOT tag, can't be messaged directly, and once a bot is approved in the gallery, anyone can add it to their server from Discover or its profile. The API works like Discord's, so most Discord bot code works with a few changes."}</p>
        <div className="bm-api">
          <div><BookOpen size={14} /> <b>REST</b> <code>{api}</code></div>
          <div><b>Gateway</b> <code>{gateway}</code></div>
          <div><b>Auth</b> <code>Authorization: Bot &lt;token&gt;</code> - events: READY, GUILD_CREATE, MESSAGE_CREATE / UPDATE / DELETE, GUILD_MEMBER_ADD / REMOVE</div>
        </div>
        {inst ? (
          <div className="vc-note bm-note">
            <Info size={14} />
            <span><b>Server-only bots.</b> Bots you make here belong to this server only. They are mostly handy if you would rather not use Nookara services. Want a bot that works in any server, can be added by anyone and can be listed in Discover? Make it in Settings &gt; Developer &gt; Bots instead.</span>
            <button type="button" className="btn btn-surface btn-sm" onClick={() => dispatchEvent(new CustomEvent("vc-dialog", { detail: { kind: "chat-settings", page: "Bots" } }))}><Bot size={13} /> Open Developer &gt; Bots</button>
          </div>
        ) : (
          <div className="vc-note bm-note">
            <Info size={14} />
            <span>Bots made here work in any server and can be submitted to the Discover listing. Bots made in a server&apos;s own settings are server-only.</span>
          </div>
        )}
        {inst && !plan.gate && <div className="bf-pg-head"><PlanUsage what="bots" used={list ? list.length : undefined} /></div>}
        {inst && <PlanNotice block={plan.full} />}
        {err && <div className="inline-msg error">{err}</div>}
        {token && (
          <div className="bm-token">
            <KeyRound size={16} />
            <div className="grow"><b>Your bot's token - copy it now, it won't be shown again.</b><code>{token.token}</code></div>
            <button type="button" className="btn btn-surface btn-sm" onClick={() => copy(token.token, 'tok')}>{copied === 'tok' ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
            <button type="button" className="btn btn-surface btn-sm" onClick={() => setToken(null)}>Done</button>
          </div>
        )}
        {list === null && !err && <div>Loading...</div>}
        {list?.length > 0 && <small className="vc-hint vc-img-hint">Bot pictures: {imgHint('botAvatar', !!inst)}</small>}
        <div className="bm-list">
          {list?.map(b => (
            <div className="bm-bot" key={b.id}>
              <label className="bm-av" title="Change picture">
                {b.pfp ? <img src={b.pfp} alt="" /> : <Bot size={22} />}
                <span><Upload size={13} /></span>
                <input type="file" hidden accept={pictureAccept('image/*')} onChange={e => avatar(b, e.target.files[0])} />
              </label>
              <div className="bm-main">
                <div className="bm-name"><b>{b.username}</b> <BotTag small verified={!!b.verified} />{inst && <small>{b.servers ? 'In the server' : 'Not in the server yet'}</small>}</div>
                <input className="form-input" maxLength={300} defaultValue={b.description} placeholder="What does it do?" onBlur={e => e.target.value !== b.description && patch(b, { description: e.target.value })} />
                <div className="bm-actions">
                  <span className="grow" />
                  {!inst && <AddBotButton username={b.username} info={{ bot: { id: b.id, username: b.username, mine: true, public: !!b.verified } }} className="btn btn-primary btn-sm" />}
                  {inst && sid && !b.servers && <button type="button" className="btn btn-primary btn-sm" onClick={() => addHere(b)}><Plus size={13} /> Add to server</button>}
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => copy(b.id, b.id)}>{copied === b.id ? <Check size={13} /> : <ServerCog size={13} />} ID {b.id}</button>
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => reset(b)}><RefreshCw size={13} /> New token</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => del(b)}><Trash2 size={13} /> Delete</button>
                </div>
                {!inst && <BotGallerySection bot={b} errText={errText} onChange={load} />}
              </div>
            </div>
          ))}
        </div>
        {inst && sid && <CommandAccess sid={sid} />}
        <form className="bm-new" onSubmit={create}>
          <input className="form-input" maxLength={32} placeholder="Bot name" value={name} onChange={e => setName(e.target.value)} />
          <input className="form-input grow" maxLength={300} placeholder="What does it do? (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || (inst && (!!plan.full || !!plan.gate))}><Plus size={14} /> Create bot</button>
        </form>
      </div>
  );
  if (inst) return <PlanGate block={plan.gate}>{body}</PlanGate>;
  return (
    <div className="card vl-rise">
      <div className="card-header"><span className="card-title">Bots</span></div>
      {body}
    </div>
  );
}
