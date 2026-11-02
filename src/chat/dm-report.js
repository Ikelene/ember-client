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
// (the numbers are BEFORE / AFTER in Nookara's dm-reports.js, and privacy policy section 5 says the same)
export const DM_REPORT_NOTES = {
  en: "Nookara staff will see this message and a short history of the chat around it: up to 10 messages before and 5 after, from everyone in this conversation. Pictures, videos and files in those messages are copied for staff, so they stay visible to staff even if the sender deletes them later. Staff don't see the rest of the chat, and the person you report isn't told who reported them.",
  de: "Das Nookara-Team sieht diese Nachricht und einen kurzen Verlauf des Chats drumherum: bis zu 10 Nachrichten davor und 5 danach, von allen in dieser Unterhaltung. Bilder, Videos und Dateien in diesen Nachrichten werden für das Team kopiert und bleiben für das Team sichtbar, auch wenn die Person sie später löscht. Den Rest des Chats sieht das Team nicht, und die gemeldete Person erfährt nicht, wer sie gemeldet hat.",
  pt: "A equipe da Nookara verá esta mensagem e um pequeno histórico da conversa em volta dela: até 10 mensagens antes e 5 depois, de todas as pessoas nesta conversa. Imagens, vídeos e arquivos nessas mensagens são copiados para a equipe e continuam visíveis para ela mesmo que quem enviou os apague depois. A equipe não vê o resto da conversa, e a pessoa denunciada não fica sabendo quem a denunciou.",
};
// Ember has no language setting of its own: the browser's language decides, English when it's something else
export const dmReportNote = (lang = globalThis.navigator?.language) => DM_REPORT_NOTES[String(lang || '').slice(0, 2).toLowerCase()] || DM_REPORT_NOTES.en;
export const DM_REPORT_NOTE = DM_REPORT_NOTES.en;

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
