// small helpers for the friends / DMs home
import { useChat, socialAccount } from './store.js';

export const face = a => ({ username: a.display_name || a.handle || a.id, pfp: a.avatar_url || null }); // (the name gives the letter and colour when there's no picture)

export const useDomain = () => useChat(s => socialAccount(s)?.domain || '');
