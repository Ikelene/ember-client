import * as S from './e2ee/session.js';
import { ask } from './store.js';

// a line under the conversation's header: what kind of privacy this conversation has
// (the old "End-to-end encrypted" line above the composer is now the lock beside the name: E2eeMessage.jsx E2eeHeadLock)
export async function openSafety(username) {
  let code = null;
  try { code = await S.safetyWith(username); } catch { /* shown below */ }
  await ask({
    title: `Your keys with @${username}`,
    text: code
      ? `Compare these numbers with @${username} somewhere outside Nookara, like in person or on a call. If they match, nobody is listening in, not even Nookara.\n\n${code.join(' ')}`
      : `@${username} hasn't set up encrypted DMs yet, so there's nothing to compare.`,
    confirm: 'Done',
  });
}

// the same for someone in a homeserver DM (id = their stable id)
export async function openSafetyId(id, name) {
  let code = null;
  try { code = await S.safetyWithId(id); } catch { /* shown below */ }
  await ask({
    title: `Your keys with ${name}`,
    text: code
      ? `Compare these numbers with ${name} somewhere else, like in person or on a call. If they match, nobody is listening in, not even the homeservers in between.\n\n${code.join(' ')}`
      : `${name} hasn't set up encryption yet, so there's nothing to compare.`,
    confirm: 'Done',
  });
}
