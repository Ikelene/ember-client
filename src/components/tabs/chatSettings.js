import { NOOKARA_WIRE, desktopBridge } from '../../compat.js';
import { useState, useEffect } from 'react';

// My Account > Chat: Ember settings (saved to the account, so every device gets them)
export const GROUPS = [
  ['Privacy', [
    ['share_activity', 'Share my activity', 'Show what you are playing or doing (Hyperfocus games, projects, integrations) under your name and on your profile.'],
    ['share_typing', 'Let others see when I am typing', 'Turn this off to type without the "is typing..." showing for anyone.'],
    ['allow_vc_calls', 'Let people call me into voice channels', 'Where a voice channel allows it, people in that server can ring you straight into it. Turn off to never get those calls.'],
    ['dm_privacy', 'Who can send me direct messages', 'Friends only stops people you are not friends with from starting a DM or calling you. The servers option also lets in people who share an Ember server with you. Nookara staff can always reach you.', [['everyone', 'Everyone'], ['friends', 'Friends only'], ['servers', "Members in servers I'm in"]]],
    ['lock_emojis', 'Lock my emojis and stickers', 'Nobody else can clone your personal emojis and stickers to a server or add them to their own. People can still see them in your messages.'],
  ]],
  ['Notifications', [
    ['sounds', 'Sounds', 'A sound for new direct messages and when someone @mentions you.'],
    ['notify_sound', 'Notification sound', 'The sound for new direct messages and @mentions. Use the speaker to hear it.', [['short', 'Short'], ['soft', 'Soft'], ['classic', 'Classic']]],
  ]],
  ['Messages', [
    ['show_typing', 'Show typing indicators', 'See who is typing, in the conversation and next to channels in the list.'],
    ['strip_tracking', 'Remove tracking from links', 'Cleans tracking junk (like ?utm_source=, ?si= or fbclid) off links you paste or send. Only the junk goes; the link still works the same.'],
    ['link_previews', 'Show link previews', "A card with the page's title and picture under messages with links, DMs included. Nookara fetches the page, so it sees that link, even in an encrypted DM. Off = a button to show one when you want it."],
    ['link_images', 'Show pictures from links', 'Links to pictures show as the picture instead of a link.'],
    ['yt_mode', 'Play YouTube videos', "Through Nookara: Nookara streams the video for you - no ads, no trackers. YouTube's player: starts instantly, but YouTube can track you and show ads.", [['ask', 'Ask each time'], [NOOKARA_WIRE, 'Through Nookara'], ['youtube', "YouTube's player"]]],
    ['dm_upload_dest', 'Where files in DMs go', "Nookara account storage: kept until you delete them, counts toward your storage. Temporary storage: free, deleted a set time after you send them (pictures about 30 days, videos and sounds 14, other files 7). The + button can always pick once.", [['ask', 'Ask every time'], ['account', 'Account storage'], ['temp', 'Temporary storage']]],
    ['animations', 'Animations', 'Messages, menus and pop-ups slide and fade in. Off = everything changes instantly.'],
  ]],
  ['Extras', [
    ['radio_enabled', 'Internet Radio', 'Plays a radio stream while Ember is open, with a little visualizer behind your chats.'],
    ['rock_easter_egg', 'The Rock', 'he likes pancakses'],
  ]],
  ['Advanced', [
    ['daily_notice', 'Daily credit messages', 'When your first message of the day earns your daily chat credits, Ember tells you (only you see it). Turn off to claim them quietly.'],
    ['sleep_servers', 'Sleep mode for servers', "Servers nobody is chatting in that you haven't opened for 15 minutes disconnect (they show with a moon), and check for new messages every 10 minutes. Saves data and battery; you may hear about mentions there a little later. Opening one wakes it straight away."],
    ['developer_mode', 'Developer mode', 'Adds "Copy ID" options (accounts, servers, channels, messages) to right-click menus.'],
  ]],
];

// The desktop app's system: true on macOS. Guessed from the browser straight away, then taken from the app itself
// (emberDesktop.info() gives { platform, rpcAvailable, overlayAvailable }); cached for the page's life.
let desktopInfo = null;

const guessMac = () => { try { return /mac/i.test(navigator.userAgentData?.platform || navigator.platform || ''); } catch { return false; } };

export function useDesktopMac() {
  const [mac, setMac] = useState(() => (desktopInfo ? desktopInfo.platform === 'darwin' : guessMac()));
  useEffect(() => {
    const info = desktopBridge()?.info;
    if (desktopInfo || typeof info !== 'function') return undefined;
    let live = true;
    Promise.resolve(info()).then(v => { if (v?.platform) { desktopInfo = v; if (live) setMac(v.platform === 'darwin'); } }).catch(() => {});
    return () => { live = false; };
  }, []);
  return mac;
}

// the desktop app's settings page is 'Windows app' inside (its page id); on a Mac it's called this
export const desktopAppTitle = mac => (mac ? 'macOS app' : 'Windows app');

// search: does a row / page match what's typed in Settings' "Search settings..." box?
export const matches = (q, ...texts) => { const t = String(q || '').trim().toLowerCase(); return !t || texts.some(x => String(x || '').toLowerCase().includes(t)); };
