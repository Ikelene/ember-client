// Settings > Advanced: this web app opens web+ember: links (the "Open in an app" on a homeserver's invite page hands over
// web+ember:invite?address=slug@domain&code=X, which lands on #/open?u=<it>, store.js readHash). The browser asks before
// it lets a site take a kind of link, so it's a button here rather than something done on load.
import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from '../store.js';
import { clientUrl } from '../hosts.js';
import { canOpenLinks } from './openLinks.js';

const SCHEME = 'web+ember';
const DONE_KEY = 'ember_link_handler';
export function OpenLinksCard() {
  const [done, setDone] = useState(() => { try { return localStorage.getItem(DONE_KEY) === location.origin; } catch { return false; } });
  if (!canOpenLinks()) return null;
  function register() {
    try {
      navigator.registerProtocolHandler(SCHEME, `${location.origin}${clientUrl('#/open?u=%s')}`);
      try { localStorage.setItem(DONE_KEY, location.origin); } catch { /* fine */ }
      setDone(true);
      toast('Your browser asks you to allow it - then invite links open here.', true);
    } catch { toast("Your browser didn't let Ember open these links."); }
  }
  return (
    <div className="card">
      <div className="card-header"><span className="card-title">Invite links</span></div>
      <div className="card-body cs-rows">
        <div className="cs-row">
          <div className="cs-text"><b>Open Ember invite links in this app</b><span>A homeserver's invite page can open the invite in an app. Set this up and those links open here, in this browser. Your browser asks first.</span></div>
          <button type="button" className="btn btn-surface btn-sm" onClick={register}><Link2 size={14} /> {done ? 'Set up again' : 'Set up'}</button>
        </div>
      </div>
    </div>
  );
}
