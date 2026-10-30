// Which client someone is using. Velora only sends this to people with the Manage users permission:
// `via` on a message, and `sessions` / `last_login` / `notifications_only` on a presence. Ember servers send `via` the same way.
// The name and verified badge come from Velora's official clients list (officialClients.js); anything not on it shows
// its domain (or token name) with no badge.
import { useEffect, useState } from 'react';
import { BadgeCheck, Plug, Globe } from 'lucide-react';
import { viaTitle, sessionLine, STATE_TEXT } from './clientViaText.js';
import { describeVia, officialClients, loadOfficialClients, onOfficialClients } from './officialClients.js';

// the official clients list (null until it's known), re-rendering when it arrives
export function useOfficialClients() {
  const [list, setList] = useState(officialClients);
  useEffect(() => {
    const off = onOfficialClients(setList);
    loadOfficialClients().then(setList).catch(() => {});
    return off;
  }, []);
  return list;
}

// the chip: [icon] name [verified badge]. Unknown clients: a globe (or plug for a token) + their domain / token name
function Chip({ via, list, tip }) {
  const d = describeVia(via, list);
  const tipData = tip ? JSON.stringify({ name: d.name, domain: d.domain, verified: d.verified, known: d.known, text: viaTitle(via, list) }) : undefined;
  return (
    <span className={`vc-via${d.verified ? ' official' : ''}`} data-tip-via={tipData} aria-label={viaTitle(via, list)}>
      {d.icon ? <img className="vc-via-icon" src={d.icon} alt="" /> : !d.verified && (via.token ? <Plug size={12} /> : <Globe size={12} />)}
      <span className="vc-via-name">{d.name}</span>
      {d.verified && <BadgeCheck size={12} className="vc-via-check" aria-hidden="true" />}
    </span>
  );
}

// the small tag next to a message's author
export function ViaBadge({ via }) {
  const list = useOfficialClients();
  if (!via) return null;
  return <Chip via={via} list={list} tip />;
}
// the hover card (Tooltip.jsx, data-tip-via): "Sent from <name>", the domain in small text
export function ViaTip({ t }) {
  if (!t) return null;
  return (
    <div className="vc-tip-via">
      <span>{t.known ? <>Sent from <b>{t.name}</b></> : t.text}{t.verified && <BadgeCheck size={12} className="vc-via-check" aria-label="Verified client" />}</span>
      {t.domain && t.known && <small>{t.domain}</small>}
      <small className="vc-tip-via-note">Only people with Manage users see this</small>
    </div>
  );
}
// "Last login" alone, for an instance's members (their member row carries last_login; presence is Velora's)
export function LastLoginFact({ at }) {
  if (!at) return null;
  return <div className="pe-fact vc-manage-fact"><b>Last login</b><span>{new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>;
}
// the "Client" and "Last login" rows of a mini profile
export function ManageFacts({ presence }) {
  const list = useOfficialClients();
  if (!presence || (presence.sessions === undefined && presence.last_login === undefined)) return null;
  const sessions = presence.sessions || [];
  const when = presence.last_login ? new Date(presence.last_login).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <>
      {sessions.length > 0 && (
        <div className="pe-fact vc-manage-fact">
          <b>{sessions.length > 1 ? 'Clients' : 'Client'}</b>
          {sessions.map((s, i) => (
            <span key={i} className="vc-via-row">
              {s.via ? <Chip via={s.via} list={list} /> : <span className="vc-via"><Globe size={12} /><span className="vc-via-name">Unknown client</span></span>}
              {s.app && <small>{s.app}</small>}
              {sessionLine(s) && <small>{sessionLine(s)}</small>}
              {STATE_TEXT[s.state] && <small className="vc-via-state">{STATE_TEXT[s.state]}</small>}
            </span>
          ))}
        </div>
      )}
      {sessions.length === 0 && presence.status === 'offline' && <div className="pe-fact vc-manage-fact"><b>Client</b><span>Not connected</span></div>}
      {when && <div className="pe-fact vc-manage-fact"><b>Last login</b><span>{when}</span></div>}
    </>
  );
}
