// Encrypted DMs where they meet the message list and the composer. Separate from Messages.jsx so E2ee.jsx's dialogs stay out of its imports.
import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, AlertTriangle, Clock, File as FileIcon, Download, Link2, Film, Music, Image as ImageIcon, Play, RefreshCw } from 'lucide-react';
import { useChat, openE2eeGate, dismissKeyChange, dropFailed, useBotPeer, waitingNames, rewrapDm } from './store.js';
import { nameList, memberName } from './e2ee/homedm.js';
import { LinkEmbeds } from './LinkEmbeds.jsx';
import { E2eeLockedPanel } from './E2ee.jsx';
import { openSafety, openSafetyId } from './e2eeSafety.js';
import * as E2EE from './e2ee/session.js';
import { opensByItself, autoMax } from './e2ee/files.js';
import { shownName } from './spoiler.js';
import './E2ee.css';

export { E2eeLockedPanel };

// what isn't a normal message: locked here, can't be opened, a signature that's wrong, waiting for them to set up, from before encryption
export function E2eeMessageNote({ m, view }) {
  const s = m.sealed;
  const status = useChat(st => st.e2eeStatus);
  // a homeserver DM: it stays on this device until everyone in it can read it, and never goes any other way
  if (m.waiting && view.dm) return (
    <div className="e2-msg-note"><Clock size={13} /> <span>Waiting for {nameList(waitingNames(view.dm, m.missing)) || 'everyone'} to set up encryption. It sends by itself once they have, while Ember is open on this device. <button type="button" onClick={() => dropFailed(view, m.nonce)}>Remove</button></span></div>
  );
  if (m.waiting) return (
    <div className="e2-msg-note"><Clock size={13} /> <span>Waiting for @{view.username} to set up encrypted DMs. It sends by itself once they have, while Ember is open on this device. <button type="button" onClick={() => dropFailed(view, m.nonce)}>Remove</button></span></div>
  );
  // (no per-message 'Not encrypted' line: the lock beside the name at the top says whether the DM is encrypted)
  if (!s) return null;
  if (s.state === 'locked' && status === 'loading' && E2EE.unlockedBefore()) return <div className="e2-msg-note"><i className="vc-ring e2-ring sm" aria-hidden="true" /> <span>Decrypting...</span></div>;
  if (s.state === 'locked') return <div className="e2-msg-note"><Lock size={13} /> <span>Encrypted. <button type="button" onClick={() => openE2eeGate()}>Unlock your DMs</button> to read this.</span></div>;
  if (s.state === 'failed') return <div className="e2-msg-note bad"><AlertTriangle size={13} /> This device can't open this message. It was sealed to a key you don't have any more.</div>;
  if (s.signature === 'invalid') return <div className="e2-msg-note bad"><AlertTriangle size={13} /> This message's signature doesn't match. It might not really be from them.</div>;
  return null;
}

// Files in a DM: the encrypted ones are fetched and opened here, and from then on they're ordinary attachments with a local address.
// Pictures, GIFs, videos and sounds open by themselves once they scroll into view (Ikelene 2026-11-13: "make all files
// automatically open"), up to autoMax(); a bigger one shows its size and opens on a click. Other files keep a Download button.
function useOpened(list) {
  const [got, setGot] = useState({}); // link -> object URL | 'gone' | 'failed' | 'wait' | { big: size }
  const open = (link, auto = false) => {
    setGot(g => ({ ...g, [link]: 'wait' }));
    E2EE.openFile(link, auto ? { max: autoMax() } : {}).then(u => setGot(g => ({ ...g, [link]: u })))
      .catch(e => setGot(g => ({ ...g, [link]: e.message === 'gone' ? 'gone' : e.message === 'too_big' ? { big: e.size } : 'failed' })));
  };
  return [got, open];
}
const sizeText = n => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// the placeholder of one that isn't open yet: opens itself when it comes into view (media only)
function Waiting({ a, open }) {
  const ref = useRef(null);
  const auto = opensByItself(a) && !a.state;
  useEffect(() => {
    if (!auto || !ref.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') { open(a.url, true); return undefined; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); open(a.url, true); } }, { rootMargin: '300px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [auto, a.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const big = a.state && typeof a.state === 'object' ? a.state.big : 0;
  const media = a.type === 'video' || a.type === 'audio';
  return (
    <div ref={ref} className={`e2-file${opensByItself(a) ? ' media' : ''}`}>
      {a.type === 'video' ? <Film size={18} /> : a.type === 'audio' ? <Music size={18} /> : a.type === 'image' || a.type === 'gif' ? <ImageIcon size={18} /> : <FileIcon size={18} />}
      <span title={shownName(a.name)}>{shownName(a.name)}</span>
      {a.state === 'failed' ? <><small>Couldn't open it.</small><button type="button" className="btn btn-surface btn-sm" onClick={() => open(a.url)}><RefreshCw size={14} /> Try again</button></>
        : a.state === 'wait' ? <small>Opening...</small>
        : big ? <button type="button" className="btn btn-surface btn-sm" onClick={() => open(a.url)}>{media ? <Play size={14} /> : <Download size={14} />} {media ? 'Play' : 'Open'} ({sizeText(big)})</button>
        : !opensByItself(a) ? <button type="button" className="btn btn-surface btn-sm" onClick={() => open(a.url)}><Download size={14} /> Download</button> : <small>Loading...</small>}
    </div>
  );
}
export function OpenedAttachments({ list, extra, m, Attachments }) {
  const [got, open] = useOpened(list);
  const shown = [], waiting = [];
  for (const a of list) {
    if (!a.sealed) { shown.push(a); continue; }
    const g = got[a.url];
    if (g === 'gone') shown.push({ url: a.url, name: a.name, expired: true });
    else if (g && g !== 'wait' && g !== 'failed') shown.push({ ...a, url: g, sealed: false, opened: true });
    else waiting.push({ ...a, state: g });
  }
  // the expiry footer goes by the real links (an opened one shows from a blob: address, a waiting one isn't in `shown` at all)
  const temps = list.filter(a => a.sealed).map(a => String(a.url).split('#')[0]);
  return (
    <>
      {waiting.map(a => <Waiting key={a.url} a={a} open={open} />)}
      <Attachments list={shown} extra={extra} m={m} temps={temps} />
    </>
  );
}

// Link previews are off in settings: nothing is fetched until someone asks. In a DM, say what asking does: the server makes previews, so Nookara sees that link.
export function PreviewOnAsk({ urls, inst, priv }) {
  const [on, setOn] = useState(false);
  if (!urls?.length) return null;
  if (on) return <LinkEmbeds urls={urls} inst={inst} priv={priv} />;
  return <div className="e2-msg-note"><Link2 size={13} /> <span><button type="button" onClick={() => setOn(true)}>Show link preview</button>{priv && ' (Nookara fetches it, so Nookara sees the link)'}</span></div>;
}

// has the other person set up encrypted DMs? (they haven't: what's sent now isn't encrypted). A bot never can: no lookup at all
function useUnset(view, bot) {
  const [unset, setUnset] = useState(false);
  useEffect(() => {
    let live = true;
    setUnset(false);
    if (view.kind === 'dm' && view.username !== 'System' && !bot) E2EE.bundleFor(view.username).then(v => { if (live) setUnset(!!v.none); }).catch(() => {});
    if (bot) return () => { live = false; };
    const again = e => { if (String(e.detail || '').toLowerCase() === String(view.username).toLowerCase()) E2EE.bundleFor(view.username, { fresh: true }).then(v => live && setUnset(!!v.none)).catch(() => {}); };
    addEventListener('e2ee-keys-changed', again);
    return () => { live = false; removeEventListener('e2ee-keys-changed', again); };
  }, [view.kind, view.username, bot]);
  return unset;
}

// the lock beside the name at the top of a DM / group: hover says how private it is, click (an encrypted DM) compares keys.
// Not encrypted (they haven't set up, a bot, or a group chat): a yellow open lock.
export function E2eeHeadLock({ view }) {
  const bot = useBotPeer(view.kind === 'dm' ? view.username : null);
  const unset = useUnset(view, bot);
  if (view.kind !== 'dm' && view.kind !== 'group') return null;
  if (view.kind === 'dm' && view.username === 'System') return null;
  if (view.kind === 'group' || unset || bot) {
    const text = view.kind === 'group' ? 'Nookara can read group chats.'
      : bot ? `@${view.username} is a bot. Bots can't use end-to-end encryption, so this chat isn't encrypted: the bot's program, and Nookara, can read it.`
      : `@${view.username} hasn't set up encrypted DMs yet. They can read this, and have to set up to reply.`;
    return <span className="e2-head-lock off" tabIndex={0} role="img" aria-label={`Not end-to-end encrypted. ${text}`} data-tip={text} data-tip-title="Not end-to-end encrypted" data-tip-kind="warn" data-tip-side="bottom"><LockOpen size={16} /></span>;
  }
  return (
    <button type="button" className="e2-head-lock" onClick={() => openSafety(view.username)} aria-label="End-to-end encrypted. Compare keys"
      data-tip="Only you two can read this. Click to compare keys." data-tip-title="End-to-end encrypted" data-tip-kind="ok" data-tip-side="bottom"><Lock size={16} /></button>
  );
}

// A homeserver DM: the lock beside its name. One other person: click to compare keys with them.
export function SdmHeadLock({ dm }) {
  const one = !dm.group && dm.others?.length === 1 ? dm.others[0] : null;
  const tip = dm.group ? 'Only the people in this group can read it, not the homeservers it passes through.' : 'Only you two can read this, not the homeservers it passes through.';
  if (!one) return <span className="e2-head-lock" tabIndex={0} role="img" aria-label={`End-to-end encrypted. ${tip}`} data-tip={tip} data-tip-title="End-to-end encrypted" data-tip-kind="ok" data-tip-side="bottom"><Lock size={16} /></span>;
  return (
    <button type="button" className="e2-head-lock" onClick={() => openSafetyId(one.id, memberName(dm, one.id))} aria-label="End-to-end encrypted. Compare keys"
      data-tip={`${tip} Click to compare keys.`} data-tip-title="End-to-end encrypted" data-tip-kind="ok" data-tip-side="bottom"><Lock size={16} /></button>
  );
}
// above the composer of a homeserver DM: someone's key changed; the people in it changed (the host says who is in a
// conversation, and new messages are sealed to whoever it lists: so a change is always said)
function SdmComposerNotes({ view }) {
  const dm = useChat(s => s.social.dms.find(x => x.id === view.dm));
  const changedKeys = useChat(s => s.e2eeKeyChanged);
  const status = useChat(s => s.e2eeStatus);
  const [, bump] = useState(0);
  if (!dm) return null;
  const c = status === 'ready' ? E2EE.membersOf(dm) : { added: [], removed: [] };
  // (someone no longer in the list has only an id left, like v:3: say "someone" rather than that)
  // (several of those: "2 people" / "alice and 2 others", never "someone and someone")
  const who = ids => {
    const names = ids.map(id => memberName(dm, id)), anon = n => /^[a-z]:\w+(@\S+)?$/i.test(n);
    const known = names.filter(n => !anon(n)), rest = names.length - known.length;
    const tail = !rest ? [] : known.length ? [rest === 1 ? 'someone else' : `${rest} others`] : [rest === 1 ? 'someone' : `${rest} people`];
    return nameList([...known, ...tail]).replace(/^someone/, 'Someone');
  };
  const keyChanged = dm.members.filter(m => changedKeys[String(m.id).toLowerCase()]);
  return (
    <>
      {c.error === 'dm_members_changed' && <div className="e2-keychange"><AlertTriangle size={14} /><span>The homeserver now lists different people in this conversation than it started with. Nothing you write here is sent.</span></div>}
      {!c.error && (c.added.length > 0 || c.removed.length > 0) && (
        <div className="e2-keychange"><AlertTriangle size={14} />
          <span>{c.added.length > 0 && `${who(c.added)} ${c.added.length > 1 ? 'were' : 'was'} added and can read new messages. `}{c.removed.length > 0 && `${who(c.removed)} left and can't read new messages. `}<button type="button" onClick={() => { E2EE.rememberMembers(dm); bump(n => n + 1); }}>OK</button></span>
        </div>
      )}
      {keyChanged.map(m => (
        <div key={m.id} className="e2-keychange"><AlertTriangle size={14} />
          <span>{memberName(dm, m.id)}'s encryption key changed. They may have started over or lost their old one. <button type="button" onClick={() => openSafetyId(m.id, memberName(dm, m.id))}>Compare keys</button> <button type="button" title="Wrap the messages this device can open for their new key" onClick={() => rewrapDm(dm.id, m.id)}>Let them read earlier messages</button> <button type="button" onClick={() => dismissKeyChange(m.id)}>Dismiss</button></span>
        </div>
      ))}
    </>
  );
}

export function E2eeComposerNotes({ view }) {
  if (view.dm) return <SdmComposerNotes view={view} />;
  return <NookaraComposerNotes view={view} />;
}
function NookaraComposerNotes({ view }) {
  const changed = useChat(s => (view.kind === 'dm' ? s.e2eeKeyChanged[String(view.username).toLowerCase()] : false));
  if (view.kind !== 'dm' && view.kind !== 'group') return null;
  if (view.kind === 'dm' && view.username === 'System') return null;
  return (
    <>
      {changed && (
        <div className="e2-keychange"><AlertTriangle size={14} />
          <span>@{view.username}'s encryption key changed. They may have started over or lost their old one. <button type="button" onClick={() => openSafety(view.username)}>Compare keys</button> <button type="button" onClick={() => dismissKeyChange(view.username)}>Dismiss</button></span>
        </div>
      )}
    </>
  );
}
