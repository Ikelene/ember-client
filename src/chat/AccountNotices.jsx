// One-time account notices ("what's new" popups, account-notices.js on Velora). GET /account/notices says which ids this
// account hasn't dismissed yet; we show the first one we have words for. Either button marks it seen for the account
// (POST /account/notices/:id/seen), so it never comes back here, in the other Ember apps or on the Velora dashboard.
import { useEffect, useState } from 'react';
import { ShieldCheck, MessageCircle, Ban, Settings, IdCard, AtSign, Pencil } from 'lucide-react';
import { apiFetch } from '../api.js';

const NOTICES = {
  'privacy-settings-2026-10': {
    title: 'New privacy settings',
    lines: [
      [MessageCircle, 'Choose who can DM you: everyone, friends only, or people in servers you\'re in.'],
      [Ban, 'Block people so they can\'t see your profile, message you, call you or pay you. Their messages in servers are hidden behind a click.'],
      [Settings, 'Who can DM you is in Settings > Privacy. Block someone from their profile or user menu, and see everyone you blocked in your Nookara account under Privacy.'],
    ],
    action: 'Open privacy settings',
    page: 'Privacy', // SettingsDialog page with "Who can send me direct messages"
  },
  // display names (Nookara display-names.js): only pending while the account has none. Either button dismisses it for the account.
  'display-names': {
    Icon: IdCard,
    title: 'Display names are here!',
    lines: [
      [IdCard, 'Pick a name that shows instead of your username, in Ember and on your profile. It can have spaces, capitals and emoji.'],
      [AtSign, 'Your username stays the same: people still @mention you by it, and it shows in smaller text on your profile.'],
      [Pencil, 'Set it in your profile settings any time, or keep using your username.'],
    ],
    action: 'Set one in settings',
    later: 'Continue',
    page: 'profile', // SettingsDialog: Settings > Profile (ProfileEditor.jsx), the Display name field
    focus: 'bf-pe-display-name',
  },
};

// onOpenSettings(page): open Ember's settings on that page
export function AccountNotices({ onOpenSettings }) {
  const [id, setId] = useState(null);
  useEffect(() => {
    let live = true;
    apiFetch('/account/notices')
      .then(d => { if (live) setId((d?.notices || []).find(n => NOTICES[n]) || null); })
      .catch(() => {}); // offline / old server: ask again next time Ember opens
    return () => { live = false; };
  }, []);
  if (!id) return null;
  const n = NOTICES[id];
  const done = open => {
    apiFetch(`/account/notices/${encodeURIComponent(id)}/seen`, { method: 'POST' }).catch(() => {});
    setId(null);
    if (open) {
      onOpenSettings?.(n.page);
      // (the editor loads your profile first: try for a few seconds)
      if (n.focus) { let tries = 0; const t = setInterval(() => { const el = document.getElementById(n.focus); if (el || ++tries > 30) { clearInterval(t); el?.focus(); } }, 100); }
    }
  };
  return (
    <div className="vc-modal-back" role="presentation">
      <div className="vc-dialog vc-notice" role="dialog" aria-modal="true" aria-labelledby="vc-notice-t">
        <h3 id="vc-notice-t">{n.Icon ? <n.Icon size={19} /> : <ShieldCheck size={19} />} {n.title}</h3>
        <ul className="vc-notice-list">
          {n.lines.map(([Icon, text]) => <li key={text}><Icon size={15} /><span>{text}</span></li>)}
        </ul>
        <div className="vc-dialog-btns">
          <button type="button" className="btn btn-primary" autoFocus onClick={() => done(true)}><Settings size={15} /> {n.action}</button>
          <button type="button" className="btn btn-surface" onClick={() => done(false)}>{n.later || 'Got it'}</button>
        </div>
      </div>
    </div>
  );
}
