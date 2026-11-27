import { Icon3DS, MiniProfile, ProfileModal } from './Profile.jsx';
import { isNookara } from '../compat.js';
import { useState } from 'react';
import { useChat, getState } from './store.js';

// your own profile's "Edit profile": Ember's settings, Profile page (Chat.jsx listens for vc-dialog)
// target: which profile to open on (accountProfileCore.js accountTarget: your account on a server with its own accounts)
export const openProfileEditor = target => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'chat-settings', page: 'profile', ...(typeof target === 'string' ? { target } : {}) } }));

export const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', invisible: 'Invisible', offline: 'Offline' };

export const VERB = { playing: 'Playing', listening: 'Listening to', watching: 'Watching', competing: 'Competing in', streaming: 'Streaming', custom: '' };

export const onPlatform = a => (a?.platform === '3ds' ? '3DS' : null);

// who someone's listening to, for "Listening to <artist>" instead of the app's name: Spotify puts the artist in details; music
// apps like Chime send a song (it has a duration) with "by <artist>" as its state. Radio and the rest keep the app's name.
function listenArtist(a) {
  if (a?.type !== 'listening') return '';
  if (a.app === 'Spotify') return a.details || '';
  return Number(a.duration) > 0 && a.state ? String(a.state).replace(/^by\s+/i, '') : '';
}

// "Playing Hyperfocus", or their custom status
export function subtitle(p) {
  const a = p?.activities?.[0];
  if (a && onPlatform(a)) return <><Icon3DS /> Playing on <strong className="vc-sub-activity">{onPlatform(a)}</strong></>;
  if (listenArtist(a)) return <>Listening to <strong className="vc-sub-activity">{listenArtist(a)}</strong></>; // the artist; the song title stays on the activity card
  if (a) return a.type === 'custom' ? a.name : <>{VERB[a.type] || 'Playing'} <strong className="vc-sub-activity">{a.name}</strong></>;
  return p?.custom || '';
}

// who = the author / member object when the person was clicked on an instance server: a Nookara person (v:) is looked up on
// Nookara by their Nookara id (the name Nookara knows them by now, checked against the id); a local account or bot there has no
// Nookara profile at all (a Nookara account with the same name is somebody else): a plain card from the instance's own data.
export const plainOn = who => !!who?.inst && !isNookara(who.kind);

// for anything that can open a profile: click -> mini profile; "expand" -> large
export function useProfiles() {
  const [mini, setMini] = useState(null);
  const [big, setBig] = useState(null);
  const view = useChat(s => s.view);
  const sid = view.kind === 'channel' ? view.sid : null;
  const dm = view.kind === 'dm' || view.kind === 'group' || view.kind === 'sdm' || (view.kind === 'channel' && !!view.dm); // (full handles there)
  // who: the author / member object when it's someone on an instance server (decides Nookara profile vs plain card)
  const openMini = (username, el, side = 'right', who) => setMini({ username, anchor: el?.getBoundingClientRect?.() || el, side, sid, who, dm, k: Date.now() + Math.random() });
  const ui = (
    <>
      {mini && <MiniProfile key={mini.k} {...mini} onClose={() => setMini(m => (m?.k === mini.k ? null : m))} onExpand={(u, rect) => setBig({ username: u, from: rect, sid: mini.sid, who: mini.who, dm: mini.dm })} />}
      {big && <ProfileModal {...big} onClose={() => setBig(null)} />}
    </>
  );
  return { openMini, openBig: (username, from, inDm = dm) => setBig({ username, from, sid, dm: inDm }), ui };
}

export const meName = () => getState().me?.username;
