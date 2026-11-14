// What can be pinned (DmPins.jsx categories) or put on Home as a shortcut (Ikelene 2026-11-14): a DM, a group chat or a
// server channel, by its item key (dmPinsCore.js). This draws one as a row (the DM list, Home's pinned list on phones)
// or a tile (Home > Shortcuts), with the right-click / long-press menu for it. Home shortcuts are the chat setting
// home_shortcuts on Nookara, so every device has the same ones (live, via chat_settings_changed).
import { useEffect, useMemo, useState } from 'react';
import { House, UsersRound, ChevronDown, ChevronLeft, ChevronRight, MessageCircle, Hash } from 'lucide-react';
import { useChat, getState, go, keyOf, refreshServer, saveSettings, loadSettings, toast, errorText } from './store.js';
import { openMenu, userMenu } from './Menu.jsx';
import { Avatar, subtitle } from './Profile.jsx';
import { NameText } from './displayNames.js';
import { ServerIcon } from './ServerIcon.jsx';
import { ChannelIcon } from './roles.jsx';
import { pinMenuItems, catMenuItems } from './DmPins.jsx';
import { parseItem, viewKeyOf, cleanPins, cleanShortcuts, toggleShortcut, moveShortcut, MAX_SHORTCUTS } from './dmPinsCore.js';

// ── Home shortcuts ──
export const getShortcuts = () => cleanShortcuts(getState().settings?.home_shortcuts);
function setShortcuts(next) {
  saveSettings({ home_shortcuts: next }).catch(e => { toast(errorText(e?.message)); loadSettings(); });
}
export function homeMenuItem(k) {
  const list = getShortcuts();
  const on = list.includes(k);
  return { label: on ? 'Remove from Home' : 'Add to Home', icon: House, disabled: !on && list.length >= MAX_SHORTCUTS, hint: !on && list.length >= MAX_SHORTCUTS ? `Home has ${MAX_SHORTCUTS} already` : '', onClick: () => setShortcuts(toggleShortcut(getShortcuts(), k)) };
}

// which categories are folded (this device only; the DM list in Parts.jsx uses the same key)
const FOLD_KEY = 'ember:dmpins:folded';
const readFolded = () => { try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
const writeFolded = set => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* private mode */ } };

// a pinned channel of a server whose channels aren't loaded yet: load them once (for the name)
const asked = new Set();
function useChannelOf(x) {
  const sid = x?.kind === 'channel' ? x.sid : null;
  const detail = useChat(s => (sid ? s.detail[sid] : null));
  const server = useChat(s => (sid ? s.servers.find(v => v.sid === sid) : null));
  useEffect(() => {
    if (!sid || detail || !server || asked.has(sid)) return;
    asked.add(sid);
    refreshServer(sid)?.catch?.(() => {});
  }, [sid, detail, server]);
  return { server, channel: sid ? detail?.channels?.find(c => c.cid === x.cid) || null : null, loading: !!sid && !!server && !detail };
}

// what an item shows: { name, sub, pic, unread, open, gone }
function useItem(k) {
  const x = useMemo(() => parseItem(k), [k]);
  const dm = useChat(s => (x?.kind === 'dm' ? s.dms.find(c => c.username.toLowerCase() === x.name) : null));
  const group = useChat(s => (x?.kind === 'group' ? s.groups.find(g => g.room === x.room) : null));
  const presence = useChat(s => (dm ? s.presence[dm.username] : null));
  const pfp = useChat(s => (dm ? dm.pfp || s.people[dm.username]?.pfp : null));
  const vk = viewKeyOf(k);
  const unreadFlag = useChat(s => !!s.unread[vk] || !!(x?.kind === 'channel' && s.unreadN[x.cid]?.n));
  const ch = useChannelOf(x);
  if (!x) return { gone: true };
  if (x.kind === 'dm') {
    const name = dm?.username || x.name;
    return {
      kind: 'dm', username: name, gone: !dm, unread: Number(dm?.unread) || (unreadFlag ? 1 : 0), status: presence?.status || 'offline',
      name: <NameText u={{ username: name }} fallback={name} />, sub: subtitle(presence) || '', pfp,
      open: () => go({ kind: 'dm', username: name }),
    };
  }
  if (x.kind === 'group') {
    return { kind: 'group', gone: !group, unread: unreadFlag ? 1 : 0, name: group?.name || 'Group chat', sub: group ? `${group.members.length} members` : 'Not in this group any more', open: () => go({ kind: 'group', room: x.room }) };
  }
  const c = ch.channel;
  return {
    kind: 'channel', gone: !ch.server, server: ch.server, channel: c, unread: unreadFlag ? 1 : 0,
    name: c ? c.name : ch.loading ? 'Loading...' : ch.server ? 'Channel' : 'Unavailable', sub: ch.server?.name || "You're not in this server",
    open: () => (ch.server ? go({ kind: 'channel', sid: x.sid, cid: x.cid }) : toast("You're not in that server any more.")),
  };
}

// the right-click / long-press menu of an item (tile = Home shortcut: also move left / right)
export function itemMenu(e, k, it, { tile = false } = {}) {
  const list = tile ? getShortcuts() : [];
  const i = list.indexOf(k);
  const more = [
    ...pinMenuItems(k),
    ...(tile ? [i > 0 && { label: 'Move left', icon: ChevronLeft, onClick: () => setShortcuts(moveShortcut(getShortcuts(), k, -1)) },
      i >= 0 && i < list.length - 1 && { label: 'Move right', icon: ChevronRight, onClick: () => setShortcuts(moveShortcut(getShortcuts(), k, 1)) }] : []),
  ].filter(Boolean);
  if (it.kind === 'dm' && !it.gone && it.username !== 'System') {
    userMenu(e, it.username, { onProfile: () => dispatchEvent(new CustomEvent('vc-open-big', { detail: { username: it.username } })), extra: ['sep', ...more] });
    return;
  }
  openMenu(e, [{ label: 'Open', icon: MessageCircle, onClick: it.open }, 'sep', ...more]);
}

// one row in a list (the DM list's categories, Home's pinned list). Extra props (drag and drop) go on the button.
export function PinItemRow({ k, className = '', hideGone = true, ...rest }) {
  const it = useItem(k);
  const on = useChat(s => keyOf(s.view) === viewKeyOf(k));
  if (it.gone && hideGone) return null;
  return (
    <button type="button" className={`vc-dm vc-pin-item${on ? ' on' : ''}${!on && it.unread ? ' unread' : ''}${it.gone ? ' gone' : ''}${className}`} onClick={it.open} onContextMenu={e => itemMenu(e, k, it)} {...rest}>
      <ItemPic it={it} size={32} />
      <span className="vc-dm-txt"><b>{it.kind === 'channel' && <Hash size={13} className="vc-pin-hash" />}{it.name}</b>{it.sub && <small>{it.sub}</small>}</span>
      {it.unread > 0 && !on && (it.kind === 'dm' ? <span className="vc-count">{it.unread > 99 ? '99+' : it.unread}</span> : <span className="vc-pin-dot-unread" />)}
    </button>
  );
}
function ItemPic({ it, size }) {
  if (it.kind === 'dm') return <Avatar user={{ username: it.username, pfp: it.pfp }} size={size} status={it.status} />;
  if (it.kind === 'group') return <span className="vc-av vc-grp-av" style={{ width: size, height: size }}><UsersRound size={size / 2} /></span>;
  return (
    <span className="vc-pin-srv" style={{ width: size, height: size }}>
      {it.server ? <ServerIcon src={it.server.icon} name={it.server.name} /> : <Hash size={size / 2} />}
      {it.channel && <i className="vc-pin-chico"><ChannelIcon c={it.channel} size={11} /></i>}
    </span>
  );
}

// Home > Shortcuts: tiles for the conversations and channels you put there
export function HomeShortcuts() {
  const raw = useChat(s => s.settings?.home_shortcuts);
  const list = useMemo(() => cleanShortcuts(raw), [raw]);
  if (!list.length) return null;
  return (
    <section className="hm-shortcuts vl-rise">
      <div className="hm-sub">Shortcuts</div>
      <div className="hm-recent">{list.map(k => <ShortcutTile key={k} k={k} />)}</div>
    </section>
  );
}
function ShortcutTile({ k }) {
  const it = useItem(k);
  return (
    <button type="button" className={`hm-tile hm-sc${it.gone ? ' gone' : ''}`} onClick={it.open} onContextMenu={e => itemMenu(e, k, it, { tile: true })} title={it.kind === 'channel' && it.server ? `${it.server.name}` : undefined}>
      <ItemPic it={it} size={44} />
      <b>{it.kind === 'channel' && '#'}{it.name}</b>
      {it.kind === 'channel' && <small>{it.sub}</small>}
      {it.unread > 0 && <i>{it.kind === 'dm' ? (it.unread > 99 ? '99+' : it.unread) : ''}</i>}
    </button>
  );
}

// Home's pinned categories (shown on phones, where Home is the first thing you see and the DM list is in the menu)
export function PinnedHome() {
  const raw = useChat(s => s.settings?.dm_pins);
  const cats = useMemo(() => cleanPins(raw), [raw]);
  const [folded, setFolded] = useState(readFolded);
  const fold = id => setFolded(f => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); writeFolded(n); return n; });
  if (!cats.length) return null;
  return (
    <section className="hm-pins">
      {cats.map(cat => {
        const shut = folded.has(cat.id);
        return (
          <div key={cat.id} className="vc-pin-cat" style={{ '--pin': cat.color }}>
            <button type="button" className="vc-pin-head" aria-expanded={!shut} onClick={() => fold(cat.id)} onContextMenu={e => openMenu(e, catMenuItems(cat))}>
              <ChevronDown size={12} className={shut ? 'shut' : ''} />
              <span className="vc-pin-dot" />
              <span className="vc-pin-name">{cat.name}</span>
            </button>
            {!shut && cat.items.map(k => <PinItemRow key={k} k={k} />)}
            {!shut && !cat.items.length && <div className="vc-pin-empty">Long-press a chat or channel and pick Pin to.</div>}
          </div>
        );
      })}
    </section>
  );
}
