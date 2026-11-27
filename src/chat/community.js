// the join button and a line under it for a server's join policy (Gate, Instances)
export const joinLabel = (policy, fallback) => ({ request: 'Request to join', password: 'Join with password' })[policy] || fallback;

export const joinHint = policy => ({ request: 'Someone on the server lets you in.', password: 'This server asks for a password.', allowlist: 'Only people on its list can join.', invite: 'You need an invite link to join.' })[policy] || '';
