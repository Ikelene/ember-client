import { siteHref } from './hosts.js';
// Discord / Fluxer / Matrix: import a server into Ember (Create a server > Import; or, for a new instance, a Nookara import
// bundle - a Matrix space comes over with the instance's own bot instead),
// and the Bridge tab in Server settings (Nookara's bot for Nookara-hosted servers, the instance owner's own bot on an instance).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, RefreshCw, Link2, Unlink, Volume2, Hash, Lock, EyeOff, Smile, Shield, Image as ImageIcon, ArrowLeftRight, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../api.js';
import { go, loadServers, refreshServer, toast, errorText, ask, useChat } from './store.js';
import { Dialog, ServerCreationNotice } from './Dialogs.jsx';
import serverCreationPolicy from '../server-creation-policy.json';
import { Toggle } from './roles.jsx';
import { PlatformIcon } from './platforms.jsx';
import { instOpt, bare } from './ids.js';
import { openHomeserverSettings } from './homeservers.js';
// bridge links name channels by the server's own id; Ember keeps an Ember server's ids as origin|id (ids.js)
const sameCh = (a, b) => String(bare(a)) === String(bare(b));
import { PlanGate, PlanNotice } from './PlanGate.jsx';
import { usePlan, planOf } from './plans.js';
import { EMBER_API, INST_IMPORT_NOOKARA, legacyToNew } from '../compat.js';

const ERR = {
  not_linked: 'Link that account to Nookara first (Account > Security > Connected accounts).',
  bot_not_in_server: "The Nookara bot isn't in that server - add it first.",
  not_your_server: 'You need to own that server, or have Administrator / Manage server there.',
  bridge_not_set_up: "That platform isn't set up on Nookara yet.",
  pick_a_channel: 'Pick at least one channel.',
  too_many_servers: "You already own as many servers as you can.",
  import_running: 'An import is already running - give it a moment.',
  bot_needs_webhooks: 'The Nookara bot needs the Manage webhooks permission in that channel.',
  already_linked: 'That channel is already bridged to another Ember channel.',
  already_bridged: 'This server already has a bridge for that platform.',
  text_channels_only: 'Only text channels can be bridged.',
  voice_channels_only: 'A voice channel can only be linked to a voice channel.',
};
// an instance's bridge runs on its owner's own bot, not Nookara's
const INST_ERR = {
  bot_not_in_server: "Your bot isn't in that server - add it first.", bridge_not_set_up: "That platform's bot isn't set up on this homeserver yet - its admins add bridge bots in Settings > Homeservers.",
  bot_needs_webhooks: 'Your bot needs the Manage webhooks permission in that channel.', unreachable: "Can't reach the platform right now.",
  room_encrypted: "That room is encrypted, so the bot can't read or post there. Only rooms without encryption can be bridged.",
  channel_not_found: "The bot isn't in that room any more.", platform_unreachable: "Can't reach the platform right now.",
};
// Matrix has rooms, not servers with channels: no # in front of a name, no webhooks
const roomy = p => p === 'matrix';
const why = (e, inst) => (inst && INST_ERR[e?.message]) || ERR[e?.message] || errorText(e?.message);
// a Matrix space, imported by the instance itself with a bot account its admin brings
const MX_ERR = {
  invalid_token: "That access token didn't work on that homeserver.", invalid_homeserver: "That homeserver address can't be used - it has to be a public https address.",
  platform_unreachable: "Can't reach that homeserver right now.", bridge_not_set_up: 'Add the bot again - it was forgotten after half an hour.',
  bot_not_in_server: "The bot isn't in that space any more.", pick_a_channel: 'Pick at least one room.', import_running: 'An import is already running - give it a moment.',
  community_exists: 'This server already has its community.', forbidden: "Only this server's admins can import.", not_allowed: "Only this server's admins can import.",
};
const IMPORT_ERR = { not_linked: 'Link that account to Nookara first (Account > Security > Connected accounts).', bot_not_in_server: "Nookara's bot isn't in that server - add it first.", not_your_server: 'You need to own that server, or have Administrator / Manage server there.', import_running: 'An import is already running - give it a moment.', invalid_instance: "Nookara can't make an import for this server's address.", ticket_invalid: 'That import is gone - run it again.', ticket_expired: 'That import ran out - run it again.', ticket_wrong_instance: 'That import was made for another server.', import_failed: "Nookara couldn't build the import - try again.", nookara_not_registered: "This server isn't registered with Nookara yet - try again in a minute.", nookara_off: 'This server has its Nookara connection turned off.', community_exists: 'This server already has its community.' };

function useLoad(url, deps, inst) {
  const [v, setV] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    setV(x => ({ ...x, loading: true, error: null }));
    apiFetch(url, { inst }).then(data => live && setV({ data, error: null, loading: false })).catch(error => live && setV({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [url, n, inst, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, () => setN(x => x + 1)];
}
const Loading = () => <div className="vc-loading"><i /><i /><i /></div>;

// step 1 + 2 (shared with the Bridge tab): pick Discord or Fluxer, add the bot, pick one of your servers there.
// inst: an instance's bridge (its owner's bot: no linked account, every server the bot is in); base: where the routes are
// ('/chat/bridge' = Nookara-hosted bridge / import, `${EMBER_API}/import` = a Nookara import bundle for an instance)
// extra: more tiles next to the platforms ([{ id, name, sub, onClick }]); they stay when the platforms themselves can't be listed
function GuildPicker({ onPick, pickLabel = 'Choose', exclude = [], inst, base = '/chat/bridge', extra = [], errorNote }) {
  const [plats] = useLoad(`${base}/platforms`, [], inst);
  const [p, setP] = useState(null);
  const plat = plats.data?.platforms.find(x => x.id === p);
  const [guilds, reload] = useLoad(plat?.linked ? `${base}/${p}/guilds` : null, [p], inst);
  if (plats.loading) return <Loading />;
  if (plats.error && !extra.length) return <div className="vc-empty-note">{why(plats.error, inst)}</div>;
  if (!p) {
    return (
      <>
        <div className="vc-br-plats">
          {(plats.data?.platforms || []).filter(x => !exclude.includes(x.id)).map(x => (
            <button type="button" key={x.id} className="vc-br-plat" disabled={!x.ready} onClick={() => setP(x.id)}>
              <PlatformIcon p={x.id} size={30} />
              <b>{x.name}</b>
              <small>{!x.ready ? (inst ? 'No bot set up yet' : `Nookara's ${x.name} bot isn't configured on this Nookara`) : inst ? `Bot: ${x.bot || 'ready'}` : x.linked ? 'Your account is linked' : 'Link your account first'}</small>
            </button>
          ))}
          {extra.map(x => (
            <button type="button" key={x.id} className="vc-br-plat" onClick={x.onClick}>
              <PlatformIcon p={x.id} size={30} />
              <b>{x.name}</b>
              <small>{x.sub}</small>
            </button>
          ))}
        </div>
        {plats.error && <div className="vc-empty-note">{errorNote || why(plats.error, inst)}</div>}
      </>
    );
  }
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={() => setP(null)}><ArrowLeft size={14} /> <PlatformIcon p={p} size={14} /> {plat?.name}</button>
      {plat?.rooms ? (
        <>
          <div className="vc-br-note">
            <p><b>1.</b> In {plat.name}, invite <b>{plat.bot}</b> (this server's bot) to each room you want to bridge. It joins on its own. Rooms with encryption turned on can't be bridged: the bot can't read them.</p>
          </div>
          <div className="vc-br-note">
            <div className="vc-row"><p className="grow"><b>2.</b> Link {plat.name}, then pick a room for each channel in the channel's own settings (Edit channel &gt; Bridge).</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(p, { id: 'rooms', name: plat.bot }, plat)}>{pickLabel}</button></div>
          </div>
        </>
      ) : !plat?.linked ? (
        <div className="vc-br-note">
          <p>Link your {plat?.name} account to Nookara so Ember can check which servers are yours.</p>
          <div className="vc-row"><a className="btn btn-primary" href={siteHref("/me#settings/security")} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Connected accounts</a>
            <button type="button" className="btn btn-surface" onClick={() => location.reload()}><RefreshCw size={14} /> I've linked it</button></div>
        </div>
      ) : (
        <>
          <div className="vc-br-note">
            <p><b>1.</b> Add <b>{plat.bot}</b> ({inst ? "this server's bot" : "Nookara's bot"}) to your {plat.name} server. It reads the server and carries messages across.</p>
            <a className="btn btn-surface" href={plat.invite} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Add {plat.bot} to a server</a>
          </div>
          <div className="vc-br-note">
            <div className="vc-row"><p className="grow"><b>2.</b> Pick the server. {inst ? 'Every server the bot is in shows here.' : 'Only ones you own or manage, with the bot in them, show here.'}</p>
              <button type="button" className="btn btn-surface btn-sm" onClick={reload}><RefreshCw size={13} /> Refresh</button></div>
            {guilds.loading && <Loading />}
            {guilds.error && <div className="vc-empty-note">{base === `${EMBER_API}/import` ? IMPORT_ERR[legacyToNew(guilds.error.message)] || why(guilds.error) : why(guilds.error, inst)}</div>}
            {guilds.data && !guilds.data.guilds.length && <div className="vc-empty-note">None yet - add the bot, then press Refresh.</div>}
            <div className="vc-br-guilds">
              {guilds.data?.guilds.map(g => (
                <div key={g.id} className="vc-br-guild">
                  <span className="vc-srv-ico">{g.icon ? <img src={g.icon} alt="" /> : g.name.slice(0, 2)}</span>
                  <b>{g.name}</b><span className="grow" />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(p, g, plat)}>{pickLabel}</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── import ──
export function ImportServer(props) {
  return serverCreationPolicy.creationEnabled ? <ImportServerForm {...props} /> : <ServerCreationNotice {...props} />;
}
function ImportServerForm({ onClose }) {
  const [pick, setPick] = useState(null); // { p, g, plat }
  return (
    <Dialog title="Import a server" sub="Copy a Discord or Fluxer server's channels, roles and emojis into a new Ember server - and keep them talking to each other if you like." onClose={onClose} wide className="vc-br">
      {close => (pick ? <ImportPicker {...pick} back={() => setPick(null)} close={close} onImport={async ({ name, channels, roles, opts }) => {
        const r = await apiFetch(`/chat/bridge/${pick.p}/guilds/${pick.g.id}/import`, { method: 'POST', body: JSON.stringify({ name, channels, roles, ...opts }) });
        await loadServers(); await refreshServer(r.sid);
        toast(`Imported ${r.channels} channels, ${r.roles} roles and ${r.emojis} emojis${r.bridged ? ` - ${r.bridged} channels bridged` : ''}.`, true);
        close(); go({ kind: 'server', sid: r.sid });
      }} />
        : <GuildPicker pickLabel="Import" onPick={(p, g, plat) => setPick({ p, g, plat })} />)}
    </Dialog>
  );
}
// the channel / role / extras picker; onImport({ name, channels, roles, opts }) does the import (throws to show an error).
// base: where the preview comes from; bridge: offer "keep them talking" (only Nookara-hosted servers bridge with Nookara's bot)
// inst: the preview comes from that instance (a Matrix space); errs: its own words for what can go wrong
function ImportPicker({ p, g, plat, back, close, onImport, base = '/chat/bridge', bridge = true, label = 'Import server', inst, errs }) {
  const [pv] = useLoad(`${base}/${p}/guilds/${encodeURIComponent(g.id)}`, [], inst);
  const rooms = roomy(p);
  const [name, setName] = useState(g.loose ? '' : g.name);
  const [chans, setChans] = useState(null);
  const [roles, setRoles] = useState(null);
  const [opts, setOpts] = useState({ icon: true, banner: true, emojis: true, ...(bridge ? { bridge: true } : {}) });
  const [busy, setBusy] = useState(false);
  const d = pv.data;
  useEffect(() => {
    if (!d) return;
    // public channels on by default; private ones would be visible to everyone here, so they start off
    setChans(new Set(d.groups.flatMap(x => x.channels).filter(c => c.kind).map(c => c.id)));
    setRoles(new Set(d.roles.map(r => r.id)));
  }, [d]);
  const count = chans?.size || 0;
  const flip = (set, setter, id) => setter(old => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function go2() {
    setBusy(true);
    try { await onImport({ name, channels: [...chans], roles: [...roles], opts }); }
    catch (e) { toast(say(e)); setBusy(false); }
  }
  const say = e => errs?.[e?.message] || (!bridge && IMPORT_ERR[legacyToNew(e?.message)]) || why(e, inst);
  const canBridge = bridge && d?.can_bridge !== false;
  if (pv.loading) return <Loading />;
  if (pv.error) return <div className="vc-br-step"><button type="button" className="vc-br-back" onClick={back}><ArrowLeft size={14} /> Back</button><div className="vc-empty-note">{say(pv.error)}</div></div>;
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={back}><ArrowLeft size={14} /> <PlatformIcon p={p} size={14} /> {plat.name}: {g.name}</button>
      <label className="vc-field"><span>Ember server name</span><input className="form-input" maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="vc-br-cols">
        <div className="vc-br-col">
          <div className="vc-br-head"><b>{rooms ? 'Rooms' : 'Channels'}</b><small>{count} picked{count > 60 ? ' - only the first 60 fit' : ''}</small></div>
          <div className="vc-br-list">
            {d.groups.map(grp => (
              <div key={grp.id || 'none'} className="vc-br-group">
                <div className="vc-br-cat">{grp.name}</div>
                {grp.channels.map(c => (
                  <label key={c.id} className={`vc-br-item${c.kind ? '' : ' off'}`} title={c.skip || (c.private ? `${rooms ? 'Invite-only' : 'Private'} on ${plat.name} - stays private on Ember (for the roles you import)` : undefined)}>
                    <input type="checkbox" disabled={!c.kind} checked={!!chans?.has(c.id)} onChange={() => flip(chans, setChans, c.id)} />
                    {c.kind === 'voice' ? <Volume2 size={14} /> : <Hash size={14} />}
                    <span className="grow">{c.name}</span>
                    {c.private && <EyeOff size={13} className="vc-br-flag" />}
                    {c.locked && c.kind === 'text' && <Lock size={13} className="vc-br-flag" />}
                    {!c.kind && <small>not supported</small>}
                  </label>
                ))}
              </div>
            ))}
          </div>
          {!d.groups.length && <div className="vc-empty-note">The bot can't see any rooms here. Invite it to them, then go back and press Refresh.</div>}
          <small className="vc-hint">{rooms ? 'Each room becomes a channel, and a space inside the space becomes a category. Invite-only rooms come over private: only the roles you import see them. Rooms where only moderators can write come over as locked.' : 'Private channels keep their per-role permissions (see / send / attach) for the roles you import. Read-only channels come over as locked.'}</small>
        </div>
        <div className="vc-br-col">
          <div className="vc-br-head"><b>Roles</b><small>{roles?.size || 0} of {d.roles.length}</small></div>
          <div className="vc-br-list short">
            {d.roles.map(r => (
              <label key={r.id} className="vc-br-item">
                <input type="checkbox" checked={!!roles?.has(r.id)} onChange={() => flip(roles, setRoles, r.id)} />
                <i className="vc-br-dot" style={{ background: r.color || 'var(--muted)' }} />
                <span className="grow">{r.name}</span>{r.admin && <Shield size={13} className="vc-br-flag" />}
              </label>
            ))}
            {!d.roles.length && <div className="vc-empty-note">No roles.</div>}
          </div>
          <small className="vc-hint">{rooms ? "Matrix has power levels, not roles: these two stand in for its admins and moderators. Nobody has them yet - you give them out once people join." : 'Roles keep their colours and permissions. Nobody has them yet - people get roles once they join.'}</small>
          <div className="vc-br-head"><b>Also bring</b></div>
          <div className="vc-br-extras">
            {(d.guild.icon || d.guild.has_icon) && <label className="vc-br-item"><input type="checkbox" checked={opts.icon} onChange={e => setOpts(o => ({ ...o, icon: e.target.checked }))} /><ImageIcon size={14} /> {rooms ? "The space's picture" : 'Server icon'}</label>}
            {d.guild.banner && <label className="vc-br-item"><input type="checkbox" checked={opts.banner} onChange={e => setOpts(o => ({ ...o, banner: e.target.checked }))} /><ImageIcon size={14} /> Banner</label>}
            {d.emojis.length > 0 && <label className="vc-br-item"><input type="checkbox" checked={opts.emojis} onChange={e => setOpts(o => ({ ...o, emojis: e.target.checked }))} /><Smile size={14} /> {d.emojis.length} custom emoji{d.emojis.length === 1 ? '' : 's'}{d.emojis.some(e => e.animated) ? `, including ${d.emojis.filter(e => e.animated).length} animated` : ''}{d.emoji_total > d.emojis.length ? ` (first ${d.emojis.length} of ${d.emoji_total})` : ''}</label>}
          </div>
          {opts.emojis && d.emojis.some(e => e.url) && <div className="vc-br-emojis">{d.emojis.filter(e => e.url).slice(0, 24).map(e => <img key={e.id} src={e.url} alt={e.name} title={`:${e.name}:${e.animated ? ' (animated)' : ''}`} loading="lazy" />)}</div>}
        </div>
      </div>
      {canBridge && <Toggle label={`Bridge it with ${plat.name}`} hint={rooms ? `Messages go both ways between each imported channel and its room, through ${plat.bot || 'the bot'}. Rooms with encryption turned on are left out. You can change or turn this off in Server settings > Bridge.` : `Messages in the imported text channels go both ways between Ember and ${g.name}. You can change or turn this off in Server settings > Bridge.`} on={opts.bridge} onChange={v => setOpts(o => ({ ...o, bridge: v }))} />}
      <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !count || !name.trim()} onClick={go2}>{busy ? 'Importing...' : label}</button></div>
    </div>
  );
}

// ── Server settings > Bridge ──
export function BridgeSettings({ sid, gated, onPlan }) {
  const inst = instOpt(sid);
  const plan = usePlan('bridges');
  const [st, reload] = useLoad(gated || plan.gate ? null : `/chat/bridge/servers/${sid}`, [sid, !!gated || !!plan.gate]);
  const channels = useChat(s => s.detail[sid]?.channels);
  const instBridges = useChat(s => (inst ? s.instances?.find(i => i.origin === inst)?.features?.bridges : null));
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState('');
  const text = useMemo(() => (channels || []).filter(c => (c.type || 'text') === 'text' || c.type === 'voice'), [channels]);
  const call = async (key, fn) => { setBusy(key); try { await fn(); reload(); refreshServer(sid); return true; } catch (e) { if (!plan.catchPlan(e)) toast(why(e, inst)); return false; } finally { setBusy(''); } };
  const block = plan.gate || (st.error && planOf(st.error) ? { ...planOf(st.error), what: 'bridges' } : null); // (the plan has no bridges)
  useEffect(() => { if (block && !gated) onPlan?.(block); }, [!!block, !!gated]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!block && !gated) {
    if (st.loading && !st.data) return <Loading />;
    if (st.error) return <div className="vc-empty-note">{why(st.error, inst)}</div>;
  }
  const bridges = st.data?.bridges || [];
  const matrix = !!inst && !!instBridges && 'matrix' in instBridges; // (an Ember server new enough to have the Matrix bridge)
  const available = ['discord', 'fluxer', ...(matrix ? ['matrix'] : [])].filter(p => !bridges.some(b => b.platform === p));
  return (
    <PlanGate block={gated ? null : block}>
    <div className="vc-br-settings">
      <PlanNotice block={plan.full} />
      {bridges.map(b => (
        <div key={b.platform}>
          <div className="vc-br-top">
            <PlatformIcon p={b.platform} size={28} />
            <div><b>{b.platform_name}: {b.guild_name}</b><small>{b.links.length} channel{b.links.length === 1 ? '' : 's'} bridged{roomy(b.platform) ? ` - ${b.ext_channels.length} room${b.ext_channels.length === 1 ? '' : 's'} the bot is in` : ''}</small></div>
            <span className="grow" />
            <button type="button" className="btn btn-danger btn-sm" disabled={!!busy} onClick={async () => {
              if (await ask({ title: `Unlink ${roomy(b.platform) ? b.platform_name : b.guild_name}?`, text: roomy(b.platform) ? `Messages stop going between Ember and ${b.platform_name}. The bot stays in its rooms, and messages already sent stay.` : `Messages stop going between Ember and ${b.platform_name}, and the bridge webhooks over there are removed. Messages already sent stay.`, confirm: 'Unlink', danger: true })) call(`unlink-${b.platform}`, () => apiFetch(`/chat/bridge/servers/${sid}`, { method: 'DELETE', body: JSON.stringify({ platform: b.platform }) }));
            }}><Unlink size={14} /> Unlink</button>
          </div>
          {b.problem && <div className="vc-br-warn">{b.problem === 'bot_not_in_server' ? `${inst ? 'Your' : 'The Nookara'} bot isn't in ${b.guild_name} any more - add it back to keep the bridge working.` : b.problem === 'bridge_not_set_up' ? INST_ERR.bridge_not_set_up : `Can't reach ${b.platform_name} right now.`}</div>}
          <Toggle label={`${b.platform_name} bridge on`} hint="Turn it off to pause it without losing the channel links." on={b.enabled} disabled={!!busy} onChange={v => call(`on-${b.platform}`, () => apiFetch(`/chat/bridge/servers/${sid}`, { method: 'PATCH', body: JSON.stringify({ platform: b.platform, enabled: v }) }))} />
          <div className="vc-br-head"><b>Linked channels</b><small>Link each channel from its own settings (Edit channel &gt; Bridge)</small></div>
          <div className="vc-br-map">
            {text.filter(c => b.links.some(l => sameCh(l.cid, c.cid))).map(c => {
              const l = b.links.find(x => sameCh(x.cid, c.cid));
              const voice = c.type === 'voice';
              return <div key={c.cid} className="vc-br-row ro">
                <span className="vc-br-ch">{voice ? <Volume2 size={14} /> : <Hash size={14} />} {c.name}</span>
                <ArrowLeftRight size={14} className="vc-br-arrow on" />
                <span className="vc-br-ch"><PlatformIcon p={b.platform} size={14} /> {voice || roomy(b.platform) ? '' : '#'}{l.ext_name || 'channel'}</span>
                {voice || roomy(b.platform) ? <Check size={14} className="vc-br-ok" /> : l.hook ? <Check size={14} className="vc-br-ok" /> : <small className="vc-br-flag" title="The bot couldn't make a webhook there yet - it needs Manage webhooks">no webhook</small>}
              </div>;
            })}
            {!b.links.length && <div className="vc-empty-note">No channels linked yet. Open a text channel's settings and pick a {b.platform_name} {roomy(b.platform) ? 'room' : 'channel'} under Bridge.{roomy(b.platform) && !b.ext_channels.length ? ` The bot isn't in any room yet: invite ${b.guild_name} to one.` : ''}</div>}
          </div>
        </div>
      ))}
      {inst && !gated && !block && <BotHint inst={inst} available={available} />}
      {linking ? <>
        <button type="button" className="vc-br-back" onClick={() => setLinking(false)}><ArrowLeft size={14} /> Back</button>
        <GuildPicker pickLabel="Link" inst={inst} exclude={bridges.map(b => b.platform)} onPick={async (p, g) => {
          if (await call('link', () => apiFetch(`/chat/bridge/servers/${sid}`, { method: 'PUT', body: JSON.stringify({ platform: p, guild_id: g.id, automap: false }) }))) setLinking(false);
        }} />
      </> : available.length > 0 && <div className="vc-br-empty">
        <ArrowLeftRight size={28} />
        <b>{bridges.length ? 'Link another server' : `Bridge this server with Discord${matrix ? ', Fluxer or Matrix' : ' or Fluxer'}`}</b>
        <p>Link a Discord server, a Fluxer server{matrix ? ', Matrix rooms,' : ''} or {matrix ? 'all of them' : 'both'}. Pick which channels talk to each other in each channel's settings. Messages, replies, edits and deletes go both ways.{inst ? " It bridges with its homeserver's own bots." : ''}</p>
        <button type="button" className="btn btn-primary" onClick={() => setLinking(true)}><Link2 size={14} /> Link a server</button>
      </div>}
    </div>
    </PlanGate>
  );
}

// the homeserver's bots bridge every server on it: a platform without one yet points at where its admins add it
function BotHint({ inst, available }) {
  const admin = useChat(s => !!s.instances?.find(i => i.origin === inst)?.isAdmin);
  const [plats] = useLoad('/chat/bridge/platforms', [], inst);
  const missing = (plats.data?.platforms || []).filter(p => !p.ready && available.includes(p.id)).map(p => p.name);
  if (!missing.length) return null;
  const names = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}` : missing[0];
  return (
    <div className="vc-br-note vc-br-nobot">
      <p><TriangleAlert size={14} className="vc-inline-ico" /> No {names} bot yet. Your homeserver's admins add bridge bots in Settings › Homeservers.</p>
      {admin && <button type="button" className="btn btn-surface btn-sm" onClick={() => openHomeserverSettings(inst, 'bridges')}><ArrowLeftRight size={13} /> Open bridge bots</button>}
    </div>
  );
}

// Channel settings: which channel over there this one talks to (once the server is linked in Server settings > Bridge)
export function ChannelBridge({ sid, channel }) {
  const [st, reload] = useLoad(`/chat/bridge/servers/${sid}`, [sid]);
  const [busy, setBusy] = useState(false);
  if (st.loading && !st.data) return null;
  if (st.error) return null; // not allowed to manage the bridge
  // a voice channel: Discord voice channels only (everyone over there shows up here as themselves, the bot carries the sound)
  const voice = channel.type === 'voice';
  const bridges = (st.data?.bridges || []).filter(b => !voice || b.platform === 'discord');
  const names = [...new Set(['Discord', 'Fluxer', ...(st.data?.bridges || []).map(b => b.platform_name)])].filter(Boolean);
  const fits = x => (voice ? x.kind === 'voice' : x.kind !== 'voice');
  if (voice && st.data?.voice_links === false) return <div className="vc-field"><span>Bridge</span><small className="vc-hint">This server can't link voice channels: its voice bridge parts aren't installed.</small></div>;
  return (
    <div className="vc-field"><span>Bridge</span>
      {!bridges.length ? (
        <div className="vc-br-chnote">
          <small>{voice ? 'Link this server to a Discord server first, then pick a Discord voice channel here.' : `Link this server to ${names.length > 2 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : 'a Discord or Fluxer server'} first, then pick a channel here.`}</small>
          <button type="button" className="btn btn-surface btn-sm" onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'settings', sid, tab: 'bridge' } }))}><Link2 size={13} /> Link a server</button>
        </div>
      ) : bridges.map(b => {
        const l = b.links.find(x => sameCh(x.cid, channel.cid));
        return <div key={b.platform}>
          <div className="vc-row"><PlatformIcon p={b.platform} size={16} />
            <select className="form-input" aria-label={`${b.platform_name} channel`} value={l?.ext_channel_id || ''} disabled={busy} onChange={async e => {
              setBusy(true);
              try { await apiFetch(`/chat/bridge/servers/${sid}/channels/${channel.cid}`, { method: 'PUT', body: JSON.stringify({ platform: b.platform, ext_channel_id: e.target.value || null }) }); reload(); refreshServer(sid); }
              catch (er) { toast(why(er, instOpt(sid))); }
              setBusy(false);
            }}>
              <option value="">Not bridged</option>
              {b.ext_channels.filter(fits).map(x => <option key={x.id} value={x.id} disabled={!!x.encrypted}>{voice || roomy(b.platform) ? '' : '#'}{x.name}{x.category ? ` (${x.category})` : ''}{x.encrypted ? " (encrypted - can't be bridged)" : ''}</option>)}
            </select>
          </div>
          <small className="vc-hint"><PlatformIcon p={b.platform} size={12} /> {voice
            ? (l ? `People in ${b.platform_name} ${l.ext_name} (${b.guild_name}) show up here as themselves, and while someone is in here the ${b.platform_name} bot joins over there so they hear everyone.` : `Pick a voice channel in ${b.guild_name} to bridge with ${b.platform_name}.`)
            : roomy(b.platform) ? (l ? `Messages here and in the ${b.platform_name} room ${l.ext_name} go both ways. Over there, ${b.guild_name} posts them with the sender's name in front.` : `Pick a ${b.platform_name} room. Only rooms ${b.guild_name} is in show here: invite it to a room to add one.`)
            : (l ? `Messages here and in ${b.platform_name} #${l.ext_name} (${b.guild_name}) go both ways.` : `Pick a channel in ${b.guild_name} to bridge with ${b.platform_name}.`)}{!b.enabled ? ' The bridge is paused in Server settings.' : ''}</small>
        </div>;
      })}
    </div>
  );
}

// ── a new instance's community from a Discord / Fluxer server (setup wizard): Nookara's bot builds a bundle (channels, roles,
// emojis - no members or messages) with the signed-in Nookara account; the instance downloads it with a one-time ticket.
// A Matrix space is read by the instance itself, with a bot account its admin gives it (MatrixImport) ──
const STAGES = { queued: 'Waiting to start...', running: 'Copying the server...', done: 'Bringing it over...' };
export function NookaraImport({ origin, onDone, onCancel }) {
  const [pick, setPick] = useState(null); // { p, g, plat }
  const [job, setJob] = useState(null); // { job_id, ticket }
  const [matrix, setMatrix] = useState(false);
  if (matrix) return <MatrixImport origin={origin} onDone={onDone} onCancel={() => setMatrix(false)} />;
  if (job) return <ImportProgress origin={origin} job={job} onDone={onDone} onBack={() => { setJob(null); setPick(null); }} />;
  if (pick) {
    return (
      <ImportPicker {...pick} base={`${EMBER_API}/import`} bridge={false} label="Import" back={() => setPick(null)} close={onCancel} onImport={async ({ name, channels, roles, opts }) => {
        setJob(await apiFetch(`${EMBER_API}/import`, { method: 'POST', body: JSON.stringify({ platform: pick.p, guild_id: pick.g.id, channels, roles, options: { name, ...opts }, instance: origin }) }));
      }} />
    );
  }
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={onCancel}><ArrowLeft size={14} /> Back</button>
      <p className="vc-dialog-sub">Nookara copies the server's channels, categories, roles and emojis into this one with its own bot. Members and messages stay where they are. You need your Discord / Fluxer account linked to Nookara, Nookara's bot in that server, and to own or manage it there. A Matrix space comes over with a bot account of your own instead.</p>
      <GuildPicker base={`${EMBER_API}/import`} pickLabel="Import" onPick={(p, g, plat) => setPick({ p, g, plat })} errorNote="Sign in with Nookara to import from Discord or Fluxer."
        extra={[{ id: 'matrix', name: 'Matrix', sub: 'With a bot account you bring', onClick: () => setMatrix(true) }]} />
    </div>
  );
}
// Matrix: give the server a bot (homeserver + access token, kept for half an hour unless the rooms get bridged), invite it
// to the space, pick the space, then the usual picker
function MatrixImport({ origin, onDone, onCancel }) {
  const [info] = useLoad('/api/v1/import/matrix', [], origin);
  const [given, setGiven] = useState(null); // the server's answer once a bot was given here
  const [form, setForm] = useState(false);
  const [f, setF] = useState({ homeserver: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState({ loading: false, data: null, error: null });
  const [pick, setPick] = useState(null); // { g, plat }
  const st = given || info.data;
  const load = fresh => {
    setList(x => ({ ...x, loading: true, error: null }));
    apiFetch(`/api/v1/import/matrix/guilds${fresh ? '?fresh=1' : ''}`, { inst: origin }).then(data => setList({ loading: false, data, error: null }), error => setList({ loading: false, data: null, error }));
  };
  useEffect(() => { if (st?.ready) load(false); }, [st?.ready, st?.bot]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      setGiven(await apiFetch('/api/v1/import/matrix/bot', { inst: origin, method: 'PUT', body: JSON.stringify({ homeserver: f.homeserver.trim(), token: f.token.trim() }) }));
      setF(x => ({ ...x, token: '' })); setForm(false);
    } catch (x) { toast(MX_ERR[x.message] || why(x, origin)); }
    setBusy(false);
  }
  const plat = { id: 'matrix', name: 'Matrix', bot: st?.bot };
  if (pick) {
    return (
      <ImportPicker p="matrix" g={pick} plat={plat} base="/api/v1/import" inst={origin} errs={MX_ERR} bridge={!!st?.can_bridge} label="Import" back={() => setPick(null)} close={onCancel} onImport={async ({ name, channels, roles, opts }) => {
        const r = await apiFetch('/api/v1/import/matrix', { inst: origin, method: 'POST', body: JSON.stringify({ guild_id: pick.id, channels, roles, name, ...opts }) });
        toast(`Imported ${r.channels} channel${r.channels === 1 ? '' : 's'}${r.emojis ? ` and ${r.emojis} emoji${r.emojis === 1 ? '' : 's'}` : ''}${r.bridged ? ` - ${r.bridged} bridged with Matrix` : ''}.`, true);
        onDone(r.sid);
      }} />
    );
  }
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={onCancel}><ArrowLeft size={14} /> <PlatformIcon p="matrix" size={14} /> Matrix</button>
      <p className="vc-dialog-sub">Copies a Matrix space into this server: its rooms become channels and the spaces inside it become categories, with its picture and custom emoji. Members and messages stay on Matrix.</p>
      {info.loading ? <Loading /> : info.error ? <div className="vc-empty-note">{MX_ERR[info.error.message] || why(info.error, origin)}</div> : !st?.ready || form ? (
        <div className="vc-br-note">
          <p><b>1.</b> Make an ordinary Matrix account for the bot on any homeserver, then paste that homeserver's address and the account's access token (in Element: Settings &gt; Help &amp; About &gt; Access Token). This server keeps the token for half an hour, or for good if you bridge the rooms.</p>
          <form className="vc-br-mx" onSubmit={save}>
            <input className="form-input" type="text" autoComplete="off" spellCheck={false} aria-label="Matrix homeserver address" placeholder="Homeserver address, e.g. https://matrix.org" value={f.homeserver} onChange={e => setF(x => ({ ...x, homeserver: e.target.value }))} />
            <div className="vc-row">
              <input className="form-input" type="password" autoComplete="off" aria-label="Matrix access token" placeholder="Access token" value={f.token} onChange={e => setF(x => ({ ...x, token: e.target.value }))} />
              {form && <button type="button" className="btn btn-surface" onClick={() => setForm(false)}>Cancel</button>}
              <button type="submit" className="btn btn-primary" disabled={busy || !f.homeserver.trim() || !f.token.trim()}>{busy ? 'Checking...' : 'Continue'}</button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="vc-br-note">
            <div className="vc-row"><p className="grow"><b>1.</b> The bot is <b>{st.bot}</b>{st.saved ? " (this server's bridge bot)" : ''}.</p>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => setForm(true)}>Use another</button></div>
          </div>
          <div className="vc-br-note">
            <p><b>2.</b> In Matrix, invite <b>{st.bot}</b> to your space, and to each room in it that is invite-only or that you want bridged. It joins on its own.</p>
          </div>
          <div className="vc-br-note">
            <div className="vc-row"><p className="grow"><b>3.</b> Pick the space. Every space the bot is in shows here.</p>
              <button type="button" className="btn btn-surface btn-sm" disabled={list.loading} onClick={() => load(true)}><RefreshCw size={13} /> Refresh</button></div>
            {list.loading && <Loading />}
            {list.error && <div className="vc-empty-note">{MX_ERR[list.error.message] || why(list.error, origin)}</div>}
            {list.data && !list.data.guilds.length && <div className="vc-empty-note">None yet - invite the bot, then press Refresh.</div>}
            <div className="vc-br-guilds">
              {list.data?.guilds.map(g => (
                <div key={g.id} className="vc-br-guild">
                  <span className="vc-srv-ico">{g.loose ? <Hash size={16} /> : g.name.slice(0, 2)}</span>
                  <b>{g.name}</b><small className="vc-hint">{g.rooms} room{g.rooms === 1 ? '' : 's'}</small>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setPick(g)}>Import</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function ImportProgress({ origin, job, onDone, onBack }) {
  const [st, setSt] = useState({ status: 'queued', progress: 0 });
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        for (let i = 0; live; i++) {
          const j = await apiFetch(`${EMBER_API}/import/${encodeURIComponent(job.job_id)}`);
          if (!live) return;
          setSt(j);
          if (j.status === 'failed') throw new Error(j.error || 'import_failed');
          if (j.status === 'done') break;
          await new Promise(r => setTimeout(r, i < 20 ? 1200 : 3000));
        }
        // the ticket goes to this instance only (Nookara bound it to its address); it fetches the bundle from Nookara itself
        for (let i = 0; live; i++) {
          try { const d = await apiFetch(INST_IMPORT_NOOKARA, { inst: origin, method: 'POST', body: JSON.stringify({ ticket: job.ticket }) }); if (live) onDone(d.sid); return; }
          catch (e) { if (e.message !== 'not_ready' || i > 20) throw e; await new Promise(r => setTimeout(r, 2000)); }
        }
      } catch (e) { if (live) setErr(IMPORT_ERR[legacyToNew(e.message)] || why(e)); }
    })();
    return () => { live = false; };
  }, [job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = st.status === 'done' ? 100 : Math.max(3, Math.min(99, Number(st.progress) || 0));
  return (
    <div className="vc-br-step">
      {err ? (
        <>
          <p className="vc-err"><TriangleAlert size={14} /> {err}</p>
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={onBack}>Try again</button></div>
        </>
      ) : (
        <div className="vc-br-note">
          <p><b>{STAGES[st.status] || 'Working...'}</b>{st.stage ? ` ${st.stage}` : ''}</p>
          <div className="vc-game-bar vc-imp-bar"><i style={{ width: `${pct}%` }} /></div>
          <p>{pct}% - keep this open until it's done.</p>
        </div>
      )}
    </div>
  );
}
