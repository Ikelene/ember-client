// Reporting a message in a homeserver DM. The DM is end-to-end encrypted, so the reporter's own device hands over that one
// message's key, with the sealed message, to whoever manages the SENDER's account: Nookara for a Nookara account (wherever
// it is signed in), the sender's homeserver for everyone else. Pure helpers; the dialog and the requests are in report.js.
import { splitId, normId, isNookaraId } from './keydoc.js';
import { openRevealed } from './homedm.js';

export const HS_REPORT_REASONS = ['harassment', 'spam', 'child_safety', 'nsfw', 'threats', 'other'];

// where a report about this sender goes. me = { id: my stable id }
//   { to: 'nookara', domain, own }      Nookara's report URL, from the discovery document of <domain> (social.reports_url)
//   { to: 'homeserver', domain, own }   POST <that homeserver's social.api_url>/social/reports
// own: my account is managed there too, so the session I already have does; otherwise one from my home (a cross-homeserver token)
// null: nothing to report (my own message, or no sender)
export function reportRoute(sender, me) {
  const s = splitId(sender), mine = splitId(me?.id);
  if (!s || !mine || normId(sender) === normId(me.id)) return null;
  return { to: isNookaraId(sender) ? 'nookara' : 'homeserver', domain: s.domain, own: s.domain === mine.domain };
}
// can this message be reported from here? m = a message as the store keeps it (sealed.key = its K, when this device opened it)
export function canReportSealed(m, sender, me) {
  return !!m && !m.system && !m.pending && !m.failed && m.sealed?.state === 'open' && m.sealed.v === 2 && !!m.sealed.key && !!m.enc && !!reportRoute(sender, me);
}
// the request. One shape for both: { message: { dm, id, from, envelope }, revealed_key, reason, details? }. Nookara's report
// route is its DM one, which wants the same things at the top (source: 'homeserver_dm'), so they are there as well.
// -> null when it isn't a reason either takes
export function reportBody(route, { dm, id, from, envelope, key, reason, details }) {
  if (!route || !HS_REPORT_REASONS.includes(reason) || !key || !envelope || Number(envelope.v) !== 2) return null;
  const text = String(details || '').trim().slice(0, 1000), mid = String(id), who = normId(from), where = normId(dm);
  const body = { message: { dm: where, id: mid, from: who, envelope }, revealed_key: key, reason, ...(text ? { details: text } : {}) };
  return route.to === 'nookara' ? { source: 'homeserver_dm', dm: where, message_id: mid, from: who, envelope, ...body } : body;
}
export function hsReportError(code, message) {
  return ({
    cannot_report_self: "You can't report your own message.",
    bad_signature: "That message's signature doesn't check out, so it can't be reported as theirs.",
    unknown_signer: "That message's signature doesn't check out, so it can't be reported as theirs.",
    bad_revealed_key: "This device couldn't open that message for the report.", reveal_mismatch: "This device couldn't open that message for the report.",
    rate_limited: "You've sent a lot of reports - try again in an hour.", homeserver_rate_limited: 'Your homeserver has sent a lot of reports - try again later.',
    user_not_found: "That account isn't there any more.", homeserver_unreachable: "Couldn't reach the homeserver that account is on.", unreachable: "Couldn't reach the homeserver that account is on.",
    auth_required: "Couldn't sign in where that account is managed.", no_reports_url: "That account's homeserver doesn't take reports.",
  })[code] || (/\s/.test(message || '') ? message : "Couldn't send that report - try again in a moment.");
}

// ── a homeserver admin's Reports tab ──
// one report as GET /api/v2/homeserver/reports lists it -> the same with `opened` = what the reported message says
// ({ text, files, quote, preview, ts } | null when the key doesn't open it), and each message of its context likewise.
// Only the revealed keys are used: an admin can read these messages and no others.
export async function openReport(r) {
  const m = r?.message || {};
  const opened = m.envelope && r.revealed_key ? await openRevealed(m.envelope, r.revealed_key, { dm: m.dm, from: m.from }) : null;
  const context = [];
  for (const x of Array.isArray(r?.context) ? r.context : []) context.push({ ...x, opened: x?.envelope && x.revealed_key ? await openRevealed(x.envelope, x.revealed_key, { dm: m.dm, from: x.from }) : null });
  return { ...r, opened, context };
}
