// Android saves the original HTTPS file through Download Manager. A blob URL
// belongs to the WebView process and cannot be opened by that service, so those go over as bytes.
export async function saveMedia(url, name) {
  const original = new URL(url, location.href);
  const filename = name || decodeURIComponent(original.pathname.split('/').pop() || 'image');
  if (original.protocol === 'https:' && window.BonfireDownloads?.postMessage) {
    window.BonfireDownloads.postMessage(JSON.stringify({ url: original.href, name: filename }));
    return;
  }
  const response = await fetch(original.href, original.protocol === 'https:' ? { mode: 'cors', credentials: 'omit' } : undefined);
  if (!response.ok) throw new Error('download_failed');
  const blob = await response.blob();
  // the Android app can't see a blob:/data: link (a decrypted file, say), so it gets the bytes and saves them itself
  if (window.BonfireDownloads?.postMessage) {
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(blob); });
    window.BonfireDownloads.postMessage(JSON.stringify({ name: filename, mime: blob.type || '', data }));
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}
