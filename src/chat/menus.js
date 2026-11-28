// The right-click menus' items (servers, channels, messages, people) and openMenu, which shows one; Menu.jsx draws them.
import { getState, setMenu, toast, markServerRead, markChannelRead, linkFor, inviteLinkFor, saveToMedia, sdmReportRoute, go, toggleBlock, notifyOf, setNotify } from './store.js';
import { has, P, canNick, changeNick, nickMenuItems, profileMenuItems, roleMenuItems, modMenuItems } from './perms.js';
import { CheckCheck, UserPlus, Settings, LogOut, Code2, LogIn, RefreshCw, Pencil, Trash2, BellRing, Link2, Plug, Unplug, ShieldCheck, Copy, Image as ImageIcon, Pin, ExternalLink, BookmarkPlus, Info, Flag, Download, Reply, Forward, SmilePlus, Users, BookmarkCheck, Bookmark, Languages, Ellipsis, User, MessageCircle, Ban, Bell, BellOff, EyeOff } from 'lucide-react';
import { bare, instOf, isInst } from './ids.js';
import { homeDomainOf, homeLine } from './homeservers.js';
import { setInstancePrefs } from './instances.js';
import { chanKey } from './dmPinsCore.js';
import { pinMenuItems } from './dmPinActions.js';
import { plainText } from './tokens.js';
import { copyImage, viewPicture, downloadImage } from './mediaViewer.js';
import { appsItems } from './commands.js';
import { reportSdmMessage, reportTo, reportDmMessage } from './report.js';
import { canReportDm } from './dm-report.js';
import { openReactionsView } from './reactionsView.js';
import { emojiMenuItems } from './cloneEmoji.js';
import { isNookara } from '../compat.js';
import { apiFetch } from '../api.js';

// Track the full press, rather than timing out while the finger is still down.
let menuTouch = null;
document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.isPrimary) menuTouch = { id: e.pointerId, down: true, ended: 0 }; }, true);
const endMenuTouch = e => { if (menuTouch?.id === e.pointerId) { menuTouch.down = false; menuTouch.ended = Date.now(); } };
document.addEventListener('pointerup', endMenuTouch, true);
document.addEventListener('pointercancel', endMenuTouch, true);

export function openMenu(e, items, options = {}) {
  e.preventDefault();
  e.stopPropagation();
  const dev = getState().settings.developer_mode;
  let list = items.filter(Boolean).filter(i => i === 'sep' || !i.dev || dev);
  // tidy separators (none first / last / doubled)
  list = list.filter((i, n) => i !== 'sep' || (n > 0 && list[n - 1] !== 'sep'));
  while (list[list.length - 1] === 'sep') list.pop();
  if (!list.length) return;
  setMenu({ x: e.clientX, y: e.clientY, items: list, reaction: options.reaction, k: Date.now(), touch: !!(e.touch || e.nativeEvent?.touch || menuTouch?.down), press: menuTouch });
}

export const copy = (text, what = 'Copied') => {
  navigator.clipboard?.writeText(String(text)).then(() => toast(`${what} to your clipboard.`, true), () => toast("Couldn't copy that."));
};

// ── the menus ──
const MUTE_FOR = [['For 15 minutes', 15], ['For 1 hour', 60], ['For 8 hours', 480], ['For 24 hours', 1440], ['Until I turn it back on', -1]];

function notifyItems(target, isChannel) {
  const n = notifyOf(target);
  const muted = n.muted_until && n.muted_until > Date.now();
  const until = muted && n.muted_until < 4102444800000 ? `until ${new Date(n.muted_until).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}` : '';
  const levels = [...(isChannel ? [['default', 'Use the server\'s setting']] : []), ['all', 'All messages'], ['mentions', 'Only @mentions'], ['none', 'Nothing']];
  return [
    muted ? { label: `Unmute ${isChannel ? 'channel' : 'server'}`, hint: until, icon: Bell, onClick: () => setNotify(target, { mute_minutes: 0 }) }
      : { label: `Mute ${isChannel ? 'channel' : 'server'}`, icon: BellOff, sub: MUTE_FOR.map(([label, min]) => ({ label, onClick: () => setNotify(target, { mute_minutes: min }) })) },
    { label: 'Notifications', sub: [
      ...levels.map(([v, label]) => ({ label, checked: (n.level || (isChannel ? 'default' : 'mentions')) === v, onClick: () => setNotify(target, { level: v }) })),
      'sep',
      { label: 'Push notifications', hint: 'When Ember is closed', checked: n.push !== false, onClick: () => setNotify(target, { push: n.push === false }) },
    ] },
  ];
}

export function serverMenu(e, s, { onInvite, onSettings, onLeave, admin: isAdmin } = {}) {
  const admin = isAdmin || has(s.perms, P.MANAGE_SERVER) || has(s.perms, P.MANAGE_ROLES);
  openMenu(e, [
    { label: 'Mark as read', icon: CheckCheck, onClick: () => markServerRead(s.sid) },
    'sep',
    ...notifyItems(s.sid, false),
    'sep',
    { label: 'Invite people', icon: UserPlus, onClick: onInvite },
    admin && { label: 'Server settings', icon: Settings, onClick: onSettings },
    s.role !== 'owner' && { label: 'Leave server', icon: LogOut, danger: true, onClick: onLeave },
    'sep',
    { label: 'Copy server ID', icon: Code2, dev: true, onClick: () => copy(bare(s.sid), 'Server ID copied') },
  ]);
}

// right-click on a server on a homeserver (its icon on the rail). srv = the server once I'm in it, whatever state the connection
// is in. Only things about this one server: the connection belongs to the whole homeserver, so it shows up here only as
// "Reconnect to <domain>" while it is down (Settings > Homeservers has the rest).
export function homeServerMenu(e, inst, srv, { onInvite, onSettings, onLeave, onLogin, onRemove, onReconnect, onHide }) {
  const name = srv?.name || inst.community?.name || inst.name;
  const domain = homeDomainOf(inst, srv);
  const here = srv && inst.status === 'open';
  const admin = here && (has(srv.perms, P.MANAGE_SERVER) || has(srv.perms, P.MANAGE_ROLES) || inst.isAdmin);
  const line = homeLine(inst);
  openMenu(e, [
    { type: 'head', label: `${name} · ${domain}` },
    line && (line.action === 'signin'
      ? { label: `Sign in to ${domain}`, icon: LogIn, hint: line.hint, onClick: onLogin }
      : { label: `Reconnect to ${domain}`, icon: RefreshCw, hint: line.hint, onClick: onReconnect }),
    line && 'sep',
    srv && { label: 'Mark as read', icon: CheckCheck, onClick: () => markServerRead(srv.sid) },
    srv && 'sep',
    ...(srv ? notifyItems(srv.sid, false) : []),
    srv && 'sep',
    here && { label: 'Invite people', icon: UserPlus, onClick: onInvite },
    here && inst.user && canNick(srv.sid, true) && { label: 'Change nickname', icon: Pencil, onClick: () => changeNick(srv.sid, getState().members[srv.sid]?.find(x => x.id === inst.user.id) || { ...inst.user, nick: null }, true) },
    admin && { label: 'Server settings', icon: Settings, onClick: onSettings },
    here && srv.invite && { label: 'Copy invite link', icon: Link2, onClick: () => copy(inviteLinkFor(srv.sid, srv.invite), 'Invite link copied') },
    'sep',
    srv && onHide && { label: 'Hide from list', icon: EyeOff, hint: 'You stay in it', onClick: onHide },
    here && srv.role !== 'owner' && { label: 'Leave server', icon: LogOut, danger: true, onClick: onLeave },
    !srv && { label: 'Remove from list', icon: Trash2, danger: true, onClick: onRemove }, // (not in a server there yet: nothing else to do with it)
    srv && 'sep',
    srv && { label: 'Copy server ID', icon: Code2, dev: true, onClick: () => copy(bare(srv.sid), 'Server ID copied') },
  ]);
}

// right-click on an older Ember server that is one server on its own (protocol 1): the server and its connection are the same thing
export function instanceMenu(e, inst, srv, opts) {
  if (inst.v2) { homeServerMenu(e, inst, srv, opts); return; }
  const { onInvite, onSettings, onLeave, onLogin, onRemove, onReconnect, onDisconnect } = opts;
  const name = srv?.name || inst.community?.name || inst.name;
  const here = srv && inst.status === 'open';
  const admin = here && (has(srv.perms, P.MANAGE_SERVER) || has(srv.perms, P.MANAGE_ROLES) || inst.isAdmin);
  openMenu(e, [
    { type: 'head', label: `${name} \u00b7 ${inst.host}` },
    here && { label: 'Mark as read', icon: CheckCheck, onClick: () => markServerRead(srv.sid) },
    srv && 'sep',
    ...(srv ? notifyItems(srv.sid, false) : []),
    // Nookara's push consent for this server (it pushes to me through Nookara only while it's in my list, unmuted, push on)
    getState().signedIn && inst.prefs && { label: 'Push through Nookara', icon: BellRing, sub: [
      { label: 'Push notifications from this server', hint: 'When Ember is closed', checked: inst.prefs.push, onClick: () => setInstancePrefs(inst.origin, { push: !inst.prefs.push }) },
      { label: 'Mute this server', hint: 'No pushes from it at all', checked: inst.prefs.muted, onClick: () => setInstancePrefs(inst.origin, { muted: !inst.prefs.muted }) },
    ] },
    (srv || (getState().signedIn && inst.prefs)) && 'sep',
    here && { label: 'Invite people', icon: UserPlus, onClick: onInvite },
    here && inst.user && canNick(srv.sid, true) && { label: 'Change nickname', icon: Pencil, onClick: () => changeNick(srv.sid, getState().members[srv.sid]?.find(x => x.id === inst.user.id) || { ...inst.user, nick: null }, true) },
    admin && { label: 'Server settings', icon: Settings, onClick: onSettings },
    here && srv.invite && { label: 'Copy invite link', icon: Link2, onClick: () => copy(inviteLinkFor(srv.sid, srv.invite), 'Invite link copied') },
    { label: 'Copy URL', icon: Link2, onClick: () => copy(inst.origin, 'Server URL copied') },
    inst.sleep ? { label: 'Connect', icon: Plug, hint: inst.sleep === 'manual' ? 'You disconnected it' : 'Asleep (sleep mode)', onClick: onReconnect }
      : inst.status !== 'connecting' && { label: 'Reconnect', icon: RefreshCw, onClick: onReconnect },
    !inst.sleep && onDisconnect && { label: 'Disconnect', icon: Unplug, hint: 'Stays off until you open it', onClick: onDisconnect },
    inst.status === 'login' && inst.needsNookara && { label: 'Sign in with Nookara', icon: ShieldCheck, onClick: onLogin },
    inst.status === 'login' && !inst.needsNookara && inst.mode === 'local' && { label: 'Log in', icon: LogIn, onClick: onLogin },
    'sep',
    here && srv.role !== 'owner' && { label: 'Leave server', icon: LogOut, danger: true, onClick: onLeave },
    { label: 'Remove from list', icon: Trash2, danger: true, onClick: onRemove },
    srv && 'sep',
    srv && { label: 'Copy server ID', icon: Code2, dev: true, onClick: () => copy(bare(srv.sid), 'Server ID copied') },
  ]);
}

export function channelMenu(e, c, sid, { admin, onEdit, onDelete } = {}) {
  openMenu(e, [
    { label: 'Mark as read', icon: CheckCheck, onClick: () => markChannelRead(c.cid, sid) },
    'sep',
    ...notifyItems(c.cid, true),
    'sep',
    { label: 'Copy link', icon: Link2, onClick: () => copy(linkFor({ kind: 'channel', sid, cid: c.cid }), 'Link copied') },
    ...pinMenuItems(chanKey(sid, c.cid)), // (into a DM list category, or onto Home)
    admin && { label: 'Edit channel', icon: Pencil, onClick: onEdit },
    admin && { label: 'Delete channel', icon: Trash2, danger: true, onClick: onDelete },
    'sep',
    { label: 'Copy channel ID', icon: Code2, dev: true, onClick: () => copy(bare(c.cid), 'Channel ID copied') },
  ]);
}

// a message: the main things up top (reply, forward, react), then save / translate, then Copy and More actions as submenus,
// and Delete on its own at the bottom
export function messageMenu(e, m, view, { onReply, onEdit, onDelete, canDelete, canReply, canEdit, canCopyLink, onForward, canPin, onPin, onReact, onInfo, onSave, saved, onTranslate, translated, me } = {}) {
  const sel = String(getSelection?.() || '').trim();
  const link = e.target.closest?.('a[href]');
  const img = e.target.closest?.('img');
  // a picture / video / sound kept on Nookara (or a Klipy GIF): Save to Saved Media
  const mediaEl = e.target.closest?.('[data-media-url]');
  const mediaUrl = mediaEl?.dataset.mediaUrl || null;
  const mediaName = mediaEl?.dataset.mediaName || '';
  const pic = img && !/vc-(c|t)emoji|vc-av|vc-srv-ico/.test(`${img.className} ${img.parentElement?.className || ''}`) ? img : null; // a real picture, not an emoji or avatar
  // a picture or video someone posted (not an emoji or avatar): open it in a new tab / download it, right at the top of the menu
  const videoEl = e.target.closest?.('video');
  const mediaSrc = mediaUrl || pic?.src || videoEl?.currentSrc || videoEl?.src || null;
  const mediaFile = mediaName || undefined;
  const cemoji = e.target.closest?.('img.vc-cemoji[data-eid]'); // right-clicked a custom emoji: Clone emoji
  const authorId = m.author?.id || getState().people[m.author?.username]?.id; // (DM and group messages only carry the name)
  const dev = !!getState().settings?.developer_mode;
  const copyItems = [
    sel && { label: 'Copy selection', icon: Copy, onClick: () => copy(sel, 'Text copied') },
    m.body && { label: 'Copy text', icon: Copy, onClick: () => copy(plainText(m.body, view.sid ? instOf(view.sid) : undefined, view.sid), 'Text copied') },
    canCopyLink && { label: 'Copy message link', icon: Link2, onClick: () => copy(linkFor(view.kind === 'channel' && m.id && !m.pending ? { ...view, mid: String(m.id) } : view), 'Link copied') },
    link && { label: 'Copy link', icon: Link2, onClick: () => copy(link.href, 'Link copied') },
    pic && { label: 'Copy image', icon: ImageIcon, onClick: () => copyImage(pic.src) },
    dev && { label: 'Copy message ID', icon: Code2, onClick: () => copy(m.imId || m.gid || m.id, 'Message ID copied') },
    dev && authorId && { label: 'Copy author ID', icon: Code2, onClick: () => copy(authorId, 'Account ID copied') },
  ].filter(Boolean);
  const moreItems = [
    canPin && { label: m.pinned ? 'Unpin message' : 'Pin message', icon: Pin, onClick: onPin },
    view.kind === 'channel' && !m.system && !m.ephemeral && /^\d+$/.test(String(m.id)) && appsItems({ sid: view.sid, cid: view.cid, type: 3, target: m.id }),
    link && { label: 'Open link', icon: ExternalLink, onClick: () => window.open(link.href, '_blank', 'noopener') },
    pic && { label: 'Open picture', icon: ImageIcon, onClick: () => viewPicture(pic.src) },
    mediaUrl && { label: 'Save to Saved Media', icon: BookmarkPlus, onClick: () => saveToMedia(mediaUrl, mediaName) },
    onInfo && { label: 'Message info', icon: Info, onClick: onInfo }, // Manage messages: the real sender (aliases included)
    view.dm && sdmReportRoute(view, m) && { label: 'Report message', icon: Flag, danger: true, onClick: () => reportSdmMessage(view, m) },
    !view.dm && view.kind === 'channel' && isInst(view.sid) && !canEdit && !m.system && /^\d+$/.test(String(m.id)) && { label: 'Report message', icon: Flag, danger: true, onClick: () => reportTo(view.sid, { message_id: m.id }, 'this message', { target: m.author, message: m }) },
    canReportDm(view, m, getState().me?.username) && { label: 'Report message', icon: Flag, danger: true, onClick: () => reportDmMessage(view, m) },
  ].flat().filter(Boolean);
  openMenu(e, [
    mediaSrc && { label: 'Open in new tab', icon: ExternalLink, onClick: () => window.open(mediaSrc, '_blank', 'noopener,noreferrer') },
    mediaSrc && { label: 'Download', icon: Download, onClick: () => downloadImage(mediaSrc, mediaFile) },
    mediaSrc && 'sep',
    canReply && { label: 'Reply', icon: Reply, onClick: onReply },
    canEdit && { label: 'Edit message', icon: Pencil, onClick: onEdit },
    onForward && { label: 'Forward', icon: Forward, onClick: onForward },
    onReact && { label: 'React', icon: SmilePlus, onClick: onReact },
    m.reactions?.length > 0 && { label: 'View Reactions', icon: Users, onClick: () => openReactionsView(m) },
    'sep',
    onSave && { label: saved ? 'Remove from saved' : 'Save message', icon: saved ? BookmarkCheck : Bookmark, onClick: onSave },
    onTranslate && m.body && { label: translated ? 'Show original' : 'Translate', icon: Languages, onClick: onTranslate },
    ...(cemoji ? emojiMenuItems({ eid: cemoji.dataset.eid, name: cemoji.dataset.name, animated: cemoji.dataset.animated === '1' }) : []),
    'sep',
    copyItems.length > 0 && { label: 'Copy', icon: Copy, sub: copyItems },
    moreItems.length > 0 && { label: 'More actions', icon: Ellipsis, sub: moreItems },
    'sep',
    canDelete && { label: 'Delete message', icon: Trash2, danger: true, onClick: onDelete },
  ]);
}

export function userMenu(e, username, { onProfile, sid, extra = [] } = {}) {
  const st = getState();
  const isMe = st.me?.username === username;
  const member = sid ? st.members[sid]?.find(x => x.username === username) : null;
  const friend = st.friends.some(f => f.friend_username === username);
  const uid = member?.id || st.people[username]?.id;
  const blocked = !!st.blocks?.some(b => b.username === username);
  const local = !!member?.kind && !isNookara(member.kind); // an account that only exists on a self-hosted instance (a person or a bot): no Nookara profile, DM or friend request
  openMenu(e, [
    onProfile && { label: 'Profile', icon: User, onClick: onProfile },
    !isMe && !local && { label: 'Message', icon: MessageCircle, onClick: () => go({ kind: 'dm', username }) },
    !isMe && !friend && !local && { label: 'Add friend', icon: UserPlus, onClick: () => apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }).then(d => toast(d.status === 'accepted' ? `You and ${username} are friends now!` : `Friend request sent to ${username}.`, true)).catch(er => toast(er.message === 'already_friends' ? "You're already friends." : "Couldn't send that request.")) },
    { label: 'Copy username', icon: Copy, onClick: () => copy(username, 'Username copied') },
    sid && !isMe && getState().view?.kind === 'channel' && member && appsItems({ sid, cid: getState().view.cid, type: 2, target: member.id }),
    ...nickMenuItems(sid, username),
    ...profileMenuItems(sid, username),
    ...roleMenuItems(sid, username),
    ...modMenuItems(sid, username),
    sid && isInst(sid) && !isMe && member && !member.bot && { label: 'Report', icon: Flag, danger: true, onClick: () => reportTo(sid, { user_id: member.id }, `@${username}`, { target: member }) },
    !isMe && !local && username !== 'System' && { label: blocked ? 'Unblock' : 'Block', icon: Ban, danger: !blocked, onClick: () => toggleBlock(username, blocked) },
    ...extra,
    'sep',
    { label: 'Copy account ID', icon: Code2, dev: true, disabled: !uid, hint: uid ? '' : 'Open their profile first', onClick: () => copy(uid, 'Account ID copied') },
  ]);
}
