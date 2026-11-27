// Settings > Homeservers > Reports: messages of this homeserver's accounts that someone reported from a DM (PROTOCOL §4d).
// DMs are end-to-end encrypted, so the homeserver holds each reported message sealed, with the one key its reporter
// handed over: it is opened here, on the admin's device (e2ee/report.js). No other message can be read.
import { useEffect, useState } from 'react';
import { Flag, TriangleAlert, RefreshCw, Check, X, RotateCcw, File as FileIcon, Lock } from 'lucide-react';
import { SCard } from './ui.jsx';
import { toast } from '../store.js';
import { hsCall } from '../homeApi.js';
import { openReport } from '../e2ee/report.js';
import { openFile, parseFileLink } from '../e2ee/session.js';

const STATUSES = [['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']];
const REASON = { harassment: 'Harassment', spam: 'Spam', child_safety: 'Child sexual abuse material', nsfw: 'NSFW / explicit content', threats: 'Threats or self-harm', other: 'Something else' };
const nameOf = p => (typeof p === 'string' ? p : p?.display_name || p?.handle || p?.username || p?.id || 'Someone');
const idOf = p => (typeof p === 'string' ? p : p?.handle || p?.id || '');
const when = t => (t ? new Date(t).toLocaleString() : '');
const say = e => ({ not_found: 'old', forbidden: 'Only admins of this homeserver can see reports.', not_allowed: 'Only admins of this homeserver can see reports.', unreachable: "Couldn't reach the homeserver." })[e?.error || e?.message] || e?.error || e?.message || 'request_failed';

function Files({ files }) {
  if (!files?.length) return null;
  const open = link => openFile(link).then(u => window.open(u, '_blank', 'noopener'), () => toast("Couldn't open that file."));
  return <div className="hsx-report-files">{files.map(l => <button type="button" key={l} className="btn btn-surface btn-sm" onClick={() => open(l)}><FileIcon size={13} /> {parseFileLink(l)?.name || 'file'}</button>)}</div>;
}
// one message as the revealed key opened it (o = null: the key didn't open it)
function Opened({ o, from, at }) {
  return (
    <div className="hsx-report-msg">
      <small>{from}{at ? ` - ${when(at)}` : ''}</small>
      {!o ? <p className="vc-hint"><Lock size={13} /> This device couldn't open this message with the key in the report.</p> : (
        <>
          {o.quote && <blockquote>{o.quote.from ? `${o.quote.from}: ` : ''}{o.quote.s}</blockquote>}
          {o.text && <p>{o.text}</p>}
          <Files files={o.files} />
        </>
      )}
    </div>
  );
}

export function ReportsTab({ hs }) {
  const { origin } = hs;
  const [status, setStatus] = useState('open');
  const [data, setData] = useState(null); // { reports (opened), counts, has_more }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const load = async (more = false) => {
    setError('');
    try {
      const before = more && data?.reports.length ? `&before=${encodeURIComponent(data.reports[data.reports.length - 1].id)}` : '';
      const d = await hsCall(origin, `/api/v2/homeserver/reports?status=${status}&limit=50${before}`);
      const opened = await Promise.all((d.reports || []).map(openReport));
      setData(cur => ({ reports: more && cur ? [...cur.reports, ...opened] : opened, counts: d.counts || {}, has_more: !!d.has_more }));
    } catch (e) { setError(say(e)); }
  };
  useEffect(() => { setData(null); load(); }, [origin, status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function patch(r, body) {
    setBusy(r.id);
    try {
      const d = await hsCall(origin, `/api/v2/homeserver/reports/${encodeURIComponent(r.id)}`, { method: 'PATCH', body });
      const next = d.report ? await openReport(d.report) : { ...r, ...body };
      setData(cur => cur && ({ ...cur, reports: status === 'all' || next.status === status ? cur.reports.map(x => (x.id === r.id ? next : x)) : cur.reports.filter(x => x.id !== r.id), counts: { ...cur.counts, [r.status]: Math.max(0, (cur.counts[r.status] || 1) - (next.status !== r.status ? 1 : 0)), ...(next.status !== r.status ? { [next.status]: (cur.counts[next.status] || 0) + 1 } : {}) } }));
    } catch (e) { toast(say(e) === 'old' ? "This homeserver doesn't have reports yet." : `Couldn't save that: ${say(e)}`); }
    setBusy(null);
  }
  if (error) return (
    <SCard>{error === 'old'
      ? <div className="sx-empty"><TriangleAlert size={28} /><b>This homeserver doesn't have reports yet</b><span>Its software is older than this page. Update it, then look again.</span></div>
      : <div className="sx-empty"><TriangleAlert size={28} /><b>Couldn't load the reports</b><span>{error}</span><button type="button" className="btn btn-surface btn-sm" onClick={() => load()}><RefreshCw size={13} /> Try again</button></div>}
    </SCard>
  );
  return (
    <SCard title="Reported messages" sub={`Messages that accounts of ${hs.domain} sent in direct messages and someone reported. DMs are end-to-end encrypted: each report carries the key of the reported message only, and it is opened here on your device.`}>
      <div className="sx-seg hsx-tabs" role="tablist" aria-label="Which reports">
        {STATUSES.map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={status === id} className={status === id ? 'on' : ''} onClick={() => setStatus(id)}>{label}{id !== 'all' && data?.counts?.[id] ? ` (${data.counts[id]})` : ''}</button>)}
      </div>
      {!data ? <div className="vc-loading"><i /><i /><i /></div> : !data.reports.length ? <div className="sx-empty"><Flag size={28} /><b>Nothing here</b><span>{status === 'open' ? 'No reports are waiting.' : 'No reports like that.'}</span></div> : data.reports.map(r => (
        <div className="hsx-report" key={r.id}>
          <div className="sx-row-txt">
            <b>{REASON[r.reason] || r.reason} <i className="hsx-tag">{r.status}</i></b>
            <span>{nameOf(r.sender)} <span className="vc-mono">{idOf(r.sender)}</span> reported by {nameOf(r.reporter)} <span className="vc-mono">{idOf(r.reporter)}</span> - {when(r.created_at)}</span>
            {r.details && <span>"{r.details}"</span>}
          </div>
          {r.context.filter(x => Number(x.id) < Number(r.message?.id)).map(x => <Opened key={x.id} o={x.opened} from={x.from} at={x.opened?.ts} />)}
          <div className="hsx-report-main"><Opened o={r.opened} from={`${nameOf(r.sender)}${r.message?.edit_of && r.message.edit_of !== '0' ? ' (edited)' : ''}`} at={r.opened?.ts} /></div>
          {r.context.filter(x => Number(x.id) > Number(r.message?.id)).map(x => <Opened key={x.id} o={x.opened} from={x.from} at={x.opened?.ts} />)}
          <Note r={r} busy={busy === r.id} onSave={note => patch(r, { note })} />
          <div className="hsx-report-btns">
            {r.status !== 'resolved' && <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => patch(r, { status: 'resolved' })}><Check size={13} /> Resolved</button>}
            {r.status !== 'dismissed' && <button type="button" className="btn btn-surface btn-sm" disabled={busy === r.id} onClick={() => patch(r, { status: 'dismissed' })}><X size={13} /> Dismiss</button>}
            {r.status !== 'open' && <button type="button" className="btn btn-surface btn-sm" disabled={busy === r.id} onClick={() => patch(r, { status: 'open' })}><RotateCcw size={13} /> Reopen</button>}
            {r.handled_by && <small className="vc-hint">Last handled by {nameOf(r.handled_by)}</small>}
          </div>
        </div>
      ))}
      {data?.has_more && <button type="button" className="btn btn-surface btn-sm hsx-block" onClick={() => load(true)}>Show more</button>}
    </SCard>
  );
}
function Note({ r, busy, onSave }) {
  const [v, setV] = useState(r.note || '');
  useEffect(() => { setV(r.note || ''); }, [r.note]);
  return (
    <form className="hsx-copy hsx-report-note" onSubmit={e => { e.preventDefault(); onSave(v); }}>
      <input className="form-input" placeholder="A note for the other admins" maxLength={2000} value={v} onChange={e => setV(e.target.value)} />
      <button type="submit" className="btn btn-surface btn-sm" disabled={busy || v === (r.note || '')}>Save note</button>
    </form>
  );
}
