// The frame around the conversation: server rail, channel / DM sidebar, member list, your panel.
import { BotTag } from './Bots.jsx';
import { Handle } from './Handle.jsx';
import { StatusLink } from './StatusLink.jsx';
import { isDesktopApp } from './emberLogo.js';
import { VoiceChannelUsers, QuickVoiceBtns } from './VoiceParts.jsx';
import { joinVoice } from './voice.js';
import { openLinkChannel } from './channelTypes.js';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Share2, Hash, Lock, Plus, Compass, ChevronDown, Settings, UserPlus, LogOut, House, MessageCircle, Home,
  Pencil, Trash2, Check, X, Circle, Moon, MinusCircle, EyeOff, Smile, UsersRound, Megaphone, FolderPlus, ShieldCheck, Download, Server, UserRound, Volume2, CircleArrowUp, NotebookPen, Unplug, Repeat, Shield } from 'lucide-react';

import { RetryIn } from './RetryIn.jsx';
import { ServerIcon } from './ServerIcon.jsx';
import { inviteLinkFor, fullHandle, nookaraDomain } from './store.js';
import { HomeChip } from './homeLabels.jsx';
import { useServerHome } from './serverHome.js';
import { deviceAccounts, switchToAccount } from './accountSwitch.js';
import { nookaraDmRows } from './social.js';
import { SocialDmRow } from './SocialHome.jsx';
import { useName, NameText, personName, displayNameOf, useDisplayNamesVersion, wantDisplayNames, serverOwnName } from './displayNames.js';
import { useChat, retryNow, go, keyOf, setStatus, setCustom, isMuted, effectiveNotify, ask, refreshServer, toast, errorText, setDetailLayout, patchState, saveSettings, getState, statusOf, presenceFor, useFace, isBlockedPerson, isBlockedName, blockedFace, BLOCKED_NAME, loadMoreMembers, lastHomeView, bridgedTyper } from './store.js';
import { ChannelIcon, NameDecor } from './roles.jsx';
import { P, has, useNameStyle, colorFrom } from './perms.js';
import { serverMenu, instanceMenu, channelMenu, userMenu, openMenu, copy } from './menus.js';
import { apiFetch, getToken } from '../api.js';
import { NOOKARA, instOf, isInst, normOrigin, bare } from './ids.js';
import { loudUnread, needsChannelCount } from './unread.js';
import { getLook, subscribeLook } from './look.js';
import { railEntries, railPos, railOrigin } from './addresses.js';
import { homeDomainOf, openHomeserverSettings } from './homeservers.js';
import { removeInstance, reorderInstances, reconnect as reconnectInstance, disconnectInstance } from './instances.js';
import { startSignIn } from './session.js';
import { useHomeSession } from './homeSessions.js';
import { Avatar, RoleChip, BlockedMark } from './Profile.jsx';
import { subtitle, STATUS_LABEL, openProfileEditor } from './profiles.jsx';
import { hasAccountProfile, accountTarget } from './accountProfileCore.js';
import { MePopout } from './ProfilePopout.jsx';
import { PinCategoryHost } from './DmPins.jsx';
import { cleanPins, pinnedSet, dmKey, groupKey, viewKeyOf } from './dmPinsCore.js';
import { pinMenuItems, catMenuItems, pinItem, unpinItem, moveCategory } from './dmPinActions.js';
import { useHiddenServers, hideServer } from './hiddenRail.js';
import { PinItemRow } from './PinItems.jsx';
import { UnreadPills } from './UnreadPills.jsx';
// which pinned DM categories are folded (this device only)
const FOLD_KEY = 'ember:dmpins:folded';
const readFolded = () => { try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
const writeFolded = set => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* private mode */ } };
import Logo from '../components/Logo.jsx';
import { mobileBridge } from '../compat.js';

// little pictures of whoever's typing + the bouncing squares (channel / DM rows)
// (sid: a server channel - somebody I blocked there is "Blocked User" with the default picture)
function TypingMark({ names, people, sid }) {
  const show = useChat(s => s.settings.show_typing);
  const blocked = useChat(s => (sid ? names.filter(n => isBlockedName(sid, n, s)).join('\n') : ''));
  useDisplayNamesVersion(); // (the title below reads display names)
  if (!names.length || !show) return null;
  const masked = n => !!blocked && blocked.split('\n').includes(n);
  const shown = names.map(n => (masked(n) ? BLOCKED_NAME : bridgedTyper(n)?.name || displayNameOf(n) || n));
  return (
    <span className="vc-ch-typing" title={`${shown.join(', ')} ${names.length === 1 ? 'is' : 'are'} typing`}>
      <span className="vc-ch-typing-avs">{names.slice(0, 3).map(u => <Avatar key={u} user={masked(u) ? { username: BLOCKED_NAME, pfp: null } : bridgedTyper(u) ? { username: bridgedTyper(u).name, pfp: bridgedTyper(u).pfp } : { username: u, pfp: people[u]?.pfp }} size={16} />)}</span>
      <span className="vc-dots"><i /><i /><i /></span>
    </span>
  );
}

// ── the server rail ─────────────────────────────────────────────────────────
// Every server is one plain icon: Nookara-hosted ones (only while signed in with Nookara) first, then the servers on instances in
// the order of the instance list. Each group is dragged within itself. An instance icon's tooltip names the server and its address.
const localRailOrder = () => { try { const v = JSON.parse(localStorage.getItem('bf_rail_order') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export function Rail({ onDiscover, onAddInstance, onCreate, discoverOn = false }) {

  const servers = useChat(s => s.servers);
  const allInstances = useChat(s => s.instances);
  const view = useChat(s => s.view);
  // the rail is the servers this account is in: a listed instance it has no community on (e.g. left over in the list from before
  // lists were per account) stays off it, unless it is open right now (the join screen) or a join request is pending
  const instances = allInstances.filter(i => !(i.loaded && i.status === 'open' && !i.pending && !servers.some(x => x.inst === i.origin) && view.inst !== i.origin && !(view.sid && instOf(view.sid) === i.origin)));
  const unread = useChat(s => s.unread);
  const dms = useChat(s => s.dms);
  const farUnread = useChat(s => s.social.dms.some(d => d.unread)); // (DMs on other homeservers)
  const homeRequests = useChat(s => s.homeRequests || 0); // friend + message requests waiting (a red count, like a mention)
  const homeUnread = farUnread || dms.some(c => c.unread) || Object.entries(unread).some(([k, v]) => v && (k.startsWith('d:') || k.startsWith('g:')));
  const home = view.kind === 'home' || view.kind === 'dm' || view.kind === 'group' || view.kind === 'modmail' || view.kind === 'notes' || (view.kind === 'channel' && !!view.dm);
  const people = useChat(s => s.people);
  const srvMentions = useChat(s => s.srvMentions);
  // a server lights up only for unread channels I haven't muted (its own unread flag can't know my channel mutes)
  const detail = useChat(s => s.detail), chUnread = useChat(s => s.unread), unreadN = useChat(s => s.unreadN);
  const notify = useChat(s => s.notify);
  const chMuted = (cid, sid) => effectiveNotify(cid, sid).muted;
  const loudOf = srv => loudUnread(srv, { channels: detail[srv?.sid]?.channels || null, unread: chUnread, unreadN, muted: chMuted, serverMuted: !!srv && isMuted(srv.sid) });
  // can't tell yet (an older server that doesn't list its unread channels, channels not loaded): load its channels once, quiet until then
  const asked = useRef(new Set());
  useEffect(() => {
    // ...and Ember servers whose one unread total may include channels you muted: count them per channel (unread.js)
    const t = Date.now();
    const mutedIds = Object.keys(notify || {}).filter(k => (notify[k]?.muted_until || 0) > t);
    for (const srv of servers) {
      if (asked.current.has(srv.sid)) continue;
      if (loudOf(srv) === null || needsChannelCount(srv, { channels: detail[srv.sid]?.channels || null, mutedIds })) { asked.current.add(srv.sid); refreshServer(srv.sid); }
    }
  });
  const loudUnreadOf = srv => loudOf(srv) === true;
  // DMs with new messages sit in the rail under Home (with how many), like Discord / Fluxer
  const newDMs = dms.filter(c => c.unread > 0 && keyOf(view) !== `d:${c.username.toLowerCase()}`).slice(0, 6);
  const modmail = useChat(s => s.modmail);
  // drag servers to put them in your own order (Nookara's: saved to your account; instances: saved with the instance list). The state change
  // waits a tick: Chromium cancels a drag if the page changes during dragstart.
  const dragId = useRef(null);
  const [drag, setDrag] = useState(null); // { id, over, after }
  const legacy = servers.filter(x => (x.inst || NOOKARA) === NOOKARA && !x.moved_to); // (a Nookara-hosted server that moved to an Ember server is gone from the rail)
  const group = id => (id.startsWith('i:') ? 'i' : 'v');
  // one order for the whole rail, Nookara-hosted and Ember servers mixed (chat setting rail_order; local until it's saved)
  const savedOrder = useChat(s => s.settings?.rail_order);
  const railOrder = savedOrder?.length ? savedOrder : localRailOrder();
  // an instance is one entry, or (a homeserver I'm in several servers on) one per server: addresses.js railEntries
  const hidden = useHiddenServers(); // ("Hide from list": the rail entry goes, the server and its homeserver stay)
  const entries = railEntries(instances, servers).filter(e => !(e.server && hidden.has(e.server.sid))).map(e => ({ rail: e.id, inst: e.inst, server: e.server }));
  // servers on 2+ homeservers: each icon carries a small badge of its homeserver (Matrix-style "which server is this on")
  const homes = new Set([...(legacy.length ? [nookaraDomain()] : []), ...entries.map(e => homeDomainOf(e.inst, e.server))]);
  const hsBadge = homes.size > 1 ? (domain, icon) => ({ domain, icon }) : () => null;
  const idOf = x => x.rail || `v:${x.sid}`;
  const ordered = (() => {
    const all = [...legacy, ...entries];
    // (sort is stable: a homeserver's servers that share one saved place stay in their own order)
    return all.map((x, n) => { const at = railPos(railOrder, idOf(x)); return [x, at >= 0 ? at : 1000 + n]; }).sort((a, b) => a[1] - b[1]).map(([x]) => x);
  })();
  function dropOn(id, after) {
    const from = dragId.current;
    dragId.current = null; setDrag(null);
    if (!from || from === id) return;
    const list = ordered.map(idOf).filter(x => x !== from);
    const at = list.indexOf(id);
    if (at < 0) return;
    list.splice(at + (after ? 1 : 0), 0, from);
    if (getToken()) saveSettings({ rail_order: list }).catch(() => toast("Couldn't save the server order."));
    else patchState({ settings: { ...getState().settings, rail_order: list } });
    try { localStorage.setItem('bf_rail_order', JSON.stringify(list)); } catch { /* fine */ }
    // (each list's own order follows too, for older apps)
    if (group(from) === 'i' && group(id) === 'i') reorderInstances(railOrigin(from), railOrigin(id), after).catch(() => {}); // (two servers of one homeserver: nothing to do there)
    if (group(from) !== 'v' || group(id) !== 'v') return;
    const st = getState();
    const src = st.servers.find(x => x.sid === from.slice(2)), dst = st.servers.find(x => x.sid === id.slice(2));
    if (!src || !dst) return;
    const vlist = st.servers.filter(x => (x.inst || NOOKARA) === NOOKARA && x.sid !== src.sid);
    vlist.splice(vlist.findIndex(x => x.sid === dst.sid) + (after ? 1 : 0), 0, src);
    patchState({ servers: [...vlist, ...st.servers.filter(x => (x.inst || NOOKARA) !== NOOKARA)] });
    saveSettings({ server_order: vlist.map(x => x.sid) }).catch(() => toast("Couldn't save the server order."));
  }
  const dropRef = useRef(dropOn);
  dropRef.current = dropOn; // (the pointer handlers are set up once: they call the latest one)
  // pointer-based (works with a mouse and on touch): a mouse drags after moving a few px; a finger holds ~350 ms first, so
  // scrolling the rail still works. The item under the pointer shows where it lands; a drag never also counts as a click.
  const press = useRef(null); // { id, x, y, pointer, timer, active }
  const swallowClick = useRef(false);
  const target = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-rail-id]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { over: el.dataset.railId, after: y > r.top + r.height / 2 };
  };
  useEffect(() => {
    const move = e => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointer) return;
      if (!p.active) {
        const far = Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 6;
        if (p.touch) { if (far) { clearTimeout(p.timer); press.current = null; } return; } // a finger that moves before the hold scrolls instead
        if (!far) return;
        p.active = true; dragId.current = p.id;
      }
      p.moved = true;
      e.preventDefault();
      // a copy of the icon follows the pointer; the list makes room for it as it goes (the real item is the gap)
      if (!p.ghost) {
        const ico = p.el.querySelector('.vc-srv-ico');
        if (ico) {
          const r = ico.getBoundingClientRect();
          p.ghost = Object.assign(ico.cloneNode(true), { className: `${ico.className} vc-rail-ghost` });
          p.gw = r.width; p.gh = r.height;
          Object.assign(p.ghost.style, { width: `${r.width}px`, height: `${r.height}px` }); // (outside the rail its own size would stretch)

          document.body.appendChild(p.ghost);
        }
      }
      if (p.ghost) p.ghost.style.transform = `translate(${e.clientX - p.gw / 2}px, ${e.clientY - p.gh / 2}px)`;
      const t = target(e.clientX, e.clientY);
      if (!t || t.over === p.id) { if (!p.last) setDrag({ id: p.id }); return; } // (over itself: keep where it is)
      if (p.last?.over === t.over && p.last.after === t.after) return;
      p.last = t;
      setDrag({ id: p.id, ...t });
    };
    const up = e => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointer) return;
      clearTimeout(p.timer); press.current = null;
      p.ghost?.remove();
      if (!p.active) return;
      swallowClick.current = true; setTimeout(() => { swallowClick.current = false; }, 0);
      // a finger held but never moved: that was a long-press, so open the server's menu as it would have
      if (p.touch && !p.moved) { dragId.current = null; setDrag(null); p.el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y })); return; }
      const t = e.type === 'pointerup' ? p.last : null; // where the gap was last shown
      if (t && t.over !== p.id) { dragId.current = p.id; dropRef.current(t.over, t.after); } else { dragId.current = null; setDrag(null); }
    };
    const noScroll = e => { if (press.current?.active) e.preventDefault(); }; // a finger dragging a server must not scroll the rail
    addEventListener('touchmove', noScroll, { passive: false });
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => { removeEventListener('touchmove', noScroll); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // while dragging: the list as it will be once dropped (the dragged item moves to where the gap is shown)
  const preview = (list, idOf) => {
    if (!drag?.over) return list;
    const from = list.findIndex(x => idOf(x) === drag.id);
    if (from < 0) return list;
    const rest = list.filter((_, i) => i !== from);
    const at = rest.findIndex(x => idOf(x) === drag.over);
    if (at < 0) return list;
    rest.splice(at + (drag.after ? 1 : 0), 0, list[from]);
    return rest;
  };
  const dnd = id => ({

    'data-rail-id': id,
    onPointerDown: e => {
      if (e.button !== 0) return;
      const touch = e.pointerType !== 'mouse';
      const p = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId, touch, active: false, el: e.currentTarget };
      if (touch) p.timer = setTimeout(() => { if (press.current === p) { p.active = true; dragId.current = id; setDrag({ id }); navigator.vibrate?.(15); } }, 350);
      press.current = p;
    },
    onClickCapture: e => { if (swallowClick.current) { e.stopPropagation(); e.preventDefault(); } },
    onContextMenuCapture: e => { if (press.current?.touch && e.isTrusted) { e.preventDefault(); e.stopPropagation(); } }, // (the long-press menu opens on release instead, unless it became a drag)

    onDragStart: e => e.preventDefault(), // (no native drag of the icon image)
    cls: drag?.id === id ? ' dragging' : '',
  });

  const item = (s, i) => (
    <RailItem key={s.sid} dnd={dnd(`v:${s.sid}`)} server={s.sid} hs={hsBadge(nookaraDomain(), null)} active={view.sid === s.sid} unread={view.sid !== s.sid && loudUnreadOf(s)} title={s.name} style={{ '--i': i }} onClick={() => go({ kind: 'server', sid: s.sid })}
      badge={isMuted(s.sid) ? 0 : (s.mentions || 0) + (srvMentions[s.sid] || 0)}
      onContextMenu={e => serverMenu(e, s, { onInvite: () => dialog('invite', s.sid), onSettings: () => dialog('settings', s.sid), onLeave: () => dialog('leave', s.sid) })}>
      <span className="vc-srv-ico"><ServerIcon src={s.icon} name={s.name} /></span>
    </RailItem>
  );
  const instItem = ({ rail, inst, server: s }, i) => { // s = the community, once I'm in it
    const split = rail !== `i:${inst.origin}`; // one of several servers on this homeserver
    const name = s?.name || inst.community?.name || inst.name;
    const icon = s?.icon || inst.community?.icon_url || inst.icon;
    const active = split ? view.sid === s.sid : view.inst === inst.origin || (!!view.sid && instOf(view.sid) === inst.origin);
    const muted = s && isMuted(s.sid);
    const ask_ = async () => { if (await ask({ title: `Remove ${split ? homeDomainOf(inst, s) : name}?`, text: `${inst.v2 ? homeDomainOf(inst, s) : inst.host} leaves your server list${split ? ', with every server you are in on it,' : ''}${getToken() ? ' on every device' : ''}. Your account there stays as it is - you can add it again any time.`, confirm: 'Remove from list', danger: true })) removeInstance(inst.origin); };
    return (
      <RailItem key={rail} dnd={dnd(rail)} hs={hsBadge(homeDomainOf(inst, s), inst.homeserver?.icon_url || null)} active={active} unread={!active && !!s && loudUnreadOf(s)} title={`${name} · ${s?.address || (inst.v2 ? homeDomainOf(inst, s) : inst.host)}`} server={s?.sid} style={{ '--i': legacy.length + i }}
        status={inst.status !== 'open' ? inst.status : null} sleep={inst.sleep} badge={s && !muted ? (s.mentions || 0) + (srvMentions[s.sid] || 0) : 0}
        onClick={() => go(s && inst.status === 'open' ? { kind: 'server', sid: s.sid } : { kind: 'instance', inst: inst.origin, ...(split ? { then: { kind: 'server', sid: s.sid } } : {}) })}
        onContextMenu={e => instanceMenu(e, inst, s, {
          onInvite: () => dialog('invite', s.sid), onSettings: () => dialog('settings', s.sid), onLeave: () => dialog('leave', s.sid), onRemove: ask_,
          onHide: s ? () => { hideServer(s.sid); toast(`${name} is hidden from your list. Settings › Homeservers shows it again.`, true); if (active) go({ kind: 'home' }); } : undefined,
          onReconnect: () => reconnectInstance(inst.origin),
          onDisconnect: () => disconnectInstance(inst.origin),
          onLogin: () => (inst.needsNookara ? startSignIn() : inst.v2 && inst.source ? dialog('chat-settings', null, { page: 'homeservers' }) : dialog('add-instance', null, { url: inst.origin })),
        })}>
        <span className="vc-srv-ico"><ServerIcon src={icon} name={name} /></span>
      </RailItem>
    );
  };
  return (
    <nav className="vc-rail" aria-label="Servers">
      <RailItem active={home && !discoverOn} unread={(homeUnread || homeRequests > 0) && !home} badge={homeRequests} title={homeRequests ? `Home - ${homeRequests} request${homeRequests === 1 ? '' : 's'} waiting` : 'Home - friends and direct messages'} onClick={() => go(home && !discoverOn ? { kind: 'home' } : lastHomeView())}>
        <span className="vc-srv-ico vc-rail-dm"><MessageCircle size={24} /></span>
      </RailItem>
      {newDMs.map(c => (
        <RailItem key={`dm-${c.username}`} unread badge={c.unread} onContextMenu={e => userMenu(e, c.username)} title={`${c.username === 'System' ? 'Nookara' : displayNameOf(c.username) || c.username} - ${c.unread} new`} onClick={() => go({ kind: 'dm', username: c.username })}>
          <span className="vc-srv-ico">{c.username === 'System' ? <Logo size={22} /> : (c.pfp || people[c.username]?.pfp) ? <img src={c.pfp || people[c.username].pfp} alt="" /> : initials(c.username)}</span>
        </RailItem>
      ))}
      {modmail?.unread > 0 && view.kind !== 'modmail' && (
        <RailItem unread badge={modmail.unread} title="Nookara Moderator Chat" onClick={() => go({ kind: 'modmail' })}>
          <span className="vc-srv-ico"><ShieldCheck size={20} /></span>
        </RailItem>
      )}
      <div className="vc-rail-sep" />
      {preview(ordered, idOf).map((x, n) => (x.rail ? instItem(x, n) : item(x, n)))}

      {(legacy.length > 0 || instances.length > 0) && <div className="vc-rail-sep" />}
      <RailItem title="Create a server" onClick={onCreate}><span className="vc-srv-ico act"><Plus size={22} /></span></RailItem>
      <RailItem title="Discover" active={discoverOn} onClick={onDiscover}><span className="vc-srv-ico act"><Compass size={20} /></span></RailItem>

      {!isDesktopApp() && !mobileBridge() && (
        <RailItem title="Get the Ember app" onClick={() => dialog('app-download')}><span className="vc-srv-ico act" data-app-download><Download size={20} /></span></RailItem>
      )}
    </nav>
  );
}
// the homeserver badge on a rail icon: its icon, else the first letters of its domain on a color of its own
const hsHue = d => [...String(d)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function RailHome({ domain, icon }) {
  const [bad, setBad] = useState(false);
  const label = String(domain || '').replace(/^(www|chat)\./, '').split(/[.:]/)[0].slice(0, 2);
  return <i className="vc-rail-hs" aria-hidden="true" style={{ '--hs-color': `hsl(${hsHue(domain)} 45% 38%)` }}>{icon && !bad ? <img src={icon} alt="" onError={() => setBad(true)} /> : label}</i>;
}
function RailItem({ active, unread, title, onClick, children, style, badge, onContextMenu, server, dnd, status, sleep, hs }) {
  const { cls = '', ...drag } = dnd || {};
  return (
    <div className={`vc-rail-item${active ? ' active' : ''}${unread ? ' unread' : ''}${status ? (status === 'connecting' ? ' inst-connecting' : ' inst-off') : ''}${cls}`} style={style} onContextMenu={onContextMenu} {...drag}>
      <i className="vc-pill" />
      <button type="button" onClick={onClick} data-tip={server ? undefined : title} data-tip-server={server} data-tip-side="right" aria-label={title}>{children}</button>
      {hs && <RailHome {...hs} />}
      {badge > 0 && <span className="vc-rail-badge" key={badge}>{badge > 99 ? '99+' : badge}</span>}
      {status === 'connecting' && <i className="vc-ring vc-rail-ring" aria-hidden="true" />}
      {status === 'asleep' && <i className="vc-rail-sleep" aria-hidden="true">{sleep === 'manual' ? <Unplug size={18} /> : <Moon size={18} />}</i>}
    </div>
  );
}
import { initials } from './initials.js';
import { dialog } from './dialogs.js';
import { typersOf } from './typers.js';
import { useConnLost } from './connLost.js';

// ── the server's sidebar: header (banner), categories, channels ─────────────
export function ServerSidebar({ sid, onInvite, onSettings, onChannel, onLeave, onUser }) {
  const d = useChat(s => s.detail[sid]);
  const view = useChat(s => s.view);
  const unread = useChat(s => s.unread);
  const typing = useChat(s => s.typing);
  const people = useChat(s => s.people);
  const liveMentions = useChat(s => s.mentions);
  const instances = useChat(s => s.instances);
  const home = useServerHome(sid); // the homeserver it lives on, under its name
  useChat(s => s.notify); // redraw when mute / notification settings change
  const [menu, setMenu] = useState(false);
  const listRef = useRef(null);
  const [closed, setClosed] = useState(() => new Set());
  const [drag, setDrag] = useState(null);   // { kind: 'channel' | 'category', id }
  const [dropAt, setDropAt] = useState(null); // where it would land (for the line)
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const off = e => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    setTimeout(() => addEventListener('mousedown', off), 0);
    return () => removeEventListener('mousedown', off);
  }, [menu]);
  if (!d) return <div className="vc-side"><div className="vc-loading"><i /><i /><i /></div></div>;
  const perms = d.server.perms || 0;
  const canChannels = has(perms, P.MANAGE_CHANNELS);
  const instAdmin = isInst(sid) && !!instances.find(i => i.origin === instOf(sid))?.isAdmin; // the instance's admins get its settings tabs
  const canSettings = has(perms, P.MANAGE_SERVER) || has(perms, P.MANAGE_ROLES) || instAdmin;
  const cats = d.categories || [];
  // uncategorised channels first, then each category in its order (empty ones too)
  const groups = [{ name: '', list: [] }, ...cats.map(name => ({ name, list: [] }))];
  for (const c of d.channels) (groups.find(g => g.name === (c.category || '')) || groups[0]).list.push(c);
  const toggle = n => setClosed(s => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });

  // ── rearranging (Manage channels): drag channels between / within categories, drag categories around ──
  async function saveLayout(newCats, order) {
    const channelsOut = order ? order.map(c => ({ cid: c.cid, category: c.category || '' })) : undefined;
    // show it straight away
    applyLocal(sid, newCats, order);
    try { await apiFetch(`/chat/servers/${sid}/layout`, { method: 'PUT', body: JSON.stringify({ categories: newCats, channels: channelsOut }) }); }
    catch (e) { toast(errorText(e.message)); refreshServer(sid); }
  }
  function dropChannel(targetCat, beforeCid) {
    const moving = d.channels.find(c => c.cid === drag?.id);
    setDrag(null); setDropAt(null);
    if (!moving) return;
    const flat = groups.flatMap(g => g.list).filter(c => c.cid !== moving.cid);
    const moved = { ...moving, category: targetCat };
    let idx = beforeCid ? flat.findIndex(c => c.cid === beforeCid) : -1;
    if (idx < 0) { // the end of that category
      const inCat = flat.map((c, i) => [c, i]).filter(([c]) => (c.category || '') === targetCat);
      idx = inCat.length ? inCat[inCat.length - 1][1] + 1 : (targetCat === '' ? 0 : flat.length);
      if (!inCat.length && targetCat !== '') { // empty category: after every channel of the categories before it
        const before = new Set(['', ...cats.slice(0, cats.indexOf(targetCat))]);
        idx = flat.filter(c => before.has(c.category || '')).length;
      }
    }
    flat.splice(idx, 0, moved);
    saveLayout(cats, flat);
  }
  function dropCategory(beforeName) {
    const name = drag?.id;
    setDrag(null); setDropAt(null);
    if (!name || name === beforeName) return;
    const rest = cats.filter(c => c !== name);
    const i = beforeName ? rest.indexOf(beforeName) : rest.length;
    rest.splice(i < 0 ? rest.length : i, 0, name);
    const order = ['', ...rest].flatMap(cn => d.channels.filter(c => (c.category || '') === cn));
    saveLayout(rest, order);
  }
  async function newCategory() {
    const name = await ask({ title: 'Create a category', text: 'Categories group channels together in the list.', input: { placeholder: 'Category name', value: '' }, confirm: 'Create' });
    if (!name || !name.trim()) return;
    if (cats.includes(name.trim())) { toast('There is already a category with that name.'); return; }
    saveLayout([...cats, name.trim().slice(0, 40)]);
  }
  async function renameCategory(old) {
    const name = await ask({ title: `Rename ${old}`, input: { placeholder: 'Category name', value: old }, confirm: 'Rename' });
    if (!name || !name.trim() || name.trim() === old) return;
    const nn = name.trim().slice(0, 40);
    if (isInst(sid)) { // an Ember server renames it in place: its permissions stay, and its channels keep following them
      try { await apiFetch(`/api/v1/servers/${encodeURIComponent(bare(sid))}/categories/${encodeURIComponent(old)}`, { inst: instOf(sid), method: 'PUT', body: JSON.stringify({ name: nn }) }); await refreshServer(sid); }
      catch (e) { toast(e.message === 'category_taken' ? 'There is already a category with that name.' : errorText(e.message)); }
      return;
    }
    const order = groups.flatMap(g => g.list).map(c => ((c.category || '') === old ? { ...c, category: nn } : c));
    saveLayout(cats.map(c => (c === old ? nn : c)), order);
  }
  async function deleteCategory(name) {
    // channels always live in a category: they move to the one above (or the next one)
    const i = cats.indexOf(name);
    const into = cats[i - 1] || cats[i + 1];
    const has = d.channels.some(c => c.category === name);
    if (has && !into) { toast('Make another category first - every channel needs to be in one.'); return; }
    if (!(await ask({ title: `Delete the ${name} category?`, text: has ? `Its channels move into ${into}.` : 'It has no channels in it.', confirm: 'Delete category', danger: true }))) return;
    saveLayout(cats.filter(c => c !== name));
  }
  const catMenu = (e, name) => openMenu(e, [
    { label: closed.has(name) ? 'Expand category' : 'Collapse category', onClick: () => toggle(name) },
    canChannels && 'sep',
    canChannels && { label: 'Create channel here', icon: Plus, onClick: () => onChannel({ category: name }) },
    canChannels && { label: 'Rename category', icon: Pencil, onClick: () => renameCategory(name) },
    canChannels && isInst(sid) && { label: 'Category permissions', icon: Shield, onClick: () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'cat-perms', sid, category: name } })) },
    canChannels && { label: 'Create category', icon: FolderPlus, onClick: newCategory },
    canChannels && { label: 'Delete category', icon: Trash2, danger: true, onClick: () => deleteCategory(name) },
  ]);

  return (
    <div className={`vc-side${d.cached ? ' vc-side-cached' : ''}`} key={sid} aria-busy={d.cached || undefined}>
      <div className={`vc-side-head${d.server.banner ? ' banner' : ''}`} ref={menuRef} onContextMenu={e => serverMenu(e, d.server, { onInvite, onSettings, onLeave, admin: canSettings })}>
        {d.server.banner && <img className="vc-side-banner" src={d.server.banner} alt="" />}
        <button type="button" className="vc-side-title" onClick={() => setMenu(m => !m)}>
          <span className="vc-side-tname"><span>{d.server.name}</span><HomeChip domain={home} title={`${d.server.address || d.server.name} lives on the homeserver ${home}`} /></span><ChevronDown size={16} className={menu ? 'flip' : ''} />
        </button>
        {/* Modern: quick actions on the banner (Classic keeps just the menu) */}
        <span className="vc-side-acts">
          {d.server.invite && <button type="button" className="vc-ico-btn" data-tip="Share invite link" onClick={() => shareInvite(d.server, sid)}><Share2 size={17} /></button>}
          <button type="button" className="vc-ico-btn" data-tip="Invite people" onClick={onInvite}><UserPlus size={17} /></button>
          {canSettings && <button type="button" className="vc-ico-btn" data-tip="Server settings" onClick={onSettings}><Settings size={17} /></button>}
        </span>
        {menu && (
          <div className="vc-menu vc-srv-menu">
            <button type="button" onClick={() => { setMenu(false); onInvite(); }}><UserPlus size={15} /> Invite people</button>
            {canSettings && <button type="button" onClick={() => { setMenu(false); onSettings(); }}><Settings size={15} /> Server settings</button>}
            {canChannels && <button type="button" onClick={() => { setMenu(false); onChannel(null); }}><Plus size={15} /> Create channel</button>}
            {canChannels && <button type="button" onClick={() => { setMenu(false); newCategory(); }}><FolderPlus size={15} /> Create category</button>}
            {d.server.role !== 'owner' && <><div className="vc-menu-sep" /><button type="button" className="danger" onClick={() => { setMenu(false); onLeave(); }}><LogOut size={15} /> Leave server</button></>}
          </div>
        )}
      </div>
      <div className="vc-side-scroll">
      <UnreadPills listRef={listRef} />
      <div className="vc-side-list" ref={listRef} onContextMenu={e => { if (canChannels && e.target === e.currentTarget) openMenu(e, [{ label: 'Create channel', icon: Plus, onClick: () => onChannel(null) }, { label: 'Create category', icon: FolderPlus, onClick: newCategory }]); }}>
        {d.server.description && <p className="vc-side-desc">{d.server.description}</p>}
        {groups.map(g => (g.name ? (g.list.length || canChannels || instAdmin) : (g.list.length || drag?.kind === 'channel')) && (
          <div key={g.name || '-'} className={`vc-cat${drag?.kind === 'category' && drag.id === g.name ? ' dragging' : ''}`}>
            {g.name ? (
              <button type="button" className={`vc-cat-name${dropAt === `cat:${g.name}` ? ' drop-line' : ''}`} onClick={() => toggle(g.name)} onContextMenu={e => catMenu(e, g.name)}
                draggable={canChannels} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.name); setTimeout(() => setDrag({ kind: 'category', id: g.name }), 0); }}
                onDragOver={e => { if (!drag) return; e.preventDefault(); setDropAt(`cat:${g.name}`); }}
                onDragLeave={() => setDropAt(x => (x === `cat:${g.name}` ? null : x))}
                onDrop={e => { e.preventDefault(); if (drag?.kind === 'category') dropCategory(g.name); else dropChannel(g.name, null); }}
                onDragEnd={() => { setDrag(null); setDropAt(null); }}>
                <ChevronDown size={12} className={closed.has(g.name) ? 'shut' : ''} /> {g.name}
                {canChannels && <span className="vc-cat-add" role="button" tabIndex={0} title="Create a channel here" onClick={e => { e.stopPropagation(); onChannel({ category: g.name }); }}><Plus size={14} /></span>}
              </button>
            ) : null}
            <div className={`dd-body${closed.has(g.name) && drag?.kind !== 'channel' ? '' : ' open'}`}><div className="dd-inner">
              {g.list.map((c, i) => {
                const on = view.cid === c.cid;
                const muted = effectiveNotify(c.cid, sid).muted;
                const un = !on && !muted && (c.unread || unread[`c:${c.cid}`]);
                const pings = on ? 0 : (c.mentions || 0) + (liveMentions[c.cid] || 0);
                return (
                  <Fragment key={c.cid}>
                  <div className={`vc-ch${on ? ' on' : ''}${un ? ' unread' : ''}${muted ? ' muted' : ''}${drag?.id === c.cid ? ' dragging' : ''}${dropAt === c.cid ? ' drop-line' : ''}`} style={{ '--i': i }}
                    draggable={canChannels} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.cid); setTimeout(() => setDrag({ kind: 'channel', id: c.cid }), 0); }}
                    onDragOver={e => { if (drag?.kind !== 'channel' || drag.id === c.cid) return; e.preventDefault(); setDropAt(c.cid); }}
                    onDrop={e => { e.preventDefault(); if (drag?.kind === 'channel') dropChannel(c.category || '', c.cid); }}
                    onDragEnd={() => { setDrag(null); setDropAt(null); }}
                    onContextMenu={e => channelMenu(e, c, sid, {
                      admin: canChannels,
                      onEdit: () => onChannel(c),
                      onDelete: async () => {
                        if (!(await ask({ title: `Delete #${c.name}?`, text: 'The channel and all of its messages go for good.', confirm: 'Delete channel', danger: true }))) return;
                        apiFetch(`/chat/channels/${c.cid}`, { method: 'DELETE' }).then(() => refreshServer(sid)).catch(() => {});
                      },
                    })}>
                    <button type="button" className="vc-ch-btn" onClick={() => { if (c.type === 'link') { openLinkChannel(c); return; } if (c.type === 'voice') joinVoice(`bf_${c.cid}`, { kind: 'channel', sid, cid: c.cid }); go({ kind: 'channel', sid, cid: c.cid }); }} title={c.type === 'link' ? c.config?.url : (c.topic || c.name)}>
                      <ChannelIcon c={c} /> <span>{c.name}</span>{c.type === 'game' && !c.config?.setup && <i className="vc-game-setup-dot" title="Needs setup (only admins see it)" />}
                    </button>
                    {!on && <TypingMark names={typersOf(typing, `c:${c.cid}`)} people={people} sid={sid} />}
                    {c.type !== 'voice' && <RecentPosters cid={c.cid} base={c.recent} />}
                    {pings > 0 && !muted && <span className="vc-ping" key={pings}>{pings > 99 ? '99+' : pings}</span>}
                    {canChannels && <button type="button" className="vc-ch-gear" title="Edit channel" onClick={() => onChannel(c)}><Settings size={13} /></button>}
                  </div>
                  {c.type === 'voice' && <VoiceChannelUsers cid={c.cid} sid={sid} onUser={onUser && ((name, el) => onUser(name, el, 'left', isInst(sid) ? getState().members[sid]?.find(x => x.username === name) : undefined))} />}
                  </Fragment>
                );
              })}
            </div></div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
// draw a new layout right away (the server confirms with chat_channels_update)
function applyLocal(sid, cats, order) {
  setDetailLayout(sid, cats, order);
}

// ── home: friends, DMs, group chats ─────────────────────────────────────────
// Nookara hasn't connected yet since the page loaded (DMs, groups, friends live there): a small note where those lists are, with
// Retry now. Waits a moment first, so a normal connect doesn't flash it. Later drops get the popup in Chat.jsx instead.
export function NookaraConnNote({ className = '' }) {
  const conn = useChat(s => s.conn);
  const at = useChat(s => s.connRetryAt);
  const connected = useChat(s => s.connected);
  const late = useConnLost(1500);
  if (connected || !late || !getToken()) return null;
  return (
    <div className={`vc-conn-note ${className}`} role="status">
      <i className="vc-gate-spin" />
      <span><b>{conn === 'closed' ? 'Reconnecting to Nookara...' : 'Connecting to Nookara...'}</b>{conn === 'closed' && <RetryIn at={at} />}</span>
      {conn === 'closed' && <button type="button" onClick={retryNow}>Retry now</button>}
      {conn === 'closed' && <StatusLink id="ember" className="vc-conn-status" label="Status" size={12} />}
    </div>
  );
}

export function HomeSidebar({ onNewDM, onNewGroup, onQuick }) {
  const typing = useChat(s => s.typing);
  const view = useChat(s => s.view);
  const dms = useChat(s => s.dms);
  const modmail = useChat(s => s.modmail);
  const groups = useChat(s => s.groups);
  const unread = useChat(s => s.unread);
  const presence = useChat(s => s.presence);
  const people = useChat(s => s.people);
  const pointers = useChat(s => s.social.dms); // DMs on other homeservers (store.js: Nookara's /api/v2/social)
  const dmNodes = useRef(new Map());
  const listRef = useRef(null);
  const previousDmRects = useRef(new Map());
  useLayoutEffect(() => {
    // Keep existing rows still; only a conversation that moved up gets a FLIP slide.
    for (const c of dms) {
      const key = c.username.toLowerCase();
      const el = dmNodes.current.get(key);
      const was = previousDmRects.current.get(key);
      if (!el || !was) continue;
      const delta = was.top - el.getBoundingClientRect().top;
      if (delta > 1) el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
    return () => { previousDmRects.current = new Map([...dmNodes.current].map(([key, el]) => [key, el.getBoundingClientRect()])); };
  }, [dms]);
  // ── pinned categories (DmPins.jsx): at the top, each with its conversations; drag to move things around ──
  const pinsRaw = useChat(s => s.settings?.dm_pins);
  const cats = useMemo(() => cleanPins(pinsRaw), [pinsRaw]);
  const pinned = useMemo(() => pinnedSet(cats), [cats]);
  const byKey = useMemo(() => new Map([...dms.map(c => [dmKey(c.username), { dm: c }]), ...groups.map(g => [groupKey(g.room), { group: g }])]), [dms, groups]);
  const [folded, setFolded] = useState(readFolded); // (this device's own)
  const fold = id => setFolded(f => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); writeFolded(n); return n; });
  const [drag, setDrag] = useState(null); // { kind: 'item', key } | { kind: 'cat', id }
  const [over, setOver] = useState(null); // where it would land: { cat: id | null, index, head } | { catAt }
  const overTo = o => setOver(cur => (JSON.stringify(cur) === JSON.stringify(o) ? cur : o));
  const endDrag = () => { setDrag(null); setOver(null); };
  const drop = () => {
    if (drag?.kind === 'item' && over && 'cat' in over) {
      if (over.cat == null) { if (pinned.has(drag.key)) unpinItem(drag.key); }
      else {
        const old = cats.find(c => c.id === over.cat)?.items.indexOf(drag.key) ?? -1;
        pinItem(drag.key, over.cat, over.index >= 0 && old >= 0 && old < over.index ? over.index - 1 : over.index);
      }
    } else if (drag?.kind === 'cat' && over?.catAt != null) {
      const old = cats.findIndex(c => c.id === drag.id);
      moveCategory(drag.id, old < over.catAt ? over.catAt - 1 : over.catAt);
    }
    endDrag();
  };
  const outHere = drag?.kind === 'item' && over && over.cat === null && pinned.has(drag.key);
  const outOver = e => { if (drag?.kind !== 'item') return; e.preventDefault(); overTo({ cat: null }); };
  // a conversation row can be dragged; over a pinned one it shows where it would go, over the normal list it unpins
  const dragProps = (k, catId, index, isLast) => ({
    draggable: true,
    onDragStart: e => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', k); } catch { /* fine */ } setDrag({ kind: 'item', key: k }); },
    onDragEnd: endDrag,
    onDragOver: e => {
      if (drag?.kind !== 'item') return;
      e.preventDefault();
      if (catId == null) { overTo({ cat: null }); return; }
      const r = e.currentTarget.getBoundingClientRect();
      overTo({ cat: catId, index: index + (e.clientY > r.top + r.height / 2 ? 1 : 0) });
    },
    onDrop: e => { e.preventDefault(); drop(); },
    dropCls: catId != null && over?.cat === catId && !over.head ? (over.index === index ? ' drop-before' : isLast && over.index === index + 1 ? ' drop-after' : '') : '',
    dragCls: drag?.kind === 'item' && drag.key === k ? ' dragging' : '',
  });
  const dmRow = (c, catId, index = 0, isLast = false) => {
    const k = dmKey(c.username);
    const on = keyOf(view) === k;
    const p = presence[c.username];
    const sys = c.username === 'System';
    const { dropCls, dragCls, ...dp } = dragProps(k, catId, index, isLast);
    return (
      <button type="button" key={c.username} ref={el => { const key = c.username.toLowerCase(); if (el) dmNodes.current.set(key, el); else dmNodes.current.delete(key); }} className={`vc-dm${on ? ' on' : ''}${!on && (c.unread || unread[k]) ? ' unread' : ''}${dropCls}${dragCls}`}
        {...dp}
        onContextMenu={e => (sys ? openMenu(e, [{ label: 'Open', onClick: () => go({ kind: 'dm', username: c.username }) }, 'sep', ...pinMenuItems(k)]) : userMenu(e, c.username, { onProfile: () => dispatchEvent(new CustomEvent('vc-open-big', { detail: { username: c.username, dm: true } })), extra: ['sep', ...pinMenuItems(k)] }))}
        onClick={() => go({ kind: 'dm', username: c.username })}>
        {sys ? <span className="vc-av vc-sys-av" style={{ width: 32, height: 32 }}><Logo size={18} /></span> : <Avatar user={{ username: c.username, pfp: c.pfp || people[c.username]?.pfp }} size={32} status={p?.status || 'offline'} />}
        <span className="vc-dm-txt"><b title={sys ? undefined : fullHandle(c.username)}>{sys ? 'Nookara' : <NameText u={{ username: c.username }} fallback={c.username} />}{c.bot && <BotTag small />}</b>{!sys && subtitle(p) && <small>{subtitle(p)}</small>}</span>
        {!on && <TypingMark names={typersOf(typing, k)} people={people} />}
        {(c.unread > 0) && !on && <span className="vc-count">{c.unread > 99 ? '99+' : c.unread}</span>}
      </button>
    );
  };
  // a pinned server channel (PinItems.jsx draws it; its menu has Open, the pin items and Add to Home)
  const chanRow = (k, catId, index, isLast) => {
    const { dropCls, dragCls, ...dp } = dragProps(k, catId, index, isLast);
    return <PinItemRow key={k} k={k} className={`${dropCls}${dragCls}`} {...dp} />;
  };
  const groupRow = (g, catId, index = 0, isLast = false) => {
    const k = groupKey(g.room);
    const on = keyOf(view) === k;
    const { dropCls, dragCls, ...dp } = dragProps(k, catId, index, isLast);
    return (
      <button type="button" key={g.room} className={`vc-dm${on ? ' on' : ''}${!on && unread[k] ? ' unread' : ''}${dropCls}${dragCls}`} onClick={() => go({ kind: 'group', room: g.room })}
        {...dp}
        onContextMenu={e => openMenu(e, [
          { label: 'Open', onClick: () => go({ kind: 'group', room: g.room }) },
          ...pinMenuItems(k),
          { label: 'Leave group', danger: true, onClick: () => dialog('leave-group', null, { room: g.room }) },
          'sep',
          { label: 'Copy group ID', dev: true, onClick: () => copy(g.room, 'Group ID copied') },
        ])}>
        <span className="vc-av vc-grp-av" style={{ width: 32, height: 32 }}><UsersRound size={16} /></span>
        <span className="vc-dm-txt"><b>{g.name}</b><small>{g.members.length} members</small></span>
        {!on && <TypingMark names={typersOf(typing, k)} people={people} />}
      </button>
    );
  };
  return (
    <div className="vc-side">
      <div className="vc-side-head"><button type="button" className="vc-quick" onClick={onQuick}><span>Quick switcher</span><kbd>Ctrl</kbd><kbd>K</kbd></button></div>
      <div className="vc-side-scroll">
      <UnreadPills listRef={listRef} />
      <div className="vc-side-list" ref={listRef}>
        <button type="button" className={`vc-ch vc-home-link${view.kind === 'home' ? ' on' : ''}`} onClick={() => go({ kind: 'home' })}><House size={18} /> <span>Home</span></button>
        <button type="button" className={`vc-ch vc-home-link${view.kind === 'notes' ? ' on' : ''}`} onClick={() => go({ kind: 'notes' })}><NotebookPen size={18} /> <span>Personal Notes</span></button>
        <NookaraConnNote />
        {modmail.messages.length > 0 && (
          <button type="button" className={`vc-dm vc-dm-mod${keyOf(view) === 'mm:' ? ' on' : ''}${keyOf(view) !== 'mm:' && modmail.unread ? ' unread' : ''}`} onClick={() => go({ kind: 'modmail' })}>
            <span className="vc-av vc-sys-av" style={{ width: 32, height: 32 }}><ShieldCheck size={18} /></span>
            <span className="vc-dm-txt"><b>Nookara Moderator Chat</b><small>From Nookara's admins</small></span>
            {modmail.unread > 0 && keyOf(view) !== 'mm:' && <span className="vc-count">{modmail.unread}</span>}
          </button>
        )}
        {cats.map((cat, ci) => {
          const shut = folded.has(cat.id);
          const rows = cat.items.map((k, i) => [k, i, byKey.get(k) || (k.startsWith('c:') ? { chan: true } : null)]).filter(([, , x]) => x);
          const n = rows.reduce((a, [k, , x]) => a + (x.dm ? Number(x.dm.unread) || (unread[k] ? 1 : 0) : unread[viewKeyOf(k)] ? 1 : 0), 0);
          const last = rows.length ? rows[rows.length - 1][1] : -1;
          return (
            <div key={cat.id} className={`vc-pin-cat${drag?.kind === 'cat' && drag.id === cat.id ? ' dragging' : ''}${over?.catAt === ci ? ' drop-before' : ''}${over?.catAt === ci + 1 && ci === cats.length - 1 ? ' drop-after' : ''}`} style={{ '--pin': cat.color }}>
              <button type="button" className={`vc-pin-head${over?.cat === cat.id && over.head ? ' drop-in' : ''}`} draggable aria-expanded={!shut}
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', cat.name); } catch { /* fine */ } setDrag({ kind: 'cat', id: cat.id }); }}
                onDragEnd={endDrag}
                onDragOver={e => {
                  if (!drag) return;
                  e.preventDefault();
                  if (drag.kind === 'cat') { const r = e.currentTarget.getBoundingClientRect(); overTo({ catAt: ci + (e.clientY > r.top + r.height / 2 ? 1 : 0) }); }
                  else overTo({ cat: cat.id, index: shut ? -1 : 0, head: true });
                }}
                onDrop={e => { e.preventDefault(); drop(); }}
                onClick={() => fold(cat.id)} onContextMenu={e => openMenu(e, catMenuItems(cat))} title={`${cat.name} - drag to move, right-click to edit`}>
                <ChevronDown size={12} className={shut ? 'shut' : ''} />
                <span className="vc-pin-dot" />
                <span className="vc-pin-name">{cat.name}</span>
                {shut && n > 0 && <span className="vc-count">{n > 99 ? '99+' : n}</span>}
              </button>
              {!shut && rows.map(([k, i, x]) => (x.dm ? dmRow(x.dm, cat.id, i, i === last) : x.group ? groupRow(x.group, cat.id, i, i === last) : chanRow(k, cat.id, i, i === last)))}
              {!shut && !rows.length && (
                <div className={`vc-pin-empty${over?.cat === cat.id ? ' drop-in' : ''}`} onDragOver={e => { if (drag?.kind !== 'item') return; e.preventDefault(); overTo({ cat: cat.id, index: -1 }); }} onDrop={e => { e.preventDefault(); drop(); }}>
                  Drag conversations here
                </div>
              )}
            </div>
          );
        })}
        <div className={`vc-cat-name static${outHere ? ' drop-out' : ''}`} onDragOver={outOver} onDrop={e => { e.preventDefault(); drop(); }}>Direct messages <span className="vc-cat-add" role="button" tabIndex={0} title="New message" onClick={onNewDM}><Plus size={14} /></span></div>
        {dms.length + pointers.length === 0 && <div className="vc-side-empty">No messages yet. Start one with the + above.</div>}
        {nookaraDmRows(dms.filter(c => !pinned.has(dmKey(c.username))), pointers).map(r => (r.kind === 'dm' ? dmRow(r.c, null) : <SocialDmRow key={r.dm.id} dm={r.dm} />))}
        <div className={`vc-cat-name static${outHere ? ' drop-out' : ''}`} onDragOver={outOver} onDrop={e => { e.preventDefault(); drop(); }}>Group chats <span className="vc-cat-add" role="button" tabIndex={0} title="New group chat" onClick={onNewGroup}><Plus size={14} /></span></div>
        {groups.length === 0 && <div className="vc-side-empty">No group chats.</div>}
        {groups.filter(g => !pinned.has(groupKey(g.room))).map(g => groupRow(g, null))}
        <PinCategoryHost />
      </div>
      </div>
    </div>
  );
}

// the member list while it loads: grey lines where people go
function MemberSkeleton() {
  const widths = [62, 48, 74, 55, 40, 68, 52, 60, 45, 70];
  return (
    <div className="vc-mem-skel" aria-hidden="true">
      <i className="vc-mem-skel-head" />
      {widths.map((w, i) => <div key={i} className="vc-mem-skel-row" style={{ '--d': `${i * 70}ms` }}><i className="vc-mem-skel-av" /><i className="vc-mem-skel-line" style={{ width: `${w}%` }} /></div>)}
    </div>
  );
}

// ── member list (grouped: owner / admins / online / offline) ────────────────
export function MemberList({ sid, cid, onUser, embedded = false }) {
  const allMembers = useChat(s => s.members[sid]);
  // only the people who can see the channel you're in (GET /chat/channels/:cid/viewers; null = everyone). Self-hosted
  // servers don't answer that yet, so they list everyone as before.
  const ch = useChat(s => (cid ? s.detail[sid]?.channels?.find(c => c.cid === cid) : null));
  const permKey = ch ? JSON.stringify([ch.private, ch.overwrites, ch.type, ch.config?.purpose, ch.config?.instance]) : '';
  const [viewers, setViewers] = useState(null);
  useEffect(() => {
    if (!cid) { setViewers(null); return undefined; } // instances without /viewers (older ember-server) answer 404: then everyone shows
    let live = true;
    apiFetch(`/chat/channels/${cid}/viewers`).then(d => { if (live) setViewers(d.all ? null : new Set((d.ids || []).map(String))); }).catch(() => { if (live) setViewers(null); });
    return () => { live = false; };
  }, [cid, sid, permKey, allMembers?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const members = useMemo(() => (viewers && allMembers ? allMembers.filter(m => viewers.has(String(m.id))) : allMembers), [allMembers, viewers]);
  const more = useChat(s => s.membersMore[sid]); // a big Nookara-hosted server: more pages to load (as you scroll)
  const presence = useChat(s => s.presence);
  const names = useChat(s => s.nookaraNames);
  const signedIn = useChat(s => s.signedIn);
  const dnv = useDisplayNamesVersion(); // a display name came in / changed: sort again
  useEffect(() => { wantDisplayNames((allMembers || []).filter(m => !serverOwnName(m)).map(m => m.username)); }, [allMembers]);
  const [shown, setShown] = useState(60);
  const roles = useChat(s => s.detail[sid]?.roles);
  const blocks = useChat(s => s.blocks); // people I blocked: masked below
  const [shut, setShut] = useState(() => new Set()); // collapsed groups (by title)
  const flip = k => setShut(x => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const groups = useMemo(() => {
    if (!members) return [];
    const st = m => statusOf(sid, m) || 'offline';
    const none = m => statusOf(sid, m) === null; // an instance's own accounts and bots (or signed out of Nookara): no presence, so no online / offline
    const on = members.filter(m => !none(m) && st(m) !== 'offline');
    const nm = m => personName(m, displayNameOf(m.username)); // (display names sort the list, displayNames.js)
    const by = (a, b) => nm(a).localeCompare(nm(b), undefined, { sensitivity: 'base' });
    // online people go under their highest "show separately" role (highest first), the rest under Online
    const hoisted = (roles || []).filter(r => r.hoist && !r.is_default).sort((a, b) => b.position - a.position);
    const used = new Set();
    const out = hoisted.map(r => {
      const list = on.filter(m => !used.has(m.username) && m.roles?.includes(r.rid));
      list.forEach(m => used.add(m.username));
      return [r.name, list.sort(by), r];
    });
    out.push(['Online', on.filter(m => !used.has(m.username)).sort(by)]);
    out.push(['Members', members.filter(none).sort(by)]);
    out.push(['Offline', members.filter(m => !none(m) && st(m) === 'offline').sort(by)]);
    return out.filter(([, l]) => l.length);
  }, [members, presence, roles, names, signedIn, dnv]); // eslint-disable-line react-hooks/exhaustive-deps
  const cls = `vc-members${embedded ? ' embedded' : ''}`;
  if (!members) return <aside className={cls} aria-busy="true"><MemberSkeleton /></aside>;
  let n = 0;
  return (
    <aside className={cls} key={sid} onScroll={more != null ? e => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) loadMoreMembers(sid); } : undefined}>
      {groups.map(([title, list, role]) => (
        <div key={role?.rid || title} className="vc-mgroup">
          <button type="button" className="vc-cat-name vc-mgroup-head" aria-expanded={!shut.has(title)} onClick={() => flip(title)} style={role?.color ? { '--role': role.color } : undefined}>
            {role?.icon && <img className="vc-role-ico" src={role.icon} alt="" />}<span className="vc-mgroup-t">{title}</span><span className="vc-mgroup-n"> - {list.length}</span>
            <span className="grow" /><ChevronDown size={14} className={shut.has(title) ? 'shut' : ''} />
          </button>
          {!shut.has(title) && list.map(m => {
            n++;
            if (title === 'Offline' && n > shown) return null;
            const p = presenceFor(sid, m);
            const blocked = !!blocks?.length && isBlockedPerson(m, isInst(sid) ? instOf(sid) : NOOKARA); // somebody I blocked: no name, picture or status line
            const sub = blocked ? null : subtitle(p);
            return (
              <button type="button" key={m.username} className={`vc-member vl-rise${p?.status === 'offline' ? ' off' : ''}`} onClick={e => onUser(m.username, e.currentTarget, 'left', isInst(sid) ? m : undefined)}
                onContextMenu={e => { const el = e.currentTarget; userMenu(e, m.username, { sid, onProfile: () => onUser(m.username, el, 'left', isInst(sid) ? m : undefined) }); }}>
                <MemberAvatar m={m} status={statusOf(sid, m) || undefined} ghost={!!p?.invisible} blocked={blocked} />
                <span className="vc-member-txt">
                  {blocked ? <b className="vc-blocked-name">{BLOCKED_NAME}<BlockedMark size={12} /></b> : <MemberName sid={sid} m={m} />}
                  {sub && <small>{sub}</small>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {(n > shown || more != null) && <button type="button" className="vc-more" onClick={() => { setShown(x => x + 100); if (more != null) loadMoreMembers(sid); }}>Show more</button>}
    </aside>
  );
}

// ── an instance's admins, looking at it: its voice minutes for the month are nearly (or all) used. Sits above you, at the
// bottom left; dismissed per server, month and level (80 % / used up), so it comes back only when it gets worse ──
const quotaKey = (origin, level) => `bf_voice_quota_seen:${origin}:${new Date().toISOString().slice(0, 7)}:${level}`;
export function VoiceQuotaNote() {
  const view = useChat(s => s.view);
  const origin = view.kind === 'channel' && view.sid && isInst(view.sid) ? instOf(view.sid) : null;
  const inst = useChat(s => (origin ? s.instances.find(i => i.origin === origin) : null));
  const [, redraw] = useState(0);
  const q = inst?.isAdmin ? inst.voiceQuota : null;
  if (!q?.cap_minutes) return null;
  const used = Number(q.used_minutes) || 0, cap = Number(q.cap_minutes);
  if (used < cap * 0.8) return null;
  const level = used >= cap ? 'full' : 'near';
  let seen = false;
  try { seen = !!localStorage.getItem(quotaKey(origin, level)); } catch { /* fine */ }
  if (seen) return null;
  const dismiss = () => { try { localStorage.setItem(quotaKey(origin, level), '1'); } catch { /* fine */ } redraw(n => n + 1); };
  const open = tab => openHomeserverSettings(origin, tab);
  return (
    <div className={`vc-quota-note ${level}`} role="status">
      <button type="button" className="vc-quota-x" aria-label="Dismiss" onClick={dismiss}><X size={14} /></button>
      <b><Volume2 size={14} /> {level === 'full' ? 'Voice minutes used up' : 'Voice minutes running low'}</b>
      <span>{Math.min(used, cap).toLocaleString()} of {cap.toLocaleString()} minutes used this month on {inst.name}.{level === 'full' ? ' Voice channels stop working until next month.' : ''}</span>
      <div className="vc-quota-bar"><i style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
      <button type="button" className="btn btn-surface btn-sm" onClick={() => open('voice')}>Use your own voice keys</button>
    </div>
  );
}

// ── an instance's admins, looking at it: the server software is out of date. Next to the voice-minutes note; dismissed per server
// and latest version, so it comes back when there is a newer one ──
export function OutdatedNote() {
  const view = useChat(s => s.view);
  const origin = view.kind === 'channel' && view.sid && isInst(view.sid) ? instOf(view.sid) : null;
  const inst = useChat(s => (origin ? s.instances.find(i => i.origin === origin) : null));
  const [, redraw] = useState(0);
  const u = inst?.isAdmin ? inst.serverInfo?.update : null;
  if (!u?.outdated) return null;
  const latest = u.latest?.commit_short || u.latest?.version || 'newer';
  const mine = inst.serverInfo?.build?.commit_short || inst.serverInfo?.build?.version || 'unknown';
  const key = `bf_outdated_seen:${origin}:${u.latest?.commit || latest}`;
  let seen = false;
  try { seen = !!sessionStorage.getItem(key); } catch { /* fine */ }
  if (seen) return null;
  const dismiss = () => { try { sessionStorage.setItem(key, '1'); } catch { /* fine */ } redraw(n => n + 1); };
  const open = (autoUpdate = false) => openHomeserverSettings(origin, 'info', { autoUpdate });
  const oneClick = !!u.one_click && !inst.managed; // Ember can run the update itself (the server's host agent is set up)
  return (
    <div className="vc-quota-note near" role="status">
      <button type="button" className="vc-quota-x" aria-label="Dismiss" onClick={dismiss}><X size={14} /></button>
      <b><CircleArrowUp size={14} /> Server update available</b>
      <span>This server is running an old version ({mine}). Latest is {latest}{u.latest?.message ? `: ${u.latest.message}` : ''}. {inst.managed ? 'Nookara updates it automatically within about 10 minutes.' : oneClick ? 'Update it now? Everyone is disconnected for a minute or two.' : 'Server info shows how to update it.'}</span>
      {oneClick && <button type="button" className="btn btn-primary btn-sm" onClick={() => open(true)}><CircleArrowUp size={14} /> Update now</button>}
      <button type="button" className="btn btn-surface btn-sm" onClick={() => open(false)}>Server info</button>
    </div>
  );
}

// ── you, at the bottom left: click = your profile pop-out (status, accounts, Edit profile) ──

// signed in on a homeserver (v2): that account, from the homeserver it is on. Its profile is kept there (ember-server 4.1), so the
// name opens Settings > Profile on it when the homeserver has account profiles; otherwise My account.
function HomeWho({ home, me }) {
  const inst = useChat(s => s.instances.find(i => i.origin === normOrigin(home.origin)));
  const editable = hasAccountProfile(inst);
  const name = me?.display_name || home.account.display_name || home.account.username;
  const pfp = me?.pfp ?? home.account.avatar_url ?? null;
  const edit = () => (editable ? openProfileEditor(accountTarget(inst.origin)) : dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'chat-settings', page: 'homeaccount' } })));
  // a menu: your profile, then every account on this device to switch to, and Add account (accountSwitch.js)
  const open = e => {
    const others = deviceAccounts(null, { nookaraDomain: nookaraDomain() }).filter(a => !a.current);
    openMenu(e, [
      { label: editable ? 'Edit profile' : 'My account', icon: UserRound, onClick: edit },
      others.length && 'sep',
      ...others.map(a => ({ label: a.handle, hint: a.kind === 'nookara' ? 'Nookara account' : a.hsName, icon: Repeat, onClick: () => switchToAccount(a).catch(() => toast(`${a.handle} was signed out - add it again.`)) })),
      'sep',
      { label: 'Add account', icon: UserPlus, onClick: () => dispatchEvent(new Event('vc-add-account')) },
    ]);
  };
  return (
    <button type="button" className="vc-me-who" title={home.account.handle} onClick={open}>
      <Avatar user={{ username: home.account.username, pfp }} size={36} />
      <span className="vc-me-txt"><b>{name}</b><small><Handle handle={home.account.handle} /></small></span>
    </button>
  );
}

export function UserPanel({ onSettings, onEditProfile }) {
  const me = useChat(s => s.me);
  const signedIn = useChat(s => s.signedIn);
  const p = useChat(s => s.presence[s.me?.username]);
  const conn = useChat(s => s.conn);
  const connected = useChat(s => s.connected);
  const lost = useConnLost();
  const showConn = conn !== 'open' && (lost || !connected); // a short drop keeps your status showing
  // the account of the server I'm looking at, when it's one of that server's own (not a Nookara one): that's who I am there
  const view = useChat(s => s.view);
  const here = useChat(s => { const o = view.inst || (view.sid && isInst(view.sid) ? instOf(view.sid) : null); return o ? s.instances.find(i => i.origin === o) : null; });
  const home = useHomeSession(); // signed in on a homeserver (v2), shown while there's no Nookara account to show
  const [pop, setPop] = useState(null); // the panel's rect while the pop-out is open
  const [custom, setCustomOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const open = () => setCustomOpen(true);
    addEventListener('vc-custom-status', open);
    return () => removeEventListener('vc-custom-status', open);
  }, []);
  if (!signedIn || (here?.user && here.user.kind === 'local')) { // signed out of Nookara, or on a server with its own accounts: no Nookara pop-out
    const u = home && here && (here.origin === normOrigin(home.origin) || here.user?.kind !== 'local') ? null : here?.user; // (my homeserver account, wherever it signed me in: shown as itself below)
    const editable = hasAccountProfile(here); // its own accounts keep a profile: the name opens it (Settings > Profile, on this server)
    const who = u && <><Avatar user={u} size={36} /><span className="vc-me-txt"><b>{u.display_name || u.username}</b><small>{here.host}</small></span></>;
    return (
      <div className="vc-me">
        {u ? (editable ? <button type="button" className="vc-me-who" title="Edit your profile on this server" onClick={() => openProfileEditor(accountTarget(here.origin))}>{who}</button> : <div className="vc-me-who">{who}</div>)
          : home ? <HomeWho home={home} me={me} />
          : <button type="button" className="vc-me-who" onClick={() => go({ kind: 'home' })} title="Sign in on Home"><span className="vc-av vc-sys-av" style={{ width: 36, height: 36 }}><UserRound size={19} /></span><span className="vc-me-txt"><b>Not signed in</b><small>Sign in on Home</small></span></button>}
        <QuickVoiceBtns />
        <button type="button" className="vc-ico-btn" onClick={onSettings} title="Settings"><Settings size={17} /></button>
      </div>
    );
  }
  if (!me) return null;
  const status = p?.status || 'online';
  return (
    <div className="vc-me" ref={ref}>
      <button type="button" className={`vc-me-who${pop ? ' on' : ''}`} aria-expanded={!!pop} onClick={() => setPop(x => (x ? null : ref.current.getBoundingClientRect()))} title="Your profile and status">
        <Avatar user={me} size={36} status={showConn ? 'offline' : status} />
        <span className="vc-me-txt">
          <b><NameText u={{ username: me.username }} fallback={me.username} /></b>
          <small title={subtitle(p) || STATUS_LABEL[status]}>{showConn ? (conn === 'closed' ? 'Reconnecting...' : 'Connecting...') : <Handle handle={fullHandle(me.username)} />}</small>
        </span>
      </button>
      <QuickVoiceBtns />
      <button type="button" className="vc-ico-btn" onClick={onSettings} title="Settings"><Settings size={17} /></button>
      {pop && <MePopout anchor={pop} onClose={() => setPop(null)} onEditProfile={onEditProfile} onCustomStatus={() => { setPop(null); setCustomOpen(true); }} />}
      {custom && <CustomStatus current={p?.custom || ''} onClose={() => setCustomOpen(false)} />}
    </div>
  );
}
function CustomStatus({ current, onClose }) {
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await setCustom(text); onClose(); } catch { setBusy(false); }
  }
  return createPortal(
    <div className="vc-modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="vc-dialog" onSubmit={save}>
        <h3>Set a custom status</h3>
        <p className="vc-dialog-sub">Shows under your name in member lists and on your profile.</p>
        <input className="form-input" autoFocus maxLength={128} placeholder="What's on your mind?" value={text} onChange={e => setText(e.target.value)} />
        <div className="vc-dialog-btns">
          {current && <button type="button" className="btn btn-surface" disabled={busy} onClick={async () => { setBusy(true); try { await setCustom(''); onClose(); } catch { setBusy(false); } }}>Clear status</button>}
          <span className="grow" />
          <button type="button" className="btn btn-surface" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// a member list name: their colour (accent or role), role icon, owner crown
function MemberAvatar({ m, status, ghost, blocked }) { const f = useFace(m); return <Avatar user={blocked ? blockedFace(f) : f} size={34} status={status} ghost={ghost} />; }
function MemberName({ sid, m: raw }) {
  const m = useFace(raw);
  const key = useNameStyle(sid, m);
  const shown = useName(m);
  return <b style={colorFrom(key) ? { color: colorFrom(key) } : undefined}>{shown || m.username} <NameDecor sid={sid} user={m} />{m.bot && <BotTag small verified={!!m.verified} />}{m.role === 'owner' && <RoleChip role="owner" />}</b>;
}

// "who posted recently" (Modern, Settings > Text & layout): up to 3 faces of people who posted in the channel in the last
// 10 minutes (the server's list with the channels + live messages). Rechecked every minute so old ones drop off.
const RECENT_MS = 10 * 60 * 1000;
function RecentPosters({ cid, base }) {
  const live = useChat(s => s.recentPosts?.[cid]);
  const people = useChat(s => s.people);
  const [, tick] = useState(0);
  const on = useSyncExternalStore(subscribeLook, () => getLook().recentPosters);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60000); return () => clearInterval(t); }, []);
  if (!on || !document.documentElement.classList.contains('vc-rounded')) return null;
  const now = Date.now();
  const seen = new Set();
  const list = [...(live || []), ...(base || [])].filter(p => p && now - (p.at || 0) < RECENT_MS && !seen.has(p.username) && seen.add(p.username)).slice(0, 3);
  if (!list.length) return null;
  return (
    <span className="vc-recent" title={`Posted recently: ${list.map(p => p.username).join(', ')}`}>
      {list.map(p => <Avatar key={p.username} user={{ username: p.username, pfp: p.pfp || people[p.username]?.pfp }} size={18} />)}
    </span>
  );
}

// the banner's share button: the system share sheet where there is one, otherwise copy the invite link
function shareInvite(server, sid) {
  const link = inviteLinkFor(sid, server.invite);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { navigator.share({ title: server.name, url: link }).catch(() => {}); return; }
  navigator.clipboard?.writeText(link).then(() => toast('Invite link copied.', true), () => toast("Couldn't copy the link."));
}
