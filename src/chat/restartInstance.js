// restarting an instance from its settings (instance admins only)
import { ask, toast, errorText } from './store.js';
import { apiFetch } from '../api.js';

export async function restartInstance(origin, name) {
  if (!(await ask({ title: `Restart ${name}?`, text: 'Everyone on it is disconnected for a moment while it starts again. It only comes back by itself if it runs under something that restarts it (Docker, systemd).', confirm: 'Restart', danger: true }))) return;
  try { await apiFetch('/api/v1/instance/restart', { inst: origin, method: 'POST' }); toast('Restarting...', true); } catch (e) { toast(errorText(e.message)); }
}
