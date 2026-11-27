import { shownName } from './spoiler.js';
import { RISKY, KIND_OF, fmtSize } from './fileKinds.js';
import { useTempFile } from './tempFile.js';
import { isCdnTemp } from './upload-dest.js';
import { TEMP_LINK, toast, ask } from './store.js';
import { saveMedia } from './mediaDownload.js';
import { downloadsBridge } from '../compat.js';
import { FileArchive, FileCode, FileText, File as FileIcon, Download } from 'lucide-react';

// a file attachment's card (name, kind, size, download), or the note left when a temporary file has expired
export function ExpiredFile({ name }) {
  return <div className="vc-filecard vc-att-expired"><FileIcon size={18} /><span><b>{shownName(name) || 'File'}</b><small>This file expired. Temporary files are deleted after a set time.</small></span></div>;
}

export function FileCard({ a, live = true }) {
  const name = shownName((() => { try { return decodeURIComponent(a.name || a.url.split('/').pop()); } catch { return a.name || 'file'; } })());
  const ext = (/\.([a-z0-9]{1,10})$/i.exec(name)?.[1] || /\.([a-z0-9]{1,10})$/i.exec(a.url)?.[1] || '').toLowerCase();
  const risky = RISKY.test(ext);
  const temp = useTempFile(a.url, live);
  // A temporary file in the CDN bucket ignores ?dl=1 (nothing runs in front of the bucket), and a plain-text one would open in the tab instead of
  // downloading: those are fetched and saved with their real name (mediaDownload.js, the same path the picture viewer uses; the Android app
  // hands the https link to Download Manager). A /t/ link keeps ?dl=1. If the fetch is refused, the link opens in a new tab instead.
  const cdn = isCdnTemp(a.url);
  const dl = /^https:\/\/files\.catbox\.moe\/[\w-]+\.[a-z0-9]{1,8}$/i.test(a.url) ? `/chat/dl?u=${encodeURIComponent(a.url)}&n=${encodeURIComponent(name)}`
    : TEMP_LINK.test(a.url) && !cdn ? `${a.url.split(/[?#]/)[0]}?dl=1` : a.url;
  const fetchDl = () => saveMedia(a.url, name).catch(() => { toast("Couldn't save it directly - opening it instead."); window.open(a.url, '_blank', 'noopener,noreferrer'); });
  const open = async e => {
    const inApp = !!downloadsBridge()?.postMessage; // the Android app saves it with its real name instead of the link's
    if (!risky && !cdn && !inApp) return; // the link just downloads
    e.preventDefault();
    if (risky && !(await ask({ title: 'Download this program?', text: `${name} can run code on your computer. Only open files from people you trust.`, confirm: 'Download' }))) return;
    if (cdn || inApp) fetchDl(); else location.href = dl;
  };
  if (temp === 'gone') return <ExpiredFile name={name} />;
  const Ico = /^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext) ? FileArchive : /^(js|ts|jsx|tsx|py|json|html|css|c|cpp|cs|java|lua|sb3|pmp|sh|ps1)$/.test(ext) ? FileCode : /^(txt|md|pdf|doc|docx|rtf|odt|log)$/.test(ext) ? FileText : FileIcon;
  return (
    <div className="vc-filecard">
      <span className="vc-filecard-ico"><Ico size={26} />{ext && <b>{ext.slice(0, 4)}</b>}</span>
      <div className="vc-filecard-txt">
        <a className="vc-filecard-name" href={dl} download={name} onClick={open} title={name}>{name}</a>
        <small>{[KIND_OF(ext), fmtSize(a.size)].filter(Boolean).join(' - ')}{temp?.left && <span className="vc-filecard-exp" title={`Temporary file: deleted ${temp.left} from now`}> - expires in {temp.left}</span>}</small>
      </div>
      <a className="vc-filecard-dl" href={dl} download={name} onClick={open} title={`Download ${name}`}><Download size={16} /><span>Download</span></a>
    </div>
  );
}
