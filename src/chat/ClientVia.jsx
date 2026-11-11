// Which client someone is using. `via` on a message goes to everyone (since 2026-11-07);
// on a presence, and `sessions` / `last_online` / `notifications_only` on a presence (people also get `sessions` for themselves). Ember servers send `via` the same way.
// The name, logo and verified badge are the Nookara App that sent it (appClients.js, from Nookara's App registry); no App shows
// its domain (or token name) with no badge.
import { useEffect, useState } from 'react';
import { BadgeCheck, Plug, Globe, Monitor, Smartphone, Clock, Bot } from 'lucide-react';
import { viaTitle, sessionShort, sessionDetails, sessionKind, sessionIsIdle, mergeSessions, STATE_SHORT } from './clientViaText.js';
import { describeVia, appInfo, loadApp, onApps } from './appClients.js';
import { useChat } from './store.js';
import { parseK } from './ids.js';
import { watchInstClients, instClientsOf, onInstClients } from './instClients.js';

// the official clients list (null until it's known), re-rendering when it arrives
// re-render when an App's registry entry arrives; returns the lookup describeVia takes
export function useApps() {
  const [, bump] = useState(0);
  useEffect(() => onApps(() => bump(n => n + 1)), []);
  return appInfo;
}

// the chip: [icon] name [verified badge]. Unknown clients: a globe (or plug for a token) + their domain / token name
const KIND_ICON = { mobile: Smartphone, desktop: Monitor, browser: Globe, bot: Bot };
function Chip({ via, list, tip, Icon, iconOnly, inst }) {
  const d = describeVia(via, list, !!inst);
  useEffect(() => { if (d.app && list(d.app) === undefined) loadApp(d.app); }, [d.app]); // eslint-disable-line react-hooks/exhaustive-deps
  const tipData = tip ? JSON.stringify({ name: d.name, domain: d.domain, verified: d.verified, known: d.known, registered: !!d.registered, text: viaTitle(via, list, !!inst), icon: d.icon || null }) : undefined;
  return (
    <span className={`vc-via${d.verified ? ' official' : ''}${iconOnly ? ' icon-only' : ''}`} data-tip-via={tipData} aria-label={viaTitle(via, list, !!inst)}>
      {d.icon ? <img className="vc-via-icon" src={d.icon} alt="" /> : Icon ? <Icon size={13} aria-hidden="true" /> : iconOnly ? <Globe size={13} /> : !d.verified && (via.token ? <Plug size={12} /> : <Globe size={12} />)}
      {!iconOnly && <span className="vc-via-name">{d.name}</span>}
      {!iconOnly && d.verified && <BadgeCheck size={12} className="vc-via-check" aria-hidden="true" />}
    </span>
  );
}

// the small tag next to a message's author
export function ViaBadge({ via, inst }) {
  const list = useApps();
  if (!via) return null;
  return <Chip via={via} list={list} tip iconOnly inst={inst} />; // (everyone sees it since 2026-11-07: just the app's icon, or a globe; the name is in the hover card)
}
// the hover card (Tooltip.jsx, data-tip-via): "Sent from <name>", the domain in small text
export function ViaTip({ t }) {
  if (!t) return null;
  return (
    <div className="vc-tip-card vc-tip-via">
      {t.icon ? <img className="vc-tip-via-ico" src={t.icon} alt="" /> : <Globe size={17} />}
      <div>
        <b>{t.known ? <>Sent from {t.name}</> : t.text}{t.verified && <BadgeCheck size={13} className="vc-via-check" aria-label="Verified client" />}</b>
        <span>{t.verified ? 'A verified Nookara app.' : t.known ? 'A Nookara app.' : 'Not sent with a Nookara app.'}{t.domain && t.known ? ` ${t.domain}` : ''}</span>
      </div>
    </div>
  );
}
// "just now", "5 minutes ago", "4 hours ago", "5 days ago" ... for a timestamp in the past
function agoText(at) {
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 60) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [u, n] = units.find(([, n]) => sec >= n);
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-Math.floor(sec / n), u);
}
// the "Last online" row: "Online now", or how long ago with the full date on hover
// Classic: a "Last online" row. Modern: a clock icon line like the profile dates (CSS shows one or the other)
function LastOnlineRow({ online, at }) {
  if (!online && !(at > 0)) return null;
  const full = at > 0 ? new Date(at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' }) : '';
  return (
    <>
      {online ? <div className="pe-fact vc-manage-fact vc-fact-classic"><b>Last online</b><span>Online now</span></div>
        : <div className="pe-fact vc-manage-fact vc-fact-classic"><b>Last online</b><span title={full}>{agoText(at)}</span></div>}
      <div className="vc-pf-dates"><span data-tip={online ? 'Online right now' : `Last online ${full}`}><Clock size={15} /> {online ? 'Online now' : `Last online ${agoText(at)}`}</span></div>
    </>
  );
}
// an instance's members (their member row carries last_online + online; presence is Velora's)
export function LastOnlineFact({ member }) {
  if (!member) return null;
  return <LastOnlineRow online={!!member.online} at={Number(member.last_online) || 0} />;
}
// The clients an Ember server says this member is connected with (instClients.js), while the card is open. `who` = the member
// as that server knows them ({ inst, id }), `sid` = the server the card was opened in. Only asked when the server would answer:
// it is me there, or I hold Manage users in that server (the server checks again; anyone else gets nothing).
// -> undefined (nothing / not asked) | null (not allowed) | { online, sessions, last_online }
const MANAGE_USERS = 2048;
export function useInstClients(who, sid) {
  const inst = who?.inst || null, uid = who?.id != null ? String(who.id) : null;
  const server = useChat(s => {
    if (!inst || uid == null) return null;
    const here = sid && parseK(sid).inst === inst ? sid : s.servers.find(x => x.inst === inst)?.sid; // (one community per server, usually)
    if (!here) return null;
    const mine = s.instances?.find(i => i?.origin === inst)?.user?.id;
    const perms = Number(s.detail[here]?.server?.perms ?? s.servers.find(x => x.sid === here)?.perms) || 0;
    return String(mine) === uid || (perms & MANAGE_USERS) === MANAGE_USERS ? parseK(here).id : null;
  });
  const [, bump] = useState(0);
  useEffect(() => onInstClients(() => bump(n => n + 1)), []);
  useEffect(() => (server ? watchInstClients(inst, server, uid) : undefined), [inst, server, uid]);
  return server ? instClientsOf(inst, uid) : undefined;
}

// the "Client" and "Last online" rows of a mini profile.
// presence: Nookara's (its `sessions`); inst: what an Ember server reports (useInstClients); member: an Ember server's member row
// (last_online / online for Manage users) for its own accounts and bots. Ember is connected to both, so the lists are merged.
export function ManageFacts({ presence, inst, member }) {
  const list = useApps();
  const hasP = !!presence && (presence.sessions !== undefined || presence.last_online !== undefined || presence.last_login !== undefined);
  const hasI = !!inst && Array.isArray(inst.sessions);
  if (!hasP && !hasI) return member ? <LastOnlineFact member={member} /> : null;
  const sessions = mergeSessions(hasP ? presence.sessions || [] : [], hasI ? inst.sessions : [], list);
  const online = (hasP && presence.status !== 'offline') || (hasI && inst.online) || (!hasP && !hasI && !!member?.online);
  const at = Number((hasP && presence.last_online) || (hasI && inst.last_online) || member?.last_online) || 0;
  return (
    <>
      {sessions.length > 0 && (
        <div className="pe-fact vc-manage-fact">
          <b>{sessions.length > 1 ? 'Clients' : 'Client'}</b>
          {sessions.map((s, i) => (
            <span key={i} className={`vc-via-row${sessionIsIdle(s) ? ' idle' : ''}`} title={sessionDetails(s) || undefined}>
              {s.via ? <Chip via={s.via} list={list} Icon={KIND_ICON[sessionKind(s)]} inst={s.inst} /> : <span className="vc-via"><Globe size={13} /><span className="vc-via-name">Unknown client</span></span>}
              {sessionIsIdle(s) ? <small>{STATE_SHORT[s.state]}</small> : sessionShort(s) && <small>{sessionShort(s)}</small>}
            </span>
          ))}
        </div>
      )}
      {sessions.length === 0 && !online && <div className="pe-fact vc-manage-fact"><b>Client</b><span>Not connected</span></div>}
      <LastOnlineRow online={online} at={at} />
    </>
  );
}
