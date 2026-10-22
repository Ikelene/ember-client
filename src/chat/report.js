// Reporting a message or a member: to the Ember server's moderators (they see it in Server settings > Reports), or to
// Velora's staff (/api/report/submit, the same as velora.ikelene.net/report) when it breaks Velora's rules. Velora can
// only act on Velora accounts, so that choice is off on servers that don't sign in with Velora.
import { apiFetch, uploadFetch } from '../api.js';
import { ask, toast, errorText, getState, linkFor } from './store.js';
import { instOf } from './ids.js';
import { hasVelora } from './session.js';

const VELORA_CATEGORIES = ['Underage', 'NSFW / Explicit Content', 'Graphic Violence / Gore', 'Hate Speech / Harassment', 'Threats or Real-World Harm',
  'Spam or Bot Activity', 'Malware / Phishing / Scam', 'Copyright / Intellectual Property Violation', 'Other'];

// why Velora can't take this report ('' = it can)
function veloraBlocked(sid, target) {
  const st = getState(), origin = instOf(sid);
  const inst = st.instances.find(i => i.origin === origin);
  if (inst?.mode !== 'velora') return "This server doesn't use Velora sign-in, so Velora can't act on its accounts.";
  if (!target?.velora_id) return "They don't have a Velora account.";
  if (!hasVelora()) return 'Sign in with Velora to report to Velora.';
  return '';
}

async function toVelora(sid, target, message, a) {
  const st = getState(), srv = st.detail[sid]?.server, host = st.instances.find(i => i.origin === instOf(sid))?.host || instOf(sid);
  const lines = [a.text || '(no details given)', '', `Ember server: ${srv?.name || 'unknown'} (${host})`];
  if (message) {
    lines.push(`Message link: ${linkFor({ kind: 'channel', sid, cid: message.channel })}`, `Message id: ${message.id}`, `Message text: ${String(message.body || '').slice(0, 2000) || '(no text)'}`);
    if (message.attachments?.length) lines.push(`Attachments: ${message.attachments.map(x => x.url || x.name).filter(Boolean).join(', ')}`);
    lines.push(message.signature ? 'Has their Velora signature: yes' : 'Has their Velora signature: no');
  }
  const fd = new FormData();
  fd.append('reported_id', String(target.velora_id));
  fd.append('category', a.category);
  fd.append('location', `Ember server: ${host}`);
  fd.append('description', lines.join('\n'));
  await uploadFetch('/api/report/submit', fd);
}

// what: { message_id } or { user_id }; label: what the question names ("this message", "@nat");
// ctx: { target: the author / member (with velora_id), message: the message when it's a message }
export async function reportTo(sid, what, label, ctx = {}) {
  const blocked = veloraBlocked(sid, ctx.target);
  const a = await ask({
    title: `Report ${label}`,
    text: 'Who should see this report?',
    choices: [
      { id: 'server', label: 'Report to this server', hint: "Breaks this server's rules. Its moderators see it and who sent it, and can delete messages, time people out or remove them from this server." },
      { id: 'velora', label: 'Report to Velora', hint: "Breaks Velora's Terms of Service, or is serious (threats, abuse, illegal content). Velora's staff can act on the Velora account everywhere.", disabled: !!blocked, why: blocked, categories: VELORA_CATEGORIES },
    ],
    input: { placeholder: 'What happened? (optional)', value: '', optional: true, multiline: true, max: 500 },
    confirm: 'Send report',
  });
  if (!a) return;
  try {
    if (a.choice === 'velora') {
      await toVelora(sid, ctx.target, ctx.message, a);
      toast("Thanks - Velora's staff will take a look.", true);
      return;
    }
    const r = await apiFetch(`/chat/servers/${sid}/reports`, { method: 'POST', body: JSON.stringify({ ...what, reason: a.text || '' }) });
    toast(r.duplicate ? "You've already reported that - the moderators have it." : 'Thanks - the moderators will take a look.', true);
  } catch (e) { toast(/\s/.test(e.message || '') ? e.message : errorText(e.message)); }
}
