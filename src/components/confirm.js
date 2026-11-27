// confirmBox(): a yes / no dialog from anywhere (confirmBox.jsx hosts it)
let show = null; // set by the mounted host
export const setConfirmHost = f => { show = f; };

export function confirmBox(text, opts = {}) {
  if (!show) return Promise.resolve(window.confirm(text)); // no host on this page (shouldn't happen)
  return new Promise(resolve => show({ text, ...opts, resolve }));
}
