// Server settings > Server info (instance admins): the build it runs, whether it is up to date, its runtime and what it holds.
import { useEffect, useState } from 'react';
import { Info, CircleArrowUp, Check, Copy, Server, Database, RefreshCw, TriangleAlert, Terminal } from 'lucide-react';
import { useChat } from './store.js';
import { instanceConn, loadServerInfo } from './instances.js';
import { Card } from './SettingsShell.jsx';
import { UpdateServerRow } from './UpdateServer.jsx';
import { restartInstance } from './restartInstance.js';

const bytes = n => {
  n = Number(n); if (!Number.isFinite(n) || n < 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};
const num = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '-');
const when = t => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleString() : '-'; };
const span = s => {
  s = Math.floor(Number(s)); if (!Number.isFinite(s) || s < 0) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
};

// why the server gave no update status (GET /instance/info update_reason); older servers send no reason
const NO_STATUS = {
  no_build_identity: 'This server does not know which version it runs, so it cannot compare itself with the latest release. It was built without its git history or build info. Run it from a git clone, or rebuild the Docker image from a git clone, and it will know.',
  check_disabled: 'Update checks are turned off on this server (BONFIRE_UPDATE_CHECK=0).',
  unreachable: 'The server could not reach Nookara to check for updates. Try Refresh in a minute.',
};
const NO_STATUS_OLD = 'This server cannot check for updates. Its software is either older than this page or was built without version info. Updating it fixes this.';
// how the server was installed (install.kind) = how its admin updates it; Nookara-hosted and host-agent servers update from Ember instead
const INSTALL = {
  managed: { label: 'Hosted by Nookara' },
  host_agent: { label: 'Docker, with one-click updates' },
  docker_image: { label: 'Docker (published image)', steps: 'On the machine that runs it, in the folder with docker-compose.yml:', cmd: 'docker compose pull && docker compose up -d' },
  docker_build: { label: 'Docker (built from source)', steps: 'On the machine that runs it, in the ember-server folder:', cmd: 'git pull && docker compose up -d --build' },
  git: { label: 'Git checkout', steps: 'On the machine that runs it, in the ember-server folder, then restart it:', cmd: 'git pull && npm ci --omit=dev', restart: true },
  unknown: { label: 'Unknown', steps: 'Get the latest ember-server from github.com/Ikelene/ember-server, then restart it. Installing from a git clone lets it tell you about updates.' },
};

function CopyCmd({ cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  return (
    <div className="vc-row"><input className="form-input vc-info-mono" readOnly value={cmd} aria-label="Update command" onFocus={e => e.target.select()} />
      <button type="button" className="btn btn-surface" onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div>
  );
}

// the manual steps for a self-hosted server (shown when it is out of date, or cannot tell)
function HowToUpdate({ origin, name, install }) {
  const how = INSTALL[install?.kind];
  if (!how?.steps) return null;
  return (
    <div className="vc-field vc-gap-top"><span><Terminal size={13} /> How to update</span>
      <div className="vc-hint">{how.steps}</div>
      {how.cmd && <CopyCmd cmd={how.cmd} />}
      {install.kind === 'git' && install.dirty && <div className="vc-hint"><TriangleAlert size={13} /> This checkout has local changes to its files; git pull may need you to sort them out first.</div>}
      {how.restart && <button type="button" className="btn btn-surface btn-sm vc-gap-top" onClick={() => restartInstance(origin, name)}><RefreshCw size={13} /> Restart server</button>}
    </div>
  );
}

const Row = ({ label, children }) => <div className="cs-row"><div className="cs-text"><b>{label}</b></div><span className="vc-info-val">{children}</span></div>;

export function ServerInfoPage({ origin, autoUpdate = false }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const info = inst?.serverInfo;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const c = instanceConn(origin); if (c) loadServerInfo(c); }, [origin]);
  // Refresh really checks: the server asks Nookara again instead of answering from its cache
  const refresh = async () => { const c = instanceConn(origin); if (!c) return; setBusy(true); await loadServerInfo(c, { refresh: true }); setBusy(false); };
  if (!inst?.isAdmin) return null;
  if (!info) return <div className="bf-ss-page"><div className="vc-loading"><i /><i /><i /></div></div>;
  const b = info.build || {}, r = info.runtime || {}, st = info.stats || {}, u = info.update;
  const copy = () => navigator.clipboard?.writeText(b.commit || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  return (
    <div className="bf-ss-page">
      <Card title="Version" icon={Info}>
        <Row label="Version">{b.version || '-'}{b.dirty ? ' (modified build)' : ''}</Row>
        <Row label="Commit">{b.commit_short || '-'}</Row>
        <div className="vc-field"><span>Full commit</span>
          <div className="vc-row"><input className="form-input vc-info-mono" readOnly value={b.commit || ''} aria-label="Full commit hash" onFocus={e => e.target.select()} />
            <button type="button" className="btn btn-surface" disabled={!b.commit} onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div></div>
        <Row label="Commit date">{when(b.commit_date)}</Row>
        <Row label="Built at">{when(b.built_at)}</Row>
        {b.dirty && <Row label="Build">Modified build</Row>}
      </Card>
      <Card title="Updates" icon={CircleArrowUp}>
        {!u ? <div className="bf-ss-reg warn"><TriangleAlert size={14} /><span>{NO_STATUS[info.update_reason] || NO_STATUS_OLD}</span></div> : u.outdated
          ? <div className="bf-ss-reg warn"><CircleArrowUp size={14} /><span><b>Out of date.</b> Latest is {u.latest?.commit_short || u.latest?.version || 'newer'}{u.latest?.commit_date ? ` (${when(u.latest.commit_date)})` : ''}.{u.latest?.message ? ` ${u.latest.message}` : ''} {inst.managed ? 'Nookara updates this server automatically within about 10 minutes.' : u.one_click ? 'You can update it right here.' : 'Update it with the steps below.'}{u.checked_at ? ` Checked ${when(u.checked_at)}.` : ''}</span></div>
          : <div className="bf-ss-reg ok"><Check size={14} /><span><b>Up to date.</b>{u.checked_at ? ` Checked ${when(u.checked_at)}.` : ''}</span></div>}
        {u?.outdated && u.one_click && !inst.managed && <UpdateServerRow origin={origin} name={inst.name || inst.host} autoStart={autoUpdate} />}
        {info.install && <Row label="Installed as">{INSTALL[info.install.kind]?.label || info.install.kind}{info.install.kind === 'git' && info.install.branch ? ` (${info.install.branch})` : ''}</Row>}
        {(u?.outdated || info.update_reason === 'no_build_identity') && !u?.one_click && !inst.managed && <HowToUpdate origin={origin} name={inst.name || inst.host} install={info.install} />}
        <button type="button" className="btn btn-surface btn-sm vc-gap-top" disabled={busy} onClick={refresh}><RefreshCw size={13} /> {busy ? 'Checking...' : 'Refresh'}</button>
      </Card>
      <Card title="Runtime" icon={Server}>
        <Row label="Uptime">{span(r.uptime_s)}</Row>
        <Row label="Started">{when(r.started_at)}</Row>
        <Row label="Node">{r.node || '-'}</Row>
        <Row label="Platform">{r.platform || '-'}</Row>
      </Card>
      <Card title="Contents" icon={Database}>
        <Row label="Members">{num(st.members)}</Row>
        <Row label="Channels">{num(st.channels)}</Row>
        <Row label="Messages">{num(st.messages)}</Row>
        <Row label="Uploads">{num(st.upload_count)} ({bytes(st.upload_bytes)})</Row>
        <Row label="Database">{bytes(st.db_bytes)}</Row>
        <Row label="Bots">{num(st.bots)}</Row>
        <Row label="Emojis">{num(st.emojis)}</Row>
        <Row label="Sounds">{num(st.sounds)}</Row>
      </Card>
    </div>
  );
}
