// An invite to a server by its address (#/i/<slug>@<domain>/<code>, or a homeserver's invite link): which server it is, then
// Join with my homeserver account. Signed out: the homeserver sign-in first. The invite is kept (sessionStorage) across the
// sign-in, also a full-page trip, and Chat.jsx finishes the join once it is back signed in.
import { useEffect, useState } from 'react';
import { Users, LogIn } from 'lucide-react';
import { HomeChip } from './homeLabels.jsx';
import { Dialog } from './Dialogs.jsx';
import { initials } from './initials.js';
import { useChat, go } from './store.js';
import { resolveAddress, joinByAddress } from './instances.js';
import { addressHash, parseAddress, createErrorText } from './addresses.js';
import { fromInstance, K } from './ids.js';
import { HomeserverLogin } from './HomeserverLogin.jsx';
import { useHomeSession } from './homeSessions.js';
import { keepInvite, dropInvite } from './addressInvites.js';

// address: { slug, domain, code } or, from a link whose host isn't the domain, { slug, origin, code }
export function AddressInvite({ address, onClose }) {
  const [s, setS] = useState(null);
  const [bad, setBad] = useState('');
  const [joining, setJoining] = useState(false); // (one join per click: a second one while the first runs only fails)
  const signedIn = useChat(x => x.signedIn || !!x.home);
  const home = useHomeSession();
  const joined = useChat(x => !!s && x.servers.some(v => v.sid === K(s.origin, s.sid)));
  useEffect(() => {
    let live = true;
    (async () => {
      const at = await resolveAddress(address);
      let server = null;
      if (address.code) {
        const r = await fetch(`${at.origin}/api/v1/invite/${encodeURIComponent(address.code)}`).catch(() => null);
        if (r?.status === 404) throw new Error('invalid_invite');
        if (r?.ok) server = fromInstance(at.origin, await r.json(), '/invite').server || null;
      }
      if (live) setS({ ...at, name: server?.name || at.address, icon: server?.icon || null, members: server?.member_count, description: server?.description || '' });
    })().catch(e => { if (live) setBad(createErrorText(e)); });
    return () => { live = false; };
  }, [address.slug, address.domain, address.origin, address.code]);
  const hash = s ? addressHash({ ...parseAddress(s.address), code: address.code }) : null;
  // signed out: kept, so it is finished after the sign-in (a pop-up, or the trip to the homeserver's page and back)
  useEffect(() => { if (hash && !signedIn) keepInvite(hash); }, [hash, signedIn]);
  // signed in with the pop-up while this was open: start again signed in (Chat.jsx joins the kept invite)
  useEffect(() => { if (home && !signedIn && hash) location.reload(); }, [home, signedIn, hash]);
  const leave = () => { dropInvite(); onClose(); };
  return (
    <Dialog title={bad ? 'Invite not valid' : joined ? "You're in this server" : "You've been invited to join"} onClose={leave}>
      {close => (bad ? <p className="vc-dialog-sub">{bad}</p> : !s ? <div className="vc-loading"><i /><i /><i /></div> : (
        <>
          <div className="vc-invite-srv">
            <span className="vc-srv-ico lg">{s.icon ? <img src={s.icon} alt="" /> : initials(s.name)}</span>
            <div><b>{s.name} <HomeChip domain={String(s.address).split('@')[1] || ''} /></b><small>{s.members != null && <><Users size={13} /> {s.members} member{s.members === 1 ? '' : 's'} - </>}{s.address}</small></div>
          </div>
          {s.description && <p className="vc-dialog-sub">{s.description}</p>}
          {signedIn ? (
            <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Not now</button>
              <button type="button" className="btn btn-primary" disabled={joining} onClick={() => {
                if (joining) return;
                setJoining(true);
                close();
                if (joined) go({ kind: 'server', sid: K(s.origin, s.sid) });
                else joinByAddress({ ...parseAddress(s.address), code: address.code || null });
              }}><LogIn size={15} /> {joined ? 'Open it' : joining ? 'Joining...' : 'Join server'}</button></div>
          ) : (
            <>
              <p className="vc-dialog-sub">Sign in with your homeserver account to join. You come back here after.</p>
              <HomeserverLogin back={{ hash }} />
            </>
          )}
        </>
      ))}
    </Dialog>
  );
}
