// one hover toolbar per message list: it glides to the message under the mouse instead of each message drawing its own
// (MessageList moves it; the hovered Message portals its buttons into it)
export const hoverSubs = new Set();

export let hovId = null;

export const setHovered = id => { if (id === hovId) return; hovId = id; hoverSubs.forEach(f => f()); };
