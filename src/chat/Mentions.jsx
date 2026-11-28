// Typing @ in the composer: pick a member, a role (that you're allowed to ping) or @everyone / @here.
import { useEffect } from 'react';
import { Handle } from './Handle.jsx';
import { getState, botPresenceOf } from './store.js';
import { Avatar } from './Profile.jsx';
import { ChannelIcon } from './roles.jsx';
import { nameColor } from './perms.js';
import { Twemoji } from './emoji.jsx';

export function MentionPicker({ items, sel, setSel, onPick, sid }) {
  useEffect(() => { if (sel >= items.length) setSel(0); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  let lastKind = null;
  return (
    <div className="vc-mentions" onMouseDown={e => e.preventDefault()}>
      {items.map((it, i) => {
        const head = it.kind !== lastKind ? ({ user: 'Members', all: 'Everyone', role: 'Roles', emoji: 'Emoji', channel: 'Channels' })[it.kind] : null;
        lastKind = it.kind;
        return (
          <div key={it.key}>
            {head && <div className="vc-mentions-head">{head}</div>}
            <button type="button" className={`vc-mention-row${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
              {it.kind === 'user' && <Avatar user={it.user} size={24} status={botPresenceOf(it.user) || getState().presence[it.user.username]?.status || it.user.presence?.status} />}
              {it.kind === 'emoji' && (it.img ? <img className="vc-sug-emoji" src={it.img} alt="" /> : <Twemoji char={it.char} className="vc-sug-emoji" />)}
              {it.kind === 'channel' && <span className="vc-sug-ch"><ChannelIcon c={it.channel} size={16} /></span>}
              <b style={it.kind === 'role' ? { color: it.role.color || undefined } : it.kind === 'user' ? { color: nameColor(sid, it.user) || undefined } : undefined}>{it.label}</b>
              {it.kind === 'user' && it.handle ? <small>(<Handle handle={it.handle} />){it.you ? ' - you' : ''}</small> : it.hint && <small>{it.hint}</small>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
