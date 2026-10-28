// The conversation: messages (grouped by person, with day dividers), the composer and who's typing.
import { canAttachInChannel } from './attachment-permissions.js';
import { apiFetch } from '../api.js';
import { instOpt, isInst, instOf } from './ids.js';
import { sigId } from './signing.js';
import { VideoPlayer, AudioPlayer } from './MediaPlayer.jsx';
import { viewMedia } from './MediaViewer.jsx';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Reply, Pencil, Trash2, Copy, Plus, X, SmilePlus, Lock, SendHorizontal, AlertCircle, ImageIcon, CornerUpRight, Music, Film, ArrowRight, ArrowLeft, Webhook, Phone, Pin, ChevronUp, Star, Upload, CloudUpload } from 'lucide-react';
import { Embeds } from './ChannelTypes.jsx';
import { LinkEmbeds } from './LinkEmbeds.jsx';
import { GameInvites } from './GameInvite.jsx';
import { inviteSummary } from './gameInvite.js';
import { PlatformIcon, PLATFORM_NAMES } from './platforms.jsx';
import { GameEventLine } from './GameServer.jsx';
import { BotTag } from './Bots.jsx';
import { CommandPicker, CommandBar, MessageComponents, InteractionLine, Thinking, EphemeralNote } from './Commands.jsx';
import { slashEntries, matchEntries } from './commands.js';
import { ViaBadge } from './ClientVia.jsx';
import { usePronouns } from './pronouns.js';
import { Reactions, QuickReactions, openReactionPicker } from './Reactions.jsx';
import MediaPicker, { GifBadge, StarButton } from './MediaPicker.jsx';
import EmojiPicker, { loadEmojiData } from './EmojiPicker.jsx';
import { TriangleAlert, Shield, Clock } from 'lucide-react';
import { BookmarkPlus, Smile, File as FileIcon, FileArchive, FileCode, FileText, Download, Coins, MessageSquareQuote } from 'lucide-react';

// a "GIF" picture-frame icon (drawn, not text) for the GIF picker button
function GifIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="1" y="1" width="20" height="16" />
      <path d="M8.2 6.6H6.4c-.9 0-1.4.6-1.4 1.4v2c0 .8.5 1.4 1.4 1.4h1.8V9.2H7" strokeLinecap="square" />
      <path d="M11 6.6v4.8" strokeLinecap="square" />
      <path d="M17 6.6h-3v4.8M14 9h2.4" strokeLinecap="square" />
    </svg>
  );
}
import { loadEmojis, loadMembers, loadCommands, clearStatusReply, useTimedOut, untilText, dismissEphemeral } from './store.js';
import { takeJump, fileKind, uploadMedia, saveToMedia, isMineMsg, loadUploadLimits, getUploadLimits } from './store.js';
import { useStarboardFor, starredByMe, STAR } from './Starboard.jsx';
import { CALL_LINE, callLineText } from './callText.js';
import { setReaction } from './Reactions.jsx';
import { getState, useChat, keyOf, loadMessages, sendMessage, setTyping, editMessage, deleteMessage, dropFailed, toast, errorText, dmErrorText, go, openLink, ask, askStripTracking } from './store.js';
import { cleanText, hasTracking } from './cleanLinks.js';
import { isSpoiler, spoilerName, shownName, nameInLink } from './spoiler.js';
import { renderBody, timeOf, stampOf, dayOf } from './text.jsx';
import { embedLabel } from './inviteLink.js';
import { Avatar } from './Profile.jsx';
import { messageMenu, userMenu, openMenu } from './Menu.jsx';
import { mentionsMe as isMention, useFace, wantVeloraFaces } from './store.js';
import { useNameStyle, colorFrom, NameDecor, P, has } from './roles.jsx';
import { suggestQuery, useSuggestItems, MentionPicker, encodeRoleMentions, decodeRoleMentions } from './Mentions.jsx';
import { serialize, fill, caretToEnd, caretText, replaceBeforeCaret, insertAt, resolveWord, markdownShortcut, styleMarkdown } from './richInput.js';

const GROUP_MS = 7 * 60 * 1000;

const markdownMarker = e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key.toLowerCase() === 'b') return '**';
  if (e.key.toLowerCase() === 'i') return '*';
  if (e.key.toLowerCase() === 'u') return '__';
  if (e.shiftKey && e.key.toLowerCase() === 's') return '~~';
  if (e.shiftKey && e.key.toLowerCase() === 'c') return '`';
  return null;
};

const KLIPY = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i;
// a klipy.com/gifs/<name> page link: Velora asks Klipy's API for the GIF (their site blocks scrapers)
export const KLIPY_PAGE = /^https:\/\/(?:www\.)?klipy\.com\/(gifs|stickers|clips)\/([\w-]{1,160})\/?(?:\?\S*)?$/i;
const klipyPages = new Map(); // page url -> { url, width, height, title } | { url: null }
function KlipyPageGif({ url }) {
  const [g, setG] = useState(() => klipyPages.get(url));
  useEffect(() => {
    if (g !== undefined) return;
    const k = KLIPY_PAGE.exec(url);
    apiFetch(`/chat/klipy/${k[1].toLowerCase()}/${k[2]}`).then(d => { klipyPages.set(url, d); setG(d); }).catch(() => setG({ url: null }));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return <span className="vc-att gif vc-att-loading" />;
  if (!g.url) return <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="vc-file">{url}</a>;
  const item = { url: g.url, type: 'gif', name: g.title, width: g.width, height: g.height };
  return (
    <a href={g.url} target="_blank" rel="noopener noreferrer" data-media-url={g.url} data-media-name={g.title || ''} className="vc-att gif"
      onClick={e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button || e.target.closest('.vc-star')) return; e.preventDefault(); viewMedia({ items: [item], index: 0 }); }}>
      <img src={g.url} alt={g.title || ''} loading="lazy" style={g.width ? { aspectRatio: `${g.width} / ${g.height}` } : undefined} />
      <GifBadge />
      <StarButton gif={{ url: g.url, preview: g.url, title: g.title, width: g.width, height: g.height }} />
    </a>
  );
}
// a file (zip, pdf, exe...): what it is, its name + size, and a Download button. Programs / scripts ask first.
const fmtSize = n => (!n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const RISKY = /^(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|hta|jar|apk|dll|lnk|reg|cpl|msix|appx)$/;
const KIND_OF = ext => (/^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext) ? 'Archive' : /^(exe|msi|msix|appx|apk|dmg|deb|appimage)$/.test(ext) ? 'Program'
  : /^(pdf)$/.test(ext) ? 'PDF' : /^(txt|md|rtf|log)$/.test(ext) ? 'Text' : /^(doc|docx|odt)$/.test(ext) ? 'Document' : /^(sb3|pmp|sb2)$/.test(ext) ? 'Scratch project'
  : /^(js|ts|jsx|tsx|py|json|html|css|c|cpp|cs|java|lua|sh|bat|cmd|ps1)$/.test(ext) ? 'Code' : 'File');
export function FileCard({ a }) {
  const name = shownName((() => { try { return decodeURIComponent(a.name || a.url.split('/').pop()); } catch { return a.name || 'file'; } })());
  const ext = (/\.([a-z0-9]{1,10})$/i.exec(name)?.[1] || /\.([a-z0-9]{1,10})$/i.exec(a.url)?.[1] || '').toLowerCase();
  const risky = RISKY.test(ext);
  const dl = /^https:\/\/files\.catbox\.moe\/[\w-]+\.[a-z0-9]{1,8}$/i.test(a.url) ? `/chat/dl?u=${encodeURIComponent(a.url)}&n=${encodeURIComponent(name)}` : a.url;
  const open = async e => {
    if (!risky) return; // the link just downloads
    e.preventDefault();
    if (await ask({ title: 'Download this program?', text: `${name} can run code on your computer. Only open files from people you trust.`, confirm: 'Download' })) location.href = dl;
  };
  const Ico = /^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext) ? FileArchive : /^(js|ts|jsx|tsx|py|json|html|css|c|cpp|cs|java|lua|sb3|pmp|sh|ps1)$/.test(ext) ? FileCode : /^(txt|md|pdf|doc|docx|rtf|odt|log)$/.test(ext) ? FileText : FileIcon;
  return (
    <div className="vc-filecard">
      <span className="vc-filecard-ico"><Ico size={26} />{ext && <b>{ext.slice(0, 4)}</b>}</span>
      <div className="vc-filecard-txt">
        <a className="vc-filecard-name" href={dl} download={name} onClick={open} title={name}>{name}</a>
        <small>{[KIND_OF(ext), fmtSize(a.size)].filter(Boolean).join(' - ')}</small>
      </div>
      <a className="vc-filecard-dl" href={dl} download={name} onClick={open} title={`Download ${name}`}><Download size={16} /><span>Download</span></a>
    </div>
  );
}
function Attachments({ list: all, extra = [], m }) {
  // an Ember server deletes uploads after the time its settings keep them; the message keeps a note
  const gone = all.filter(a => a.expired), list = all.filter(a => !a.expired);
  // spoilered files stay covered until clicked (once per file)
  const [revealed, setRevealed] = useState(() => new Set());
  const hidden = a => isSpoiler(a) && !revealed.has(a.url);
  const reveal = a => setRevealed(x => new Set(x).add(a.url));
  // picture links in the text count too (a Klipy link = a GIF; a DM's catbox link carries its name, so its spoiler mark too)
  const pics = [...list.filter(a => a.type === 'image' || a.type === 'gif'), ...extra.map(u => ({ url: u, name: nameInLink(u) || undefined, type: KLIPY.test(u) || /\.gif(\?|$)/i.test(u) ? 'gif' : 'image' }))];
  const others = list.filter(a => a.type !== 'image' && a.type !== 'gif');
  if (!pics.length && !others.length && !gone.length) return null;
  const cover = a => hidden(a) && (
    <button type="button" className="vc-att-spoiler-cover" onClick={e => { e.preventDefault(); e.stopPropagation(); reveal(a); }}>Spoiler</button>
  );
  return (
    <div className="vc-atts-wrap">
      {gone.map(a => <div key={a.url} className="vc-filecard vc-att-expired"><FileIcon size={18} /><span><b>{a.name || 'File'}</b><small>This file expired and was deleted.</small></span></div>)}
      {pics.length > 0 && (
        <div className={`vc-atts n${Math.min(pics.length, 4)}`}>
          {pics.map((a, i) => (KLIPY_PAGE.test(a.url) ? <KlipyPageGif key={a.url} url={a.url} /> :
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" data-media-url={a.url} data-media-name={shownName(a.name)} className={`vc-att${a.type === 'gif' ? ' gif' : ''}${hidden(a) ? ' spoiler' : ''}`}
              onClick={e => { if (hidden(a)) { e.preventDefault(); reveal(a); return; } if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; if (e.target.closest('.vc-star')) return; e.preventDefault(); viewMedia({ items: pics.filter(p => !hidden(p) || p === a), index: pics.filter(p => !hidden(p) || p === a).indexOf(a), author: m?.author, at: m?.created_at }); }}>
              <img src={a.url} alt={hidden(a) ? 'Spoiler' : shownName(a.name)} loading="lazy" />
              {cover(a)}
              {a.type === 'gif' && !hidden(a) && <GifBadge />}
              {hidden(a) ? null : KLIPY.test(a.url) ? <StarButton gif={{ url: a.url, preview: a.url, title: a.name, width: a.width, height: a.height }} />
                : /^https:\/\/(velora\.ikelene\.net\/uploads|files\.catbox\.moe)\//.test(a.url) && <button type="button" className="vc-att-save" title="Save to Saved Media" onClick={e => { e.preventDefault(); e.stopPropagation(); saveToMedia(a.url, a.name); }}><BookmarkPlus size={15} /></button>}
            </a>
          ))}
        </div>
      )}
      {others.map(a => {
        const inner = a.type === 'file' ? <FileCard a={a} /> : a.type === 'video'
          ? <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><VideoPlayer className="vc-att-video" src={a.url} /></div>
          : a.type === 'audio'
            ? <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><AudioPlayer src={a.url} name={shownName(a.name)} /></div>
            : <a href={a.url} target="_blank" rel="noopener noreferrer" className="vc-file">{shownName(a.name) || a.url}</a>;
        return hidden(a) ? <div key={a.url} className="vc-att-spoiler-box">{inner}{cover(a)}</div> : <Fragment key={a.url}>{inner}</Fragment>;
      })}
    </div>
  );
}
// a message whose files are still on their way up: how far along, and a way to stop it
function UploadBar({ m, view }) {
  const { sent, total } = m.uploading;
  const pct = Math.min(100, Math.floor((sent / total) * 100));
  const n = m.uploads.length;
  return (
    <div className="vc-upload-bar">
      <div className="vc-upload-bar-top">
        <span>{pct >= 100 ? 'Finishing upload...' : `Uploading ${n === 1 ? shownName(m.uploads[0].file.name) : `${n} files`}`}</span>
        <small>{fmtSize(Math.min(sent, total))} / {fmtSize(total)} - {pct}%</small>
        <button type="button" title="Cancel upload" onClick={() => dropFailed(view, m.nonce)}><X size={14} /></button>
      </div>
      <div className="vc-upload-track"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// the one-line quote in a reply preview: drawn by the same renderer as normal messages (custom + standard emojis, markdown,
// mentions), cut to one line by the CSS. A link that gets a card (a server invite, a payment) is named instead of shown raw.
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]]/g;
function ReplyText({ body, ctx }) {
  const nodes = useMemo(() => {
    let t = inviteSummary(String(body || '')).replace(/<[^<>]*$/, ''); // (the server cuts long quotes: drop a half-cut <:emoji:id> / <@role>)
    t = t.replace(/```([\s\S]*?)```/g, (_, c) => `\`${c.trim().replace(/`/g, "'")}\``);
    t = t.replace(URL_IN_TEXT, u => { const l = embedLabel(u); return l ? `*${l}*` : u; });
    t = t.replace(/\s*\n\s*/g, ' ').trim().replace(/^(?:#{1,3}\s+|-#\s+|>>>?\s+|[-*]\s+|\d{1,3}[.)]\s+)/, '');
    return t ? renderBody(t, { ...ctx, bio: true, linkImages: false }).nodes : null;
  }, [body, ctx]);
  return (
    <span className="vc-reply-text" onClickCapture={e => { if (e.target.closest('a')) { e.preventDefault(); e.stopPropagation(); } }}>
      {nodes && nodes.length ? nodes : 'a picture'}
    </span>
  );
}

// phones / tablets: no keyboard shortcuts, so editing gets Cancel and Save buttons and Enter makes a new line
const touchEdit = () => !!window.bonfireMobile || !!window.matchMedia?.('(pointer: coarse)').matches;
function EditMessageInput({ m, view, onSave, onCancel }) {
  const touch = touchEdit();
  const input = useRef(null);
  const composing = useRef(false);
  const [mq, setMq] = useState(null);
  const [sel, setSel] = useState(0);
  const items = useSuggestItems(view, mq);
  const sid = view.kind === 'channel' ? view.sid : null;

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    fill(el, decodeRoleMentions(m.body, sid), view);
    styleMarkdown(el, view);
    el.focus();
    caretToEnd(el);
    if (touch) { el.scrollIntoView?.({ block: 'nearest' }); setTimeout(() => { if (document.activeElement !== el) { el.focus(); caretToEnd(el); } el.scrollIntoView?.({ block: 'nearest' }); }, 120); }
  }, [m.id, m.body, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(e) {
    if (composing.current) return;
    const el = input.current;
    if (e?.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ':') {
      const caret = caretText(el);
      const match = caret && /(^|\s)(:[A-Za-z0-9_+-]{1,40}:)$/.exec(caret.before);
      const token = match && resolveWord(match[2], view);
      if (token) replaceBeforeCaret(el, match[2].length, token, sid, false);
    }
    if (e?.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ' ') {
      const caret = caretText(el);
      const match = caret && /(^|\s)(@[\w.-]{2,32}|#[a-z0-9_-]{1,40}|:[A-Za-z0-9_]{1,32}:)\s$/.exec(caret.before);
      const token = match && resolveWord(match[2], view);
      if (token) replaceBeforeCaret(el, match[2].length + 1, token, sid, true);
    }
    styleMarkdown(el, view);
    const caret = caretText(el);
    setMq(caret ? suggestQuery(caret.before, caret.before.length) : null);
    setSel(0);
  }
  function pick(it) {
    const el = input.current;
    if (!el || !mq) return;
    const token = it.token || (it.kind === 'role' ? `<@&${it.role.rid}>` : it.insert.trim());
    if (!replaceBeforeCaret(el, mq.q.length + 1, token, sid)) insertAt(el, null, token, sid);
    styleMarkdown(el, view);
    setMq(null);
    el.focus();
  }
  // (the Android app blurs any contenteditable="true" .vc-input it didn't focus itself, which kept the keyboard from ever
  // staying open here - "plaintext-only" isn't matched by that rule, and Chromium WebView supports it)
  return (
    <div className="vc-edit">
      {mq && <MentionPicker items={items} sel={sel} setSel={setSel} onPick={pick} sid={sid} />}
      <div ref={input} className="vc-input vc-edit-input" contentEditable={window.bonfireMobile ? 'plaintext-only' : true} suppressContentEditableWarning role="textbox" aria-label="Edit message" aria-multiline="true"
        spellCheck autoCorrect="on" autoCapitalize="sentences" onInput={update}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; update(); }}
        onBlur={() => setTimeout(() => setMq(null), 150)}
        onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
        onKeyDown={e => {
          if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
          const marker = markdownMarker(e);
          if (marker) { e.preventDefault(); markdownShortcut(input.current, view, marker); styleMarkdown(input.current, view); return; }
          if (mq && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(x => (x + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(x => (x - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[sel] || items[0]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setMq(null); return; }
          }
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey || touch) { document.execCommand('insertLineBreak'); setMq(null); } else onSave(serialize(input.current)); }
          if (e.key === 'Escape') onCancel();
        }} />
      {touch
        ? <div className="vc-edit-btns on"><button type="button" className="cancel" onMouseDown={e => e.preventDefault()} onClick={onCancel}>Cancel</button><button type="button" className="save" onMouseDown={e => e.preventDefault()} onClick={() => onSave(serialize(input.current))}>Save</button></div>
        : <div className="vc-edit-foot"><small>Escape to cancel, Enter to save, Shift+Enter for a new line. Ctrl/Cmd+B, I, U; Ctrl/Cmd+Shift+S (strike), C (code).</small></div>}
    </div>
  );
}

// Identity for grouping consecutive messages: a CloudLink/webhook/bridge sender must never merge with an Ember user who happens to share the name.
function authorKey(a) {
  if (!a) return '';
  return [a.bridge || (a.webhook ? 'hook' : 'user'), a.bridge_from || '', a.username || ''].join('');
}

// Velora people on an instance server can sign what they send. A message from one that carries no signature can't be tied to
// their account, so it is shown without their picture or colours. (Local accounts, bots, webhooks, system lines and Velora's own
// servers - whose messages live on Velora itself - are exempt.)
const isUnsigned = m => !!m.inst && m.author?.kind === 'velora' && !m.signature && !m.author.bot && !m.author.webhook && !m.system && (!m.pending || m.unsigned) && !m.ephemeral;
// 'unsigned' | 'bad' | null: should this message's author picture / colour be withheld?
function useDistrust(m) {
  const v = useChat(s => (m.signature ? s.sigs[sigId(m)] : null));
  return v === 'bad' ? 'bad' : isUnsigned(m) ? 'unsigned' : null;
}
// a signed message is checked here against the author's Velora key (never taken from the instance's word). A good signature
// shows nothing (that's the normal case); a bad one and an unsigned Velora message are marked.
// (inside a stack only a bad signature is marked: a stack never mixes signed and unsigned messages, so its head has the shield)
function SigBadge({ m, inStack }) {
  const v = useChat(s => (m.signature ? s.sigs[sigId(m)] : null));
  if (v === 'bad') return <span className="vc-sig bad" title="Signature doesn't match"><TriangleAlert size={14} /></span>;
  if (!inStack && isUnsigned(m)) return <span className="vc-sig unsigned" title={`Sent unsigned - Velora can't confirm this came from ${m.author.username}`}><Shield size={14} /></span>;
  return null;
}
function Message({ m, head, ctx, canMod, onReply, onUser: openUser, editing, setEditing, view, fresh }) {
  const hook = !!m.author?.webhook;
  // on an instance: Velora people get their Velora profile, local accounts / bots a plain card (never a Velora lookup by name)
  const onUser = (name, el) => openUser(name, el, 'right', m.inst ? m.author : undefined);
  const author = useFace(m.author); // a Velora person on an instance: their live Velora picture / colour / rank
  const replyAuthor = useFace(useMemo(() => (m.reply?.author && m.inst ? { ...m.reply.author, inst: m.inst } : m.reply?.author), [m.reply?.author, m.inst]));
  useEffect(() => { if (m.inst && m.author?.kind === 'velora') wantVeloraFaces([m.author]); }, [m.inst, m.author?.velora_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // replies work in channels you can post in, DMs (not Velora's notices) and group chats
  const canReplyHere = !m.system && !m.ephemeral && (view.kind === 'channel' ? ctx.canPost : view.kind === 'group' ? !!m.gid : view.username !== 'System' && !!m.imId);
  // reactions: server channels, real (saved) messages
  const canReact = !m.pending && !m.system && !m.ephemeral && ((view.kind === 'channel' && /^\d+$/.test(String(m.id))) || (view.kind === 'dm' && view.username !== 'System' && !!m.imId));
  const reactId = m.imId ? `dm:${m.imId}` : m.id;
  const starHere = useStarboardFor(view.sid, view.cid) && canReact && view.kind === 'channel';
  const starred = starHere && starredByMe(m, ctx.me);
  const forward = () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'forward', message: m, from: view } }));
  const togglePin = () => apiFetch(`/chat/messages/${m.id}/pin`, { method: m.pinned ? 'DELETE' : 'PUT', inst: instOpt(m.channel) }).then(() => toast(m.pinned ? 'Unpinned.' : 'Pinned.', true)).catch(e => toast(errorText(e.message)));
  const mine = !hook && isMineMsg(m);
  const { nodes, images, media, jumbo, links, invites } = useMemo(() => renderBody(m.body, ctx), [m.body, ctx]);
  const mentionsMe = isMention(m);
  const nameKey = useNameStyle(view.sid, author);
  const distrust = useDistrust(m);
  // pronouns come from the viewer's own profile lookup (friends-only profiles hide them), not the broadcast author object
  const pronouns = usePronouns(m.author?.username, !!head && !hook && !m.system && !m.author?.bot && !!m.author?.username && m.author.username !== 'System' && m.author?.kind !== 'local');
  async function saveEdit(value) {
    const t = view.sid ? encodeRoleMentions(value.trim(), view.sid) : value.trim();
    setEditing(null);
    if (t === m.body.trim()) return;
    try { await editMessage(m.id, t, m); } catch (e) { toast(errorText(e.message)); }
  }
  async function remove(e) {
    if (!e.shiftKey && !(await ask({ title: 'Delete this message?', text: 'Tip: hold Shift while clicking delete to skip this.', confirm: 'Delete', danger: true }))) return;
    try { await deleteMessage(view, m); } catch (er) { toast(errorText(er.message)); }
  }
  // DM calls leave a line: "[Voice call] started a call" / "call ended - 3 minutes" / "missed call",
  // sent by the caller and shared by both people - worded from the viewer's side (callText.js)
  const callLine = !m.system && CALL_LINE.test(m.body || '') && callLineText(m.body, { caller: m.author?.username, me: ctx.me, other: view.kind === 'dm' ? view.username : null });
  if (callLine) {
    return (
      <div className={`vc-msg vc-sys k-call${callLine.missed ? ' missed' : ''} vl-in`}>
        <span className="vc-sys-ico"><Phone size={14} /></span>
        <div className="vc-sys-body">{callLine.before}{callLine.name && <b>{callLine.name}</b>}{callLine.after}<span className="vc-time">{stampOf(m.created_at)}</span></div>
      </div>
    );
  }
  // Ember Link: joins / leaves / deaths / advancements from Minecraft are compact rows
  if (m.author?.bridge === 'minecraft' && /^mc_/.test(m.sys_kind || '')) return <GameEventLine m={m} />;
  if (m.ephemeral && !m.interaction_id) {
    return (
      <div className="vc-msg vc-sys vc-eph vl-in">
        <span className="vc-sys-ico"><Coins size={15} /></span>
        <div className="vc-sys-body">{m.body}<span className="vc-eph-tag">Only you can see this - <a href="/me#chat" target="_blank" rel="noopener noreferrer">turn these off</a></span></div>
      </div>
    );
  }
  if (m.system) {
    return (
      <div className={`vc-msg vc-sys vl-in${m.sys_kind ? ` k-${m.sys_kind}` : ''}`}>
        <span className="vc-sys-ico">{m.sys_kind === 'join' ? <ArrowRight size={15} /> : m.sys_kind === 'leave' ? <ArrowLeft size={15} /> : m.sys_kind === 'pin' ? <Pin size={14} /> : <CornerUpRight size={14} />}</span>
        <div className="vc-sys-body">{nodes}{m.sys_kind === 'pin' && <> <button type="button" className="vc-sys-link" onClick={() => dispatchEvent(new Event('vc-open-pins'))}>See all pinned messages</button></>}<span className="vc-time">{stampOf(m.created_at)}</span></div>
      </div>
    );
  }
  const name = m.author?.username || 'Unknown';
  return (
    <div className={`vc-msg${head ? ' head' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${mentionsMe ? ' mention' : ''}${editing ? ' editing' : ''} ${fresh === 'live' ? (isMineMsg(m) ? 'vc-in-mine' : 'vc-in-live') : fresh === 'done' ? '' : 'vl-in'}`} data-id={m.id}
      onContextMenu={e => {
        if (e.target.closest('textarea, input, [contenteditable]') || m.pending) return;
        if (!hook && e.target.closest('.vc-msg-av, .vc-msg-name')) { const el = e.target.closest('.vc-msg-av, .vc-msg-name'); userMenu(e, name, { sid: view.sid, onProfile: () => onUser(name, el) }); return; }
        if (m.ephemeral) { openMenu(e, [{ label: 'Dismiss message', icon: X, onClick: () => dismissEphemeral(view, m) }]); return; }
        const reactionAnchor = e.currentTarget.getBoundingClientRect();
        messageMenu(e, m, view, {
          canReply: canReplyHere, onReply: () => onReply(m), onEdit: () => setEditing(m.id), onForward: forward,
          canPin: view.kind === 'channel' && canMod && !hook, onPin: togglePin,
          canDelete: (mine || canMod) && view.kind !== 'group', onDelete: () => remove({ shiftKey: false }),
          onReact: canReact ? () => openReactionPicker(reactId, reactionAnchor, instOpt(m.channel)) : null,
        });
      }}>
      {m.statusReply && (
        <div className="vc-reply-to vc-status-reply">
          <span className="vc-reply-line" />
          <MessageSquareQuote size={13} />
          <b>{m.author?.username === ctx.me ? 'You replied to their status' : 'Replied to your status'}</b>
          <span className="vc-sr-quote">{m.statusReply}</span>
        </div>
      )}
      {m.reply && (
        <div className="vc-reply-to" onClick={() => document.querySelector(`.vc-msg[data-id="${m.reply.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <span className="vc-reply-line" />
          {replyAuthor ? <Avatar user={replyAuthor} size={16} /> : null}
          <b style={replyAuthor?.color ? { color: replyAuthor.color } : undefined}>{replyAuthor?.username || 'Velora'}</b>
          <ReplyText body={m.reply.body} ctx={ctx} />
        </div>
      )}
      <InteractionLine m={m} />
      {head ? (
        hook ? <span className="vc-msg-av hook">{m.author.pfp ? <img src={m.author.pfp} alt="" /> : m.author.bridge ? <span className="vc-av-l">{(m.author.username || '?')[0].toUpperCase()}</span> : <Webhook size={20} />}</span>
          : <button type="button" className="vc-msg-av" onClick={e => onUser(name, e.currentTarget)}><Avatar user={distrust ? { ...author, pfp: null } : author} size={40} /></button>
      ) : (
        <span className="vc-msg-gut">{timeOf(m.created_at)}</span>
      )}
      <div className="vc-msg-main">
        {head && (
          <div className="vc-msg-head">
            {hook ? <><span className="vc-msg-name hook">{name}</span>{m.author.staff ? <><span className="vc-app-tag staff">STAFF</span>{m.staffBy && <small className="vc-staff-by">sent by {m.staffBy} (only staff see this)</small>}</> : m.author.bridge === 'cloudlink' ? <><span className="vc-app-tag cl" title="This message came in over the channel's CloudLink bridge.">CLOUDLINK</span>{m.author.bridge_from && <span className="vc-game-tag" title="The chat it came from before CloudLink">{m.author.bridge_from}</span>}</> : m.author.bridge ? <><span className="vc-plat-tag" title={m.author.bridge === 'minecraft' ? 'Sent from the linked Minecraft server.' : `This message was sent from the linked ${PLATFORM_NAMES[m.author.bridge] || m.author.bridge} community.`}><PlatformIcon p={m.author.bridge} size={16} /></span>{m.author.bridge_from && <span className="vc-game-tag" title="The server it was sent from">{m.author.bridge_from}</span>}</> : <span className="vc-app-tag">APP</span>}</> : <>
            <button type="button" className="vc-msg-name" style={colorFrom(nameKey) && !distrust ? { color: colorFrom(nameKey) } : undefined} onClick={e => onUser(name, e.currentTarget)}>{name}</button>
            <NameDecor sid={view.sid} user={author} />{m.author?.bot && <BotTag verified={!!m.author.verified} />}<SigBadge m={m} />{m.via && <ViaBadge via={m.via} />}</>}
            {pronouns && <span className="vc-pronouns" title="Pronouns">{pronouns}</span>}
            <span className="vc-time" title={new Date(m.created_at).toLocaleString()}>{stampOf(m.created_at)}</span>
            {m.pinned && <span className="vc-pinned-mark" title="Pinned"><Pin size={12} /></span>}
          </div>
        )}
        {m.interaction?.thinking ? <Thinking m={m} /> : editing ? <EditMessageInput m={m} view={view} onSave={saveEdit} onCancel={() => setEditing(null)} /> : (
          (nodes.length > 0) && <div className={`vc-text${jumbo ? ' jumbo' : ''}`}>{nodes}{!head && <SigBadge m={m} inStack />}{m.edited_at && <span className="vc-edited" title={stampOf(m.edited_at)}>(edited)</span>}</div>
        )}
        <GameInvites invites={invites} />
        <Embeds list={m.embeds} ctx={ctx} />
        {!m.embeds?.length && !m.pending && <LinkEmbeds urls={links} inst={instOpt(m.channel)} />}
        <Attachments list={[...(m.attachments || []), ...media]} extra={images} m={m} />
        {m.uploading && <UploadBar m={m} view={view} />}
        <Reactions m={m} me={ctx.me} canReact={canReact} />
        <MessageComponents m={m} view={view} />
        {m.ephemeral && <EphemeralNote m={m} view={view} />}
        {m.failed && (
          <div className="vc-fail"><AlertCircle size={13} /> {view.kind === 'dm' ? dmErrorText(m.failed) : errorText(m.failed)}
            <button type="button" onClick={() => { dropFailed(view, m.nonce); sendMessage(view, m.body, m.uploads ? { replyTo: m.replyTo, attachments: m.ready, uploads: m.uploads } : { replyTo: m.reply, attachments: m.attachments }); }}>Try again</button>
            <button type="button" onClick={() => dropFailed(view, m.nonce)}>Remove</button>
          </div>
        )}
      </div>
      {!m.pending && !m.failed && !editing && !m.ephemeral && (
        <div className="vc-tools">
          {canReact && <><QuickReactions id={reactId} inst={instOpt(m.channel)} selected={(m.reactions || []).filter(r => r.users?.includes(ctx.me)).map(r => r.emoji)} onDone={() => {}} limit={3} className="vc-tools-react" sid={view.kind === 'channel' ? view.sid : null} /><button type="button" title="Add reaction" onClick={e => openReactionPicker(reactId, e.currentTarget, instOpt(m.channel))}><SmilePlus size={16} /></button><span className="vc-tools-sep" aria-hidden="true" /></>}
          {starHere && <button type="button" title={starred ? 'Take your star back' : 'Star it (for the starboard)'} className={`vc-star-tool${starred ? ' on' : ''}`} onClick={() => setReaction(m.id, STAR, !starred, instOpt(m.channel))}><Star size={15} fill={starred ? 'currentColor' : 'none'} /></button>}
          {canReplyHere && <button type="button" title="Reply" onClick={() => onReply(m)}><Reply size={16} /></button>}
          {mine && (view.kind === 'channel' || (view.kind === 'dm' && m.imId)) && <button type="button" title="Edit" onClick={() => setEditing(m.id)}><Pencil size={15} /></button>}
          {(mine || canMod) && view.kind !== 'group' && <button type="button" className="danger" title="Delete (shift-click: no question)" onClick={remove}><Trash2 size={15} /></button>}
        </div>
      )}
    </div>
  );
}

const motionOK = el => { try { return !el.closest('.vc.still') && !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function MessageList({ view, onUser, onReply, canPost, canMod, channels, title }) {
  const key = keyOf(view);
  const box = useChat(s => s.msgs[key]);
  const me = useChat(s => (view.sid && isInst(view.sid) ? s.instances.find(i => i.origin === instOf(view.sid))?.user?.username : s.me?.username)); // who I am in this conversation (an instance has its own account for me)
  const scroller = useRef(null);
  const stick = useRef(true);
  const prevH = useRef(0);
  const [editing, setEditing] = useState(null);
  // a message that is still sending stays out of sight until the server has it (then it appears and animates in once); failed ones and uploads with progress show
  const list = useMemo(() => (box?.list || []).filter(m => !m.pending || m.failed || m.uploading || m.uploads), [box?.list]);
  const linkImages = useChat(s => s.settings.link_images);
  const roles = useChat(s => (view.sid ? s.detail[view.sid]?.roles : null));
  const ctx = useMemo(() => ({
    me, canPost, channels, linkImages, roles,
    onUser: (u, el) => onUser(u, el),
    onChannel: c => go({ kind: 'channel', sid: view.sid, cid: c.cid }),
    onLink: openLink,
  }), [me, canPost, channels, view.sid, linkImages, roles]); // eslint-disable-line react-hooks/exhaustive-deps

  // opening a conversation always starts at the bottom; unread messages get a "New" line and a banner at the top
  // to jump up to them (it goes away by itself after 5 s if you leave it)
  const jump = useRef(null);
  const lastKey = useRef(null);
  const [newFrom, setNewFrom] = useState(null);
  const [unreadBar, setUnreadBar] = useState(null); // { id, count, at }
  useLayoutEffect(() => { jump.current = takeJump(key); setNewFrom(null); setUnreadBar(null); }, [key]);
  // (the countdown is the thin line along its bottom - a CSS animation that pauses while you hover it)
  useEffect(() => {
    if (!unreadBar?.out) return undefined;
    const t = setTimeout(() => setUnreadBar(null), 220);
    return () => clearTimeout(t);
  }, [unreadBar?.out]);
  function jumpToUnread() {
    const el = scroller.current;
    const row = el?.querySelector(`.vc-msg[data-id="${unreadBar?.id}"]`);
    setUnreadBar(null);
    if (!row) return;
    stick.current = false;
    el.scrollTo({ top: Math.max(0, row.offsetTop - 56), behavior: 'smooth' });
  }
  // keep the view at the bottom while you're at the bottom; keep your place when older ones load
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const last = list[list.length - 1];
    const lk = last ? (last.nonce || last.id) : null;
    // you just sent something: always go to the bottom
    if (last && lk !== lastKey.current && last.author?.username === me && (last.pending || Date.now() - last.created_at < 15000)) stick.current = true;
    lastKey.current = lk;
    if (jump.current && box?.loaded && list.length) {
      const j = jump.current;
      jump.current = null;
      const first = j.count ? list.filter(m => m.author?.username !== me).slice(-j.count)[0] : list.find(m => !m.pending && /^\d+$/.test(String(m.id)) && BigInt(m.id) > BigInt(j.after || 0) && m.author?.username !== me);
      if (first) {
        setNewFrom(first.id);
        const at = list.indexOf(first);
        const count = list.slice(at).filter(m => m.author?.username !== me).length;
        // only worth a banner when the first new one isn't already on screen at the bottom
        requestAnimationFrame(() => {
          const row = el.querySelector(`.vc-msg[data-id="${first.id}"]`);
          if (row && row.offsetTop < el.scrollHeight - el.clientHeight - 40) setUnreadBar({ id: first.id, count, at: Date.now() });
        });
      }
    }
    // The pinned view jumps straight to the new bottom; the column then starts that far below and glides back up (FLIP): the
    // rows already on screen rise by the new message's height and the new row comes up from under the list, i.e. out of the
    // composer. The column sits inside an overflow:clip box so its transform can't inflate scrollHeight (that made the
    // resize / scroll handlers fight the glide). A second message mid-glide carries on from where the first had got to.
    const col = column.current, colNow = col?.offsetHeight || 0, grew = colNow - colH.current;
    colH.current = colNow;
    const glide = liveNew.current && stick.current && grew > 0 && colNow - grew > 0 && col.animate && motionOK(el);
    liveNew.current = false;
    if (prevH.current && el.scrollTop < 80 && !stick.current) el.scrollTop += el.scrollHeight - prevH.current;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    if (glide) {
      let from = Math.min(grew, el.clientHeight);
      if (slide.current) { try { from += new DOMMatrix(getComputedStyle(col).transform).m42; } catch { /* none */ } slide.current.cancel(); }
      const an = col.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }], { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      slide.current = an;
      an.onfinish = an.oncancel = () => { if (slide.current === an) slide.current = null; };
    }
    prevH.current = el.scrollHeight;
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stick.current = true; prevH.current = 0; lastKey.current = null; setEditing(null); }, [key]);
  // pictures, embeds and link previews finish loading after the message lands: stay at the bottom if you were there
  const content = useRef(null);
  useEffect(() => {
    const el = scroller.current, inner = content.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; prevH.current = el.scrollHeight; colH.current = column.current?.offsetHeight || 0; });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [key]);
  useEffect(() => {
    const go2 = e => { if (e.detail && e.detail !== key) return; stick.current = true; const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; };
    addEventListener('vc-sent', go2);
    return () => removeEventListener('vc-sent', go2);
  }, [key]);
  useEffect(() => {
    // Up arrow in an empty composer edits your last message
    const onEditLast = () => {
      const last = [...list].reverse().find(m => m.author?.username === me && !m.pending && !m.system);
      if (last && (view.kind === 'channel' || (view.kind === 'dm' && last.imId))) setEditing(last.id);
    };
    addEventListener('vc-edit-last', onEditLast);
    return () => removeEventListener('vc-edit-last', onEditLast);
  }, [list, me, view.kind]);
  function onScroll() {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    prevH.current = el.scrollHeight;
    if (el.scrollTop < 120 && box?.hasMore && !box.loading) loadMessages(view, { older: true });
  }
  // images loading in push the bottom down: stay stuck
  function onLoadCapture() { if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }

  // messages that arrive while the conversation is open slide in (mine from the composer); everything loaded with it, or
  // older history scrolled in, just appears. A row is "fresh" for a moment so a re-render doesn't cut its animation short.
  const known = useRef({ key: null, at: new Map() });
  const liveNew = useRef(false); // a live message was just added: slide the rows above it up with it
  const column = useRef(null), slide = useRef(null), colH = useRef(0);
  if (known.current.key !== key || !box?.loaded) known.current = { key, at: new Map() };
  const seen = known.current.at;
  const firstPass = seen.size === 0;
  let newest = 0;
  for (const e of seen.values()) if (e.t > newest) newest = e.t;
  const nowMs = Date.now();
  const isFresh = m => {
    const id = m.nonce || m.id;
    let e = seen.get(id);
    // not seen before: appended after what I already had = live; the first load, or older pages scrolled in = not
    if (!e) { if (!firstPass && (m.created_at || 0) >= newest - 5000) liveNew.current = true; e = { live: !firstPass && (m.created_at || 0) >= newest - 5000, born: nowMs, t: m.created_at || 0 }; seen.set(id, e); }
    return !e.live ? 'init' : nowMs - e.born < 700 ? 'live' : 'done';
  };
  const rows = [];
  let prev = null;
  for (const m of list) {
    const day = new Date(m.created_at).toDateString();
    if (!prev || new Date(prev.created_at).toDateString() !== day) rows.push(<div className="vc-day" key={`d${day}`}><span>{dayOf(m.created_at)}</span></div>);
    const head = !prev || m.system || prev.system || /^mc_/.test(prev.sys_kind || '') || m.reply || m.interaction || m.statusReply || authorKey(prev.author) !== authorKey(m.author) || isUnsigned(prev) !== isUnsigned(m) || m.created_at - prev.created_at > GROUP_MS || new Date(prev.created_at).toDateString() !== day;
    if (newFrom && m.id === newFrom) rows.push(<div className="vc-new-line" key="new-line"><span>New</span></div>);
    rows.push(<Message key={m.nonce || m.id} fresh={isFresh(m)} m={m} head={head} ctx={ctx} canMod={canMod} onReply={onReply} onUser={onUser} editing={editing === m.id} setEditing={setEditing} view={view} />);
    prev = m;
  }
  return (
    <div className="vc-scroll" ref={scroller} onScroll={onScroll} onLoadCapture={onLoadCapture}>
      {unreadBar && (
        <div className={`vc-unread-bar${unreadBar.out ? ' out' : ''}`}>
          <button type="button" className="vc-unread-go" onClick={jumpToUnread}>
            <span>{unreadBar.count >= 50 ? '50+' : unreadBar.count} new message{unreadBar.count === 1 ? '' : 's'}</span>
            <b>Jump to unread <ChevronUp size={14} /></b>
          </button>
          <button type="button" className="vc-unread-x" title="Dismiss" onClick={() => setUnreadBar(null)}><X size={14} /></button>
          <i className="vc-unread-time" onAnimationEnd={() => setUnreadBar(b => (b ? { ...b, out: true } : b))} />
        </div>
      )}
      <div className="vc-msgs" ref={content}><div className="vc-msgs-col" ref={column}>
        {box?.loaded && !box.hasMore && (
          <div className="vc-start vl-in">
            <div className="vc-start-ico">{title.icon}</div>
            <h2>{title.big}</h2>
            <p>{title.sub}</p>
          </div>
        )}
        {box?.loading && <div className="vc-loading"><i /><i /><i /></div>}
        {box?.error && <div className="vc-empty-note">Couldn't load these messages ({errorText(box.error)}).</div>}
        {rows}
      </div></div>
    </div>
  );
}

export function Typing({ view }) {
  const show = useChat(s => s.settings.show_typing);
  const t = useChat(s => (show ? s.typing[keyOf(view)] : null));
  const people = useChat(s => s.people);
  const now = Date.now();
  const names = Object.entries(t || {}).filter(([, until]) => until > now).map(([n]) => n);
  return (
    <div className={`vc-typing${names.length ? ' on' : ''}`} aria-live="polite">
      {names.length > 0 && <span className="vc-ch-typing-avs">{names.slice(0, 3).map(u => <Avatar key={u} user={{ username: u, pfp: people[u]?.pfp }} size={18} />)}</span>}
      {names.length > 0 && <span className="vc-dots"><i /><i /><i /></span>}
      {names.length === 1 && <span><b>{names[0]}</b> is typing...</span>}
      {names.length === 2 && <span><b>{names[0]}</b> and <b>{names[1]}</b> are typing...</span>}
      {names.length > 2 && <span>Several people are typing...</span>}
    </div>
  );
}

// unsent drafts, per conversation: kept across channel switches and page reloads (this browser, this account)
const draftKey = () => `velora_chat_drafts_${getState().me?.username || ''}`;
let draftMem = null;
function draftsAll() {
  if (!draftMem) { try { draftMem = JSON.parse(localStorage.getItem(draftKey()) || '{}') || {}; } catch { draftMem = {}; } }
  return draftMem;
}
let draftTimer = null;
function setDraft(key, v) {
  const all = draftsAll();
  if (v.trim()) all[key] = v.slice(0, 4000); else delete all[key];
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { try { localStorage.setItem(draftKey(), JSON.stringify(all)); } catch { /* full / blocked */ } }, 300);
}
addEventListener('beforeunload', () => { if (draftMem) try { localStorage.setItem(draftKey(), JSON.stringify(draftMem)); } catch { /* fine */ } });

export function Composer({ view, placeholder, locked: lockedBy, lockedText, replyTo, setReplyTo }) {
  const timedOut = useTimedOut(view.kind === 'channel' ? view.sid : null); // (on an instance: a timeout hides the box until it ends)
  const locked = lockedBy || !!timedOut;
  const [text, setText] = useState('');
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(0);
  const ta = useRef(null); // the contenteditable box
  const composing = useRef(false);
  const mobileTextInput = () => !!window.bonfireMobile || window.matchMedia('(pointer: coarse)').matches;
  const saved = useRef(null); // the caret, kept while a picker has focus
  const file = useRef(null);
  const key = keyOf(view);
  const uploadContext = useRef({ key, pending: 0 });
  if (uploadContext.current.key !== key) uploadContext.current = { key, pending: 0 };
  const srDraft = useChat(s => s.statusReplyDraft);
  const srActive = !!srDraft && view.kind === 'dm' && String(view.username).toLowerCase() === srDraft.username.toLowerCase() ? srDraft : null;
  useEffect(() => { if (!srActive) clearStatusReply(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (srActive) ta.current?.focus(); }, [srActive]);
  useEffect(() => { const f = () => ta.current?.focus(); addEventListener('vc-focus-composer', f); return () => removeEventListener('vc-focus-composer', f); }, []);
  const sid = view.kind === 'channel' ? view.sid : null;
  const canAttach = useChat(s => (view.kind === 'channel' ? canAttachInChannel(s.detail[view.sid], view.cid, s.members[view.sid], isInst(view.sid) ? s.instances.find(i => i.origin === instOf(view.sid))?.user?.username : s.me?.username) : true));
  const [mq, setMq] = useState(null); // the @word being typed
  const [cmd, setCmd] = useState(null); // the slash command being filled in
  const [csel, setCsel] = useState(0);
  const cmdSubmit = useRef(null);
  const cdata = useChat(s => (sid && isInst(sid) ? s.commands[sid] : null));
  useEffect(() => { if (sid && isInst(sid)) loadCommands(sid, view.cid); }, [sid, view.cid]); // eslint-disable-line react-hooks/exhaustive-deps
  const centries = useMemo(() => slashEntries(cdata), [cdata]);
  const slashQ = !cmd && text.startsWith('/') && !/\n|^\/\s/.test(text) ? text.slice(1) : null;
  const citems = useMemo(() => (slashQ == null ? [] : matchEntries(centries, slashQ)), [slashQ, centries]);
  function startCommand(entry) {
    if (ta.current) ta.current.textContent = '';
    setText(''); setDraft(key, ''); setCmd(entry); setCsel(0); setMq(null);
  }
  const [dropping, setDropping] = useState(false); // a file is being dragged over the window
  const saveFile = useRef(null);
  const [picker, setPicker] = useState(false);
  const [emoji, setEmoji] = useState(false);
  useEffect(() => {
    const keep = () => {
      const sel = getSelection();
      if (sel.rangeCount && ta.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', keep);
    return () => document.removeEventListener('selectionchange', keep);
  }, []);
  function sync() {
    const el = ta.current;
    if (!el) return '';
    let v = serialize(el);
    if (!v.trim() && !el.querySelector('[data-token]')) { if (el.childNodes.length) el.textContent = ''; v = ''; }
    setText(v);
    setDraft(key, v);
    return v;
  }
  // put an emoji where the cursor was
  function insertText(t) {
    const el = ta.current;
    if (!el) return;
    el.focus();
    insertAt(el, saved.current, t, sid);
    styleMarkdown(el, view);
    sync();
  }
  const [msel, setMsel] = useState(0);
  const mitems = useSuggestItems(view, mq);
  function pickMention(it) {
    const el = ta.current;
    if (!el || !mq) return;
    const token = it.token || (it.kind === 'role' ? `<@&${it.role.rid}>` : it.insert.trim());
    if (!replaceBeforeCaret(el, mq.q.length + 1, token, sid)) insertAt(el, saved.current, token, sid);
    styleMarkdown(el, view);
    setMq(null);
    sync();
    el.focus();
  }
  useEffect(() => { // each conversation keeps its own draft
    const el = ta.current;
    const saved = draftsAll()[key] || '';
    if (el) { fill(el, saved, view); styleMarkdown(el, view); }
    setText(saved);
    setCmd(null);
    setAtts(x => { x.forEach(a => a.preview && URL.revokeObjectURL(a.preview)); return []; }); setBusy(0);
    setTimeout(() => { if (ta.current && !mobileTextInput()) { ta.current.focus(); caretToEnd(ta.current); } }, 30);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  // what typed :names:, @people and #channels turn into needs to be loaded even if no picker was opened
  useEffect(() => { loadEmojiData()?.catch?.(() => {}); if (!getState().emojis) loadEmojis(); }, []);
  useEffect(() => { if (sid && !getState().members[sid]) loadMembers(sid); }, [sid]);
  function onInput(e) {
    const el = ta.current;
    if (composing.current || e.nativeEvent.isComposing) {
      const value = serialize(el);
      setText(value); setDraft(key, value); setMq(null);
      if (value.trim()) setTyping(view, true);
      return;
    }
    // a finished emoji (":name:") turns into the emoji as soon as the closing colon goes in
    if (e.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ':') {
      const c = caretText(el);
      const m = c && /(^|\s)(:[A-Za-z0-9_+-]{1,40}:)$/.exec(c.before);
      const token = m && resolveWord(m[2], view);
      if (token) replaceBeforeCaret(el, m[2].length, token, sid, false);
    }
    // a finished word ("@someone ", "#channel ", ":name: ") turns into its pill
    if (e.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ' ') {
      const c = caretText(el);
      const m = c && /(^|\s)(@[\w.-]{2,32}|#[a-z0-9_-]{1,40}|:[A-Za-z0-9_]{1,32}:)\s$/.exec(c.before);
      const token = m && resolveWord(m[2], view);
      if (token) replaceBeforeCaret(el, m[2].length + 1, token, sid, true);
    }
    if (!mobileTextInput()) styleMarkdown(el, view);
    const v = sync();
    if (e.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ' ' && /^\/\S+( \S+){0,2} $/.test(v)) {
      const hit = centries.find(en => en.label.toLowerCase() === v.slice(1).trim().toLowerCase());
      if (hit) { startCommand(hit); return; }
    }
    const c = caretText(el);
    setMq(c ? suggestQuery(c.before, c.before.length) : null); setMsel(0);
    if (v.trim()) setTyping(view, true);
  }
  function submit(askedAlready) {
    let t = (ta.current ? serialize(ta.current) : text).trim();
    if ((!t && !atts.length) || busy) return;
    // tracking junk in a link: ask once (first time), then clean silently when the setting is on
    const strip = getState().settings.strip_tracking;
    if (strip == null && !askedAlready && hasTracking(t)) { askStripTracking().then(() => submit(true)); return; }
    if (strip === true) t = cleanText(t);
    // an Ember server can lower the longest message (Server settings > Message rules)
    const maxLen = (view.kind === 'channel' && isInst(view.sid) && getState().detail[view.sid]?.server.max_message_length) || 4000;
    if (t.length > maxLen) { toast(maxLen < 4000 ? `Messages here can be up to ${maxLen.toLocaleString()} characters (this one is ${t.length.toLocaleString()}).` : errorText('message_too_long')); return; }
    // files picked here upload now, after the message is sent: the composer is free again straight away
    const queued = atts.filter(a => a.local);
    sendMessage(view, sid ? encodeRoleMentions(t, sid) : t, { replyTo, attachments: atts.filter(a => !a.local), uploads: queued.map(a => ({ file: a.file, spoiler: a.spoiler })) });
    queued.forEach(a => a.preview && URL.revokeObjectURL(a.preview));
    setMq(null);
    if (ta.current) ta.current.textContent = '';
    setText(''); setDraft(key, ''); setAtts([]); setReplyTo?.(null);
    ta.current?.focus({ preventScroll: true });
  }
  // the biggest file this conversation takes (MB): an instance community says so itself, the rest is Velora's limit
  function uploadCap() {
    return view.kind === 'channel' && isInst(view.sid) ? (getState().detail[view.sid]?.server.my_upload_max_mb || getState().detail[view.sid]?.server.upload_max_mb || 25) : getUploadLimits().server_mb; // (my_: with my roles)
  }
  // dropped / pasted / picked files wait in the tray (checked against the size limit now) and only upload when the message is
  // sent - see sendMessage's uploads. Everything goes to catbox.moe through Velora (catbox never sees you), or to the instance.
  function addFiles(files) {
    const context = uploadContext.current;
    if (locked || (view.kind === 'channel' && !canAttach) || view.username === 'System') return;
    const cap = uploadCap();
    const fits = [];
    for (const f of files) {
      if (f.size > cap * 1024 * 1024) toast(`${f.name} is too big (${fmtSize(f.size)}) - files here go up to ${cap} MB.`);
      else if (!f.size) toast(`${f.name} is empty.`);
      else fits.push(f);
    }
    if (fits.length > Math.max(0, 4 - atts.length - context.pending)) toast('A message can carry up to 4 files.');
    if (!fits.length) return;
    // (counted again inside the update: two drops in a row can come before a re-render)
    setAtts(x => [...x, ...fits.slice(0, Math.max(0, 4 - x.length - context.pending)).map((f, i) => ({ local: true, id: `q${Date.now()}_${i}_${f.name}`, file: f, name: f.name, size: f.size, kind: fileKind(f), spoiler: false, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null }))]);
    // a drop never focuses the box by itself: put the caret there so typing + Enter just work
    const el = ta.current;
    if (el && document.activeElement !== el && !mobileTextInput()) { el.focus({ preventScroll: true }); caretToEnd(el); }
  }
  function toggleSpoiler(a) {
    setAtts(x => x.map(y => (y !== a ? y : y.local ? { ...y, spoiler: !y.spoiler } : { ...y, name: spoilerName(y.name, !isSpoiler(y)) })));
  }
  function removeAtt(a) {
    if (a.preview) URL.revokeObjectURL(a.preview);
    setAtts(x => x.filter(y => y !== a));
  }
  // Android keyboard images and native Paste use the same attachment path as
  // file selection. The listener is refreshed with current permissions/draft.
  useEffect(() => {
    const el = ta.current, context = uploadContext.current;
    if (!el) return;
    const receive = async e => {
      e.preventDefault();
      if (locked || (view.kind === 'channel' && !canAttach) || view.username === 'System') return;
      try {
        const url = new URL(e.detail.url);
        if (url.origin !== location.origin || !url.pathname.startsWith('/__bonfire_clipboard/')) return;
        const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw Error('Could not paste that media. Try copying it again.');
        const blob = await response.blob();
        if (el !== ta.current || !el.isConnected || uploadContext.current !== context) return;
        await addFiles([new File([blob], e.detail.name || 'clipboard-media', { type: blob.type })]);
      } catch (error) { if (uploadContext.current === context) toast(error.message); }
    };
    el.addEventListener('bonfire-media-paste', receive);
    return () => el.removeEventListener('bonfire-media-paste', receive);
  });
  // "Upload to my Velora account": the file goes to Saved Media (your Velora storage) AND is attached to this message, the same
  // attachment a Saved Media pick gives
  async function addSavedFiles(files) {
    const context = uploadContext.current;
    if (locked || (view.kind === 'channel' && !canAttach) || view.username === 'System') return;
    const list = [...files].slice(0, Math.max(0, 4 - atts.length - context.pending));
    if (!list.length) return;
    const cap = getUploadLimits().saved_mb;
    const big = list.find(f => f.size > cap * 1024 * 1024);
    if (big) { toast(`${big.name} is too big - files kept on your account go up to ${cap} MB.`); return; }
    context.pending += list.length;
    setBusy(n => n + list.length);
    for (const f of list) {
      if (uploadContext.current !== context) return;
      try { const a = await uploadMedia(f); if (uploadContext.current === context) setAtts(x => [...x, a]); }
      catch (e) { if (uploadContext.current === context) toast(errorText(e.message)); }
      context.pending--;
      if (uploadContext.current === context) setBusy(n => n - 1);
    }
  }
  // The whole window takes dropped files. Counted dragenter/dragleave + a "no dragover for a moment" timer so the overlay can never
  // get stuck, preventDefault on window so a miss never opens the file in the tab. The Saved Media picker (and the emoji upload
  // list) mark themselves [data-drop-own]: a drop on them goes there instead and this overlay stays out of the way.
  const dz = useRef(null);
  dz.current = { ok: !locked && (view.kind !== 'channel' || canAttach) && view.username !== 'System', add: addFiles };
  useEffect(() => {
    loadUploadLimits();
    let depth = 0, idle = null;
    const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const own = e => !!e.target.closest?.('[data-drop-own]');
    const blocked = () => !dz.current.ok || !!document.querySelector('.vc-modal-back, .vc-mv-back');
    const stop = () => { depth = 0; clearTimeout(idle); setDropping(false); };
    const show = e => { if (own(e) || blocked()) { setDropping(false); return; } setDropping(true); clearTimeout(idle); idle = setTimeout(stop, 700); };
    const enter = e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(e); };
    const over = e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; show(e); };
    const leave = e => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth || (e.relatedTarget == null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight))) stop();
    };
    const drop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const mine = !own(e) && !blocked();
      stop();
      if (mine) dz.current.add(e.dataTransfer.files);
    };
    const opts = true;
    addEventListener('dragenter', enter, opts); addEventListener('dragover', over, opts); addEventListener('dragleave', leave, opts);
    addEventListener('drop', drop, opts); addEventListener('dragend', stop, opts); addEventListener('blur', stop);
    return () => {
      clearTimeout(idle);
      removeEventListener('dragenter', enter, opts); removeEventListener('dragover', over, opts); removeEventListener('dragleave', leave, opts);
      removeEventListener('drop', drop, opts); removeEventListener('dragend', stop, opts); removeEventListener('blur', stop);
    };
  }, []);
  // the + button: a file for this conversation, or one kept on my Velora account (Saved Media)
  function uploadMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const lim = getUploadLimits();
    openMenu({ clientX: r.left, clientY: Math.max(6, r.top - 96), preventDefault() {}, stopPropagation() {} }, [
      { label: 'Upload to server', hint: `Sent here - up to ${uploadCap()} MB`, icon: Upload, onClick: () => file.current?.click() },
      { label: 'Upload to my Velora account', hint: `Kept in Saved Media and attached - up to ${lim.saved_mb} MB`, icon: CloudUpload, onClick: () => saveFile.current?.click() },
    ]);
  }
  if (timedOut) return <div className="vc-composer locked timed-out" role="status"><Clock size={15} /> <span><b>You're timed out</b> until {untilText(timedOut)}. You can read messages, but can't send any, react or join voice until then.</span></div>;
  if (locked) {
    return <div className="vc-composer locked"><Lock size={15} /> {lockedText || "This channel is locked - only the server's admins can post here."}</div>;
  }
  return (
    <div className="vc-composer-wrap">
      {dropping && createPortal(
        <div className="vc-dropzone" aria-hidden="true">
          <div className="vc-dropzone-card">
            <Upload size={44} />
            <b>Drop to upload</b>
            <span>Up to {uploadCap()} MB per file{view.kind === 'channel' && isInst(view.sid) ? '' : ', 4 files at a time'}</span>
          </div>
        </div>
        , document.body)}
      {replyTo && (
        <div className="vc-replybar">
          <span>Replying to <b>{replyTo.author?.username || 'Velora'}</b></span>
          <button type="button" onClick={() => setReplyTo(null)} title="Cancel reply"><X size={14} /></button>
        </div>
      )}
      {srActive && (
        <div className="vc-replybar vc-sr-bar">
          <span>Replying to <b>{srActive.username}</b>'s status: <i>{srActive.text}</i></span>
          <button type="button" onClick={clearStatusReply} title="Cancel status reply"><X size={14} /></button>
        </div>
      )}
      {(atts.length > 0 || busy > 0) && (
        <div className="vc-pending-atts">
          {atts.map(a => {
            const type = a.local ? a.kind : a.type, src = a.local ? a.preview : a.url;
            const spoiler = a.local ? a.spoiler : isSpoiler(a);
            return (
              <span key={a.local ? a.id : a.url} className={`vc-patt${spoiler ? ' spoiler' : ''}`} title={`${shownName(a.name) || ''}${a.size ? ` (${fmtSize(a.size)})` : ''}`}>
                {type === 'video' ? <Film size={22} /> : type === 'audio' ? <Music size={22} /> : type === 'file' || !src ? <span className="vc-patt-file"><FileIcon size={20} /><small>{shownName(a.name)}</small></span> : <img src={src} alt="" />}
                {spoiler && <span className="vc-patt-spoiler-tag">Spoiler</span>}
                <button type="button" className="vc-patt-spoiler" title={spoiler ? 'Remove spoiler' : 'Mark as spoiler'} aria-pressed={spoiler} onClick={() => toggleSpoiler(a)}>{spoiler ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                <button type="button" title="Remove" onClick={() => removeAtt(a)}><X size={12} /></button>
              </span>
            );
          })}
          {Array.from({ length: busy }, (_, i) => <span key={`b${i}`} className="vc-patt busy"><ImageIcon size={18} /></span>)}
        </div>
      )}
      <div className={`vc-composer${replyTo || srActive ? ' replying' : ''}`}>
        {(view.kind !== 'channel' || canAttach) && view.username !== 'System' && (
          <button type="button" className="vc-ico-btn" title="Upload a file" onClick={uploadMenu}><Plus size={18} /></button>
        )}
        {mq && <MentionPicker items={mitems} sel={msel} setSel={setMsel} onPick={pickMention} sid={view.sid} />}
        {slashQ === '' && cdata && !centries.length && <div className="vc-mentions vc-cmd-picker vc-cmd-empty">No bot commands in this server yet. Bots can add slash commands, and they will show up here.</div>}
        {citems.length > 0 && <CommandPicker items={citems} sel={csel} setSel={setCsel} onPick={startCommand} />}
        {cmd && <CommandBar key={cmd.key} view={view} entry={cmd} submitRef={cmdSubmit} onCancel={() => { setCmd(null); ta.current?.focus(); }} onSent={() => { setCmd(null); setReplyTo?.(null); ta.current?.focus(); }} />}
        <input ref={file} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={saveFile} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/*" onChange={e => { addSavedFiles(e.target.files); e.target.value = ''; }} />
        <div
          ref={ta} className="vc-input" style={cmd ? { display: 'none' } : undefined} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
          data-placeholder={placeholder} spellCheck autoCorrect="on" autoCapitalize="sentences" inputMode="text"
          onInput={onInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={e => { composing.current = false; onInput(e); }}
          onBlur={() => setTimeout(() => setMq(null), 150)}
          onPaste={e => {
            e.preventDefault();
            const files = [...(e.clipboardData.files || [])];
            if (!files.length) for (const item of e.clipboardData.items || []) {
              if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
            }
            if (files.length) { addFiles(files); return; }
            const t = e.clipboardData.getData('text/plain');
            if (!t) return;
            const strip = getState().settings.strip_tracking;
            if (strip === true) { document.execCommand('insertText', false, cleanText(t)); return; }
            if (strip == null && hasTracking(t)) { askStripTracking().then(yes => insertText(yes ? cleanText(t) : t)); return; } // first time: ask, then paste it
            document.execCommand('insertText', false, t);
          }}
          onDrop={e => { if (e.dataTransfer.files.length) return; e.preventDefault(); }}
          onKeyDown={e => {
            if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            const marker = markdownMarker(e);
            if (marker) { e.preventDefault(); markdownShortcut(ta.current, view, marker); styleMarkdown(ta.current, view); sync(); return; }
            if (citems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCsel(x => (x + 1) % citems.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCsel(x => (x - 1 + citems.length) % citems.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); startCommand(citems[csel] || citems[0]); return; }
            }
            if (mq && mitems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMsel(x => (x + 1) % mitems.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMsel(x => (x - 1 + mitems.length) % mitems.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mitems[msel] || mitems[0]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMq(null); return; }
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (e.shiftKey) { document.execCommand('insertLineBreak'); sync(); } else submit();
            }
            if (e.key === 'ArrowUp' && !text) { e.preventDefault(); dispatchEvent(new Event('vc-edit-last')); }
            if (e.key === 'Escape' && replyTo) setReplyTo(null);
          }}
        />
        <button type="button" className={`vc-ico-btn vc-gif-btn${picker ? ' on' : ''}`} title="GIFs and Saved Media" onClick={() => { setPicker(p => !p); setEmoji(false); }}><GifIcon /></button>
        <button type="button" className={`vc-ico-btn vc-emoji-btn${emoji ? ' on' : ''}`} title="Emoji" onClick={() => { setEmoji(x => !x); setPicker(false); }}><Smile size={19} /></button>
        {emoji && <EmojiPicker onClose={() => setEmoji(false)} onPick={t => { insertText(t); setEmoji(false); }} />}
        <button type="button" className="vc-ico-btn send" title="Send" disabled={!cmd && !text.trim() && !atts.length} onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()} onClick={() => (cmd ? cmdSubmit.current?.() : submit())}><SendHorizontal size={18} /></button>
        {picker && <MediaPicker onClose={() => setPicker(false)} onPick={a => { setPicker(false); sendMessage(view, '', { replyTo, attachments: [a] }); setReplyTo?.(null); }} />}
      </div>
      <Typing view={view} />
    </div>
  );
}
