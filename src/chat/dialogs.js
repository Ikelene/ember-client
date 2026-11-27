// open one of the page's dialogs from anywhere (Chat.jsx listens)
export const dialog = (kind, sid, extra) => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind, sid, ...extra } }));
