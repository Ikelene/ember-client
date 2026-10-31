// Reporting a message in a DM or a group chat to Nookara staff (POST /api/report/dm-message on Nookara). Pure helpers,
// no store imports, so node --test can check them; the dialog itself is reportDmMessage() in report.js.

// the reason dropdown: [value the server takes, label]
export const DM_REPORT_REASONS = [
  ['harassment', 'Harassment'],
  ['spam', 'Spam'],
  ['nsfw', 'NSFW / explicit content'],
  ['threats', 'Threats or self-harm'],
  ['other', 'Something else'],
];
export const DM_REPORT_NOTE = 'The message and a few messages around it (with attachments) will be sent to Nookara staff.';

// can this message in this view be reported to Nookara? (a DM or group message someone else sent, already saved)
export function canReportDm(view, m, meName) {
  if (!view || !m || m.system || m.pending || m.failed || m.ephemeral) return false;
  const author = m.author?.username;
  if (!author || (meName && author.toLowerCase() === String(meName).toLowerCase())) return false;
  if (view.kind === 'dm') return view.username !== 'System' && !!m.imId;
  if (view.kind === 'group') return !!view.room && !!m.gid;
  return false;
}

// the request body for a message (null when it can't be reported)
export function dmReportBody(view, m, reason, details) {
  if (!DM_REPORT_REASONS.some(([v]) => v === reason)) return null;
  const text = String(details || '').trim().slice(0, 1000);
  if (view?.kind === 'dm' && m?.imId) return { message_id: String(m.imId), reason, ...(text ? { details: text } : {}) };
  if (view?.kind === 'group' && m?.gid && view.room) return { room: view.room, message_id: String(m.gid), reason, ...(text ? { details: text } : {}) };
  return null;
}

// what the server's error codes mean to the person reporting
export function dmReportError(code, message) {
  return ({
    not_a_participant: "You can only report messages in your own conversations.",
    message_not_found: "That message doesn't exist any more.",
    cannot_report_self: "You can't report your own message.",
    cannot_report_system: "That message can't be reported.",
    rate_limited: message || "You've sent a lot of reports - try again in an hour.",
    auth_required: 'Sign in with Nookara to report.',
  })[code] || "Couldn't send that report - try again in a moment.";
}
