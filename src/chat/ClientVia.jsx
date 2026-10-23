// Which client someone is using. Velora only sends this to people with the Manage users permission:
// `via` on a message, and `sessions` / `last_login` / `notifications_only` on a presence.
import { BadgeCheck, Plug, Globe } from 'lucide-react';
import { viaLabel, viaTitle, sessionLine, STATE_TEXT } from './clientViaText.js';

export function ViaMark({ via, size = 13 }) {
  if (via?.official) return <BadgeCheck size={size} aria-label="Official Ember client" />;
  return via?.token ? <Plug size={size} /> : <Globe size={size} />;
}
// the small tag next to a message's author
export function ViaBadge({ via }) {
  if (!via) return null;
  return <span className={`vc-via${via.official ? ' official' : ''}`} title={`${viaTitle(via)} (only people with Manage users see this)`}><ViaMark via={via} size={12} />{viaLabel(via)}</span>;
}
// "Last login" alone, for an instance's members (their member row carries last_login; presence is Velora's)
export function LastLoginFact({ at }) {
  if (!at) return null;
  return <div className="pe-fact vc-manage-fact"><b>Last login</b><span>{new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>;
}
// the "Client" and "Last login" rows of a mini profile
export function ManageFacts({ presence }) {
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
              <span className={`vc-via${s.via?.official ? ' official' : ''}`}><ViaMark via={s.via} size={12} />{viaLabel(s.via)}</span>
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
