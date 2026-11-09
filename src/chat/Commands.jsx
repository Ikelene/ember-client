import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { X, ExternalLink, Check, ChevronDown, Paperclip, EyeOff, Loader, LayoutGrid } from 'lucide-react';
import { useChat, toast, errorText, sendInteraction, dismissEphemeral, closeInteractionModal, uploadAttachment } from './store.js';
import { bare } from './ids.js';
import { Avatar } from './Profile.jsx';
import { Dialog } from './Dialogs.jsx';
import { BotTag } from './Bots.jsx';
import { T, interactionError } from './commands.js';
import './Commands.css';

const fail = e => toast(interactionError(e) || errorText(e.message));

export function CommandPicker({ items, sel, setSel, onPick, bots = [], bot = null, onBot }) {
  useEffect(() => { if (sel >= items.length) setSel(0); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = useRef(null);
  const railOn = useRef(null);
  useEffect(() => { on.current?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  useEffect(() => { railOn.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [bot]);
  const rail = bots.length > 1 && onBot;
  if (!items.length && !rail) return null;
  const only = bot ? bots.find(b => b.id === bot) : null;
  let last = null;
  const list = (
    <div className="vc-cmd-list">
      {!items.length && <div className="vc-cmd-none">No commands from {only?.username || 'this bot'} match that.</div>}
      {items.map((it, i) => {
        const head = it.bot.id !== last ? it.bot : null;
        last = it.bot.id;
        return (
          <div key={it.key}>
            {head && <div className="vc-mentions-head vc-cmd-bot"><Avatar user={head} size={16} />{head.username}<BotTag small verified={!!head.verified} />{!head.online && <small>offline</small>}</div>}
            <button type="button" ref={i === sel ? on : null} className={`vc-mention-row vc-cmd-row${i === sel ? ' on' : ''}${it.bot.online ? '' : ' off'}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
              <b>/{it.label}</b>
              <span className="vc-cmd-sig">{it.options.map(o => <i key={o.name} className={o.required ? 'req' : ''}>{o.name}</i>)}</span>
              <small>{it.description}</small>
            </button>
          </div>
        );
      })}
    </div>
  );
  if (!rail) return <div className="vc-mentions vc-cmd-picker" onMouseDown={e => e.preventDefault()}>{list}</div>;
  return (
    <div className="vc-mentions vc-cmd-picker has-rail" onMouseDown={e => e.preventDefault()}>
      <div className="vc-cmd-rail" role="tablist" aria-label="Filter commands by bot (Alt + Up/Down)">
        <button type="button" role="tab" aria-selected={!bot} ref={!bot ? railOn : null} className={`vc-cmd-rail-btn all${!bot ? ' on' : ''}`} title="All bots (Alt + Up/Down to switch)" aria-label="All bots" onClick={() => onBot(null)}><LayoutGrid size={18} /></button>
        <span className="vc-cmd-rail-sep" />
        {bots.map(b => (
          <button type="button" role="tab" key={b.id} aria-selected={bot === b.id} ref={bot === b.id ? railOn : null} className={`vc-cmd-rail-btn${bot === b.id ? ' on' : ''}${b.online ? '' : ' off'}`} title={b.online ? b.username : `${b.username} (offline)`} aria-label={b.username} onClick={() => onBot(bot === b.id ? null : b.id)}>
            <Avatar user={b} size={28} />
          </button>
        ))}
      </div>
      {list}
    </div>
  );
}

const PICK_TYPES = [T.USER, T.ROLE, T.CHANNEL, T.MENTIONABLE];
const strip = s => String(s || '').trim().toLowerCase().replace(/^[@#]/, '');
// a typed name that exactly matches someone / a role / a channel counts as picked, so "/gayrate bob" + Enter just works
function resolveTyped(o, text, members, detail) {
  const q = strip(text);
  if (!q) return null;
  const person = () => (members || []).find(m => String(m.username).toLowerCase() === q);
  const role = () => (detail?.roles || []).find(r => !r.is_default && String(r.name).toLowerCase() === q);
  if (o.type === T.USER) return person()?.id ?? null;
  if (o.type === T.ROLE) return role()?.rid ?? null;
  if (o.type === T.MENTIONABLE) return person()?.id ?? role()?.rid ?? null;
  if (o.type === T.CHANNEL) return (detail?.channels || []).find(c => String(c.name).toLowerCase() === q)?.cid ?? null;
  return null;
}

function useChoices(o, sid, view, entry, vals, text) {
  const members = useChat(s => s.members[sid]);
  const detail = useChat(s => s.detail[sid]);
  const [auto, setAuto] = useState([]);
  const ask = useRef(0);
  useEffect(() => {
    if (!o.autocomplete) return undefined;
    const n = ++ask.current;
    const t = setTimeout(() => {
      const values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.value !== '' && v.value != null).map(([k, v]) => [k, v.value]));
      values[o.name] = text;
      sendInteraction(sid, { type: 4, channel: view.cid, command: entry.cmd.id, path: entry.path, values, focused: o.name })
        .then(d => { if (n === ask.current) setAuto((d?.choices || []).map(c => ({ label: c.name, value: c.value }))); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [text, o.autocomplete]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const q = strip(text);
    const has = s => !q || String(s).toLowerCase().includes(q);
    const starts = s => String(s).toLowerCase().startsWith(q);
    const people = () => (members || []).filter(m => has(m.username)).sort((a, b) => starts(b.username) - starts(a.username)).slice(0, 8)
      .map(m => ({ label: `@${m.username}`, text: m.username, value: m.id, user: m }));
    const roles = () => (detail?.roles || []).filter(r => !r.is_default && has(r.name)).slice(0, 8).map(r => ({ label: `@${r.name}`, text: r.name, value: r.rid }));
    if (o.type === T.USER) return people();
    if (o.type === T.ROLE) return roles();
    if (o.type === T.MENTIONABLE) return [...people(), ...roles()].slice(0, 10);
    if (o.type === T.CHANNEL) return (detail?.channels || []).filter(c => (o.channel_types?.length ? o.channel_types.includes(c.type === 'voice' ? 2 : 0) : c.type !== 'voice') && has(c.name)).slice(0, 10).map(c => ({ label: `#${c.name}`, text: c.name, value: c.cid }));
    if (o.choices?.length) return o.choices.filter(c => has(c.name)).map(c => ({ label: c.name, text: c.name, value: c.value }));
    if (o.autocomplete) return auto.map(c => ({ ...c, text: c.label }));
    return [];
  }, [text, members, detail, auto, o]);
}

// caret helpers for moving between fields with the arrow keys
const atEnd = el => el?.selectionStart == null || (el.selectionStart === el.selectionEnd && el.selectionEnd === String(el.value ?? '').length);
const atStart = el => el?.selectionStart == null || (el.selectionStart === 0 && el.selectionEnd === 0);

function OptionField({ o, field, setField, view, entry, vals, innerRef, onSubmit, onBack, onNext, onPrev, onOpen, hasNext, ready, problem }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const picks = PICK_TYPES.includes(o.type) || o.choices?.length || o.autocomplete;
  const items = useChoices(o, view.sid, view, entry, vals, field.text);
  const file = useRef(null);
  const [up, setUp] = useState(false);
  const shown = open && items.length > 0;
  useEffect(() => { onOpen(shown); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel >= items.length) setSel(0); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = it => { setField({ text: it.text ?? it.label, value: it.value, picked: true }); setOpen(false); onNext(); };
  const type = text => setField(PICK_TYPES.includes(o.type) || o.choices?.length ? { text, value: '' } : { text, value: text });
  // Left/Right at the edges, Tab / Shift+Tab: walk the fields (the "+ option" box at the end included)
  const walk = (e, el) => {
    if (e.key === 'ArrowRight' && !e.shiftKey && atEnd(el) && hasNext) { e.preventDefault(); onNext(); return true; }
    if (e.key === 'ArrowLeft' && !e.shiftKey && atStart(el)) { e.preventDefault(); onPrev(); return true; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); onPrev(); return true; }
    if (e.key === 'Tab' && hasNext) { e.preventDefault(); onNext(); return true; }
    return false;
  };
  if (o.type === T.BOOLEAN) {
    const set = v => setField({ text: '', value: v });
    return (
      <span className="vc-cmd-bool" ref={innerRef} tabIndex={0} role="radiogroup" aria-label={o.name} onKeyDown={e => {
        if (walk(e, null)) return;
        if (e.key === 'Enter') { e.preventDefault(); onSubmit(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); if (field.value == null) onBack(); else set(null); return; }
        if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(!(field.value === true)); return; }
        if (/^[ty1]$/i.test(e.key)) set(true);
        if (/^[fn0]$/i.test(e.key)) set(false);
      }}>
        {[true, false].map(v => <button type="button" tabIndex={-1} key={String(v)} className={field.value === v ? 'on' : ''} onClick={() => set(v)}>{v ? 'True' : 'False'}</button>)}
      </span>
    );
  }
  if (o.type === T.ATTACHMENT) {
    return (
      <span className="vc-cmd-file">
        <input ref={file} type="file" hidden onChange={async e => {
          const f = e.target.files[0]; e.target.value = '';
          if (!f) return;
          setUp(true);
          try { const a = await uploadAttachment(view, f); setField({ text: f.name, value: a.url }); } catch (er) { toast(errorText(er.message)); }
          setUp(false);
        }} />
        <button type="button" ref={innerRef} onKeyDown={e => {
          if (walk(e, null)) return;
          if (e.key === 'Backspace') { e.preventDefault(); if (field.text) setField({ text: '', value: '' }); else onBack(); }
        }} onClick={() => file.current?.click()}>{up ? <Loader size={13} className="spin" /> : <Paperclip size={13} />} {field.text || 'Choose a file'}</button>
      </span>
    );
  }
  return (
    <span className="vc-cmd-field">
      <input
        ref={innerRef} value={field.text} placeholder={o.description} size={Math.max(6, Math.min(24, (field.text || o.description || '').length + 1))}
        inputMode={o.type === T.INTEGER || o.type === T.NUMBER ? 'decimal' : 'text'} enterKeyHint={ready ? 'send' : 'next'}
        maxLength={o.max_length || 6000} spellCheck={o.type === T.STRING && !picks} autoComplete="off" autoCapitalize="off"
        role={picks ? 'combobox' : undefined} aria-expanded={picks ? shown : undefined} aria-label={o.name}
        onFocus={() => { setOpen(true); setSel(0); }} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={e => { type(e.target.value); setOpen(true); setSel(0); }}
        onKeyDown={e => {
          if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); onBack(); return; }
          if (shown) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(x => (x + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(x => (x - 1 + items.length) % items.length); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
            // Enter / Tab put the highlighted suggestion in and move on (a pick already made stays: Enter then runs the command)
            if ((e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) && items[sel] && !field.picked) { e.preventDefault(); pick(items[sel]); return; }
          }
          if (walk(e, e.target)) return;
          if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
        }} />
      {shown && (
        <span className="vc-cmd-sug" role="listbox" onMouseDown={e => e.preventDefault()}>
          <span className={`vc-cmd-sug-head${problem ? ' bad' : ''}`}><b>{o.name}</b>{problem || o.description}</span>
          {items.map((it, i) => (
            <button type="button" role="option" aria-selected={i === sel} key={`${it.label}${i}`} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(it)}>
              {it.user && <Avatar user={it.user} size={18} />}<span>{it.label}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// the box after the fields: type part of an optional field's name, Enter / Tab puts that field in and the cursor in it
function OptionTail({ spare, innerRef, onAdd, onPrev, onSubmit, onOpen, ready }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [moved, setMoved] = useState(false);
  const q = text.trim().toLowerCase().replace(/[:=]$/, '');
  const list = useMemo(() => spare.filter(o => !q || o.name.toLowerCase().includes(q))
    .sort((a, b) => b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)), [spare, q]);
  const shown = open && list.length > 0;
  useEffect(() => { onOpen(shown); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel >= list.length) setSel(0); }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = o => { setText(''); setMoved(false); setOpen(false); onAdd(o); };
  return (
    <span className="vc-cmd-field vc-cmd-tail">
      <input
        ref={innerRef} value={text} placeholder="+ option" aria-label="Add an optional field" size={Math.max(8, text.length + 1)}
        role="combobox" aria-expanded={shown} autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint={ready ? 'send' : 'next'}
        onFocus={() => { setOpen(true); setSel(0); }} onBlur={() => setTimeout(() => { setOpen(false); setText(''); setMoved(false); }, 120)}
        onChange={e => {
          const v = e.target.value;
          // "name:" or "name " with an exact name puts the field in straight away
          const exact = /[:= ]$/.test(v) && spare.find(o => o.name.toLowerCase() === v.slice(0, -1).trim().toLowerCase());
          if (exact) { add(exact); return; }
          setText(v); setOpen(true); setSel(0);
        }}
        onKeyDown={e => {
          if (e.key === 'Backspace' && !text) { e.preventDefault(); onPrev(); return; }
          if ((e.key === 'ArrowLeft' && atStart(e.target)) || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); onPrev(); return; }
          if (shown && e.key === 'ArrowDown') { e.preventDefault(); setMoved(true); setSel(x => (x + 1) % list.length); return; }
          if (shown && e.key === 'ArrowUp') { e.preventDefault(); setMoved(true); setSel(x => (x - 1 + list.length) % list.length); return; }
          if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
          if (e.key === 'Tab' && list[sel]) { e.preventDefault(); add(list[sel]); return; }
          if (e.key === 'Enter') {
            e.preventDefault();
            // nothing typed and no arrowing: Enter still runs the command
            if ((text.trim() || moved) && list[sel]) add(list[sel]); else onSubmit();
          }
        }} />
      {shown && (
        <span className="vc-cmd-sug vc-cmd-more-list" role="listbox" onMouseDown={e => e.preventDefault()}>
          <span className="vc-cmd-sug-head"><b>Optional</b>type to filter, Enter adds it</span>
          {list.map((o, i) => <button type="button" role="option" aria-selected={i === sel} key={o.name} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => add(o)}><b>{o.name}</b>{o.description && <small>{o.description}</small>}</button>)}
        </span>
      )}
    </span>
  );
}

const TAIL = '\u0000tail';

export function CommandBar({ view, entry, onCancel, onSent, submitRef, onReady }) {
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);
  const [missing, setMissing] = useState(null); // the required field Enter / Send stopped at
  const [listOpen, setListOpen] = useState(false);
  const members = useChat(s => s.members[view.sid]);
  const detail = useChat(s => s.detail[view.sid]);
  const refs = useRef({});
  const ghost = useRef(null);
  const all = entry.options;
  const [extra, setExtra] = useState([]); // optional options the user added
  const opts = useMemo(() => all.filter(o => o.required || extra.includes(o.name)), [all, extra]);
  const spare = all.filter(o => !o.required && !extra.includes(o.name));
  const order = [...opts.map(o => o.name), ...(spare.length ? [TAIL] : [])];
  // focus right away when the field is already on screen (so fast typing never lands in the old field), else after the render
  const go = (name, where = 'end') => {
    const to = () => {
      const el = refs.current[name] || (name == null ? ghost.current : null);
      if (!el || !el.isConnected) return false;
      el.focus();
      if (el.setSelectionRange && el.value != null) { const n = where === 'start' ? 0 : el.value.length; el.setSelectionRange(n, n); }
      return true;
    };
    if (!to()) setTimeout(to, 0);
  };
  const step = (name, d) => { const i = order.indexOf(name); const to = order[i + d]; if (to) go(to, d > 0 ? 'start' : 'end'); };
  const back = o => {
    const i = opts.findIndex(x => x.name === o.name);
    const prev = opts[i - 1];
    if (!o.required) {
      setExtra(x => x.filter(n => n !== o.name));
      setVals(v => { const n = { ...v }; delete n[o.name]; return n; });
      const to = prev?.name || opts[i + 1]?.name || TAIL;
      go(to);
      return;
    }
    if (prev) go(prev.name); else onCancel();
  };
  const add = o => { flushSync(() => setExtra(x => [...x, o.name])); go(o.name); };
  const field = o => vals[o.name] || { text: '', value: o.type === T.BOOLEAN ? null : '' };
  // what gets sent for one field: undefined = left empty, false = filled in wrong (with why)
  const valueOf = o => {
    const f = field(o);
    // autocomplete: a picked suggestion sends its value (the text shows its name); anything typed by hand is sent as typed
    if (o.type === T.STRING && !o.choices?.length) return f.text.trim() ? { v: f.picked && f.value !== '' ? f.value : f.text } : undefined;
    if (o.type === T.BOOLEAN) return f.value == null ? undefined : { v: f.value };
    if (PICK_TYPES.includes(o.type)) {
      if (!f.text.trim() && !f.value) return undefined;
      const id = f.value || resolveTyped(o, f.text, members, detail);
      return id ? { v: bare(id) } : { bad: `Pick ${o.name} from the list.` };
    }
    if (o.choices?.length) {
      if (!f.text.trim()) return undefined;
      const c = f.value !== '' ? { value: f.value } : o.choices.find(x => x.name.toLowerCase() === f.text.trim().toLowerCase());
      return c ? { v: c.value } : { bad: `Pick ${o.name} from the list.` };
    }
    if (o.type === T.INTEGER || o.type === T.NUMBER) {
      if (!String(f.text).trim()) return undefined;
      if (f.picked && typeof f.value === 'number') return { v: f.value };
      const n = Number(String(f.text).trim());
      if (!Number.isFinite(n) || (o.type === T.INTEGER && !Number.isInteger(n))) return { bad: `${o.name} needs ${o.type === T.INTEGER ? 'a whole number' : 'a number'}.` };
      return { v: n };
    }
    return f.value === '' || f.value == null ? undefined : { v: f.value };
  };
  const firstMissing = opts.find(o => { if (!o.required) return false; const r = valueOf(o); return !r || !!r.bad; });
  const ready = !firstMissing;
  useEffect(() => { onReady?.(ready ? null : firstMissing.name); }, [ready, firstMissing?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onReady?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { go(opts[0]?.name || (spare.length ? TAIL : null)); }, [entry.key]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    if (busy) return;
    const values = {};
    for (const o of opts) {
      const r = valueOf(o);
      if (!r) {
        if (o.required) { setMissing(o.name); go(o.name); return; }
        continue;
      }
      if (r.bad) { toast(r.bad); setMissing(o.name); go(o.name); return; }
      values[o.name] = r.v;
    }
    setBusy(true);
    try { await sendInteraction(view.sid, { type: 2, channel: view.cid, command: entry.cmd.id, path: entry.path, values }); onSent(); }
    catch (e) { fail(e); setBusy(false); }
  }
  if (submitRef) submitRef.current = submit;
  const cur = opts.find(o => o.name === active);
  const miss = opts.find(o => o.name === missing);
  const hint = miss
    ? <div className="vc-cmd-hint bad" role="alert"><b>{miss.name}</b> {valueOf(miss)?.bad || `is required${miss.description ? `: ${miss.description}` : '.'}`}</div>
    : listOpen ? null
      : cur ? <div className="vc-cmd-hint"><b>{cur.name}</b> {cur.description}{!cur.required && <small> (optional)</small>}</div>
        : active === TAIL ? null
          : !opts.length && !spare.length ? <div className="vc-cmd-hint"><b>/{entry.label}</b> {entry.description} - press Enter to run it.</div> : null;
  return (
    <div className="vc-cmdbar" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
      {hint}
      <span className="vc-cmd-chip" title={`${entry.bot.username}: /${entry.label}`}><Avatar user={entry.bot} size={16} />/{entry.label}</span>
      {opts.map(o => (
        <label key={o.name} className={`vc-cmd-opt${active === o.name ? ' on' : ''}${missing === o.name ? ' missing' : ''}${o.required ? ' req' : ''}`} onFocus={() => setActive(o.name)} onBlur={() => setActive(a => (a === o.name ? null : a))}>
          <span className="vc-cmd-name">{o.name}{o.required && <em aria-label="required">*</em>}</span>
          <OptionField
            o={o} field={field(o)} view={view} entry={entry} vals={vals} ready={ready}
            setField={f => { setVals(v => ({ ...v, [o.name]: f })); if (missing === o.name) setMissing(null); }}
            innerRef={el => { refs.current[o.name] = el; }} onSubmit={submit} onBack={() => back(o)}
            onNext={() => step(o.name, 1)} onPrev={() => step(o.name, -1)} hasNext={order.indexOf(o.name) < order.length - 1} onOpen={setListOpen}
            problem={missing === o.name ? valueOf(o)?.bad || 'is required - pick one to run the command' : null} />
        </label>
      ))}
      {spare.length > 0 && (
        <span className={`vc-cmd-more${active === TAIL ? ' on' : ''}`} onFocus={() => setActive(TAIL)} onBlur={() => setActive(a => (a === TAIL ? null : a))}>
          <OptionTail spare={spare} ready={ready} innerRef={el => { refs.current[TAIL] = el; }} onAdd={add} onPrev={() => step(TAIL, -1)} onSubmit={submit} onOpen={setListOpen} />
        </span>
      )}
      {!opts.length && !spare.length && <input ref={ghost} className="vc-cmd-ghost" aria-label={`Run /${entry.label}`} enterKeyHint="send" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Backspace') { e.preventDefault(); onCancel(); } }} />}
      <button type="button" className="vc-cmd-x" title="Clear this command (Esc)" aria-label="Clear this command" onClick={onCancel}><X size={15} strokeWidth={2.5} /><span>Clear</span></button>
    </div>
  );
}

const Emoji = ({ e }) => (e?.name && !e.id ? <span className="vc-cbtn-emoji">{e.name}</span> : null);
function useOptions(def, view) {
  const members = useChat(s => s.members[view.sid]);
  const detail = useChat(s => s.detail[view.sid]);
  return useMemo(() => {
    if (def.type === 3) return def.options.map(o => ({ label: o.label, value: o.value, description: o.description, emoji: o.emoji, on: !!o.default }));
    const people = (members || []).map(m => ({ label: `@${m.username}`, value: m.id }));
    const roles = (detail?.roles || []).filter(r => !r.is_default).map(r => ({ label: `@${r.name}`, value: r.rid }));
    const chans = (detail?.channels || []).filter(c => c.type !== 'voice').map(c => ({ label: `#${c.name}`, value: c.cid }));
    return def.type === 5 ? people : def.type === 6 ? roles : def.type === 8 ? chans : [...people, ...roles];
  }, [def, members, detail]);
}
function SelectMenu({ def, m, view, busy, send }) {
  const options = useOptions(def, view);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set(options.filter(o => o.on).map(o => o.value)));
  const multi = def.max_values > 1;
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = e => { if (!box.current?.contains(e.target)) setOpen(false); };
    addEventListener('mousedown', off);
    return () => removeEventListener('mousedown', off);
  }, [open]);
  const chosen = options.filter(o => picked.has(o.value));
  const toggle = o => {
    if (!multi) { setOpen(false); send(def, [o.value]); return; }
    setPicked(p => { const n = new Set(p); if (n.has(o.value)) n.delete(o.value); else if (n.size < def.max_values) n.add(o.value); return n; });
  };
  return (
    <span className="vc-csel" ref={box}>
      <button type="button" disabled={def.disabled || busy} onClick={() => setOpen(o => !o)}>
        <span>{chosen.length ? chosen.map(o => o.label).join(', ') : def.placeholder || 'Make a selection'}</span><ChevronDown size={14} />
      </button>
      {open && (
        <span className="vc-csel-list">
          {options.length === 0 && <small>Nothing to pick from.</small>}
          {options.map(o => (
            <button type="button" key={o.value} className={picked.has(o.value) && multi ? 'on' : ''} onClick={() => toggle(o)}>
              <Emoji e={o.emoji} /><span>{o.label}{o.description && <small>{o.description}</small>}</span>{multi && picked.has(o.value) && <Check size={13} />}
            </button>
          ))}
          {multi && <button type="button" className="vc-csel-done" disabled={picked.size < def.min_values} onClick={() => { setOpen(false); send(def, [...picked]); }}>Done</button>}
        </span>
      )}
    </span>
  );
}
export function MessageComponents({ m, view }) {
  const [busy, setBusy] = useState(false);
  if (!m.components?.length || view.kind !== 'channel') return null;
  const send = (def, selected) => {
    if (busy) return;
    setBusy(true);
    sendInteraction(view.sid, { type: 3, channel: view.cid, message: m.id, custom_id: def.custom_id, ...(selected ? { selected } : {}) }).catch(fail).finally(() => setTimeout(() => setBusy(false), 500));
  };
  return (
    <div className="vc-comps">
      {m.components.map((row, i) => (
        <div className="vc-comp-row" key={i}>
          {row.components.map((c, j) => (c.type === 2
            ? (c.style === 5
              ? <a key={j} className="vc-cbtn s5" href={c.url} target="_blank" rel="noopener noreferrer"><Emoji e={c.emoji} />{c.label}<ExternalLink size={12} /></a>
              : <button type="button" key={j} className={`vc-cbtn s${c.style}`} disabled={c.disabled || busy} onClick={() => send(c)}><Emoji e={c.emoji} />{c.label}</button>)
            : <SelectMenu key={j} def={c} m={m} view={view} busy={busy} send={send} />))}
        </div>
      ))}
    </div>
  );
}

export function InteractionLine({ m, sid, onUser }) {
  const i = m.interaction;
  // older rows only stored id + username, so fall back to the member list for the pfp
  const member = useChat(s => (i?.user?.username && sid ? (s.members[sid] || []).find(x => x.username === i.user.username) : null));
  if (!i?.user) return null;
  const user = { ...member, ...i.user, pfp: i.user.pfp || member?.pfp || null };
  const open = e => { e.stopPropagation(); onUser?.(user.username, e.currentTarget); };
  return (
    <div className="vc-reply-to vc-interaction">
      <span className="vc-reply-line" />
      <button type="button" className="vc-int-who" onClick={open} title={`Open ${user.username}'s profile`}>
        <Avatar user={user} size={16} />
        <b>{user.username}</b>
      </button>
      <span>used <span className="vc-cmd-used">/{i.name}</span></span>
    </div>
  );
}
export function Thinking({ m }) {
  return <div className="vc-thinking"><i /><i /><i /><span>{m.author?.username || 'The bot'} is thinking...</span></div>;
}
export function EphemeralNote({ m, view }) {
  return <div className="vc-eph-note"><EyeOff size={12} /> Only you can see this <button type="button" onClick={() => dismissEphemeral(view, m)}>Dismiss message</button></div>;
}

function ModalForm({ ev }) {
  const rows = ev.modal.components.map(r => (r.type === 18 ? { ...r.component, label: r.label || r.component.label, hint: r.description } : { ...r.components[0] }));
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.custom_id, r.value || ''])));
  const [busy, setBusy] = useState(false);
  async function submit(close) {
    for (const r of rows) if (r.required && !String(vals[r.custom_id] || '').trim()) { toast(`${r.label || 'A field'} is required.`); return; }
    setBusy(true);
    try { await sendInteraction(ev.server, { type: 5, channel: ev.channel, source: ev.interaction, fields: vals }); close(); }
    catch (e) { fail(e); setBusy(false); }
  }
  return (
    <Dialog title={ev.modal.title} onClose={closeInteractionModal}>
      {close => (
        <form onSubmit={e => { e.preventDefault(); submit(close); }}>
          {rows.map((r, i) => (
            <label key={r.custom_id} className="vc-field">
              <span>{r.label}{r.required && <em>*</em>}</span>
              {r.hint && <small>{r.hint}</small>}
              {r.style === 2
                ? <textarea className="form-input" autoFocus={i === 0} rows={4} value={vals[r.custom_id]} placeholder={r.placeholder} minLength={r.min_length} maxLength={r.max_length || 4000} onChange={e => setVals(v => ({ ...v, [r.custom_id]: e.target.value }))} />
                : <input className="form-input" autoFocus={i === 0} value={vals[r.custom_id]} placeholder={r.placeholder} minLength={r.min_length} maxLength={r.max_length || 4000} onChange={e => setVals(v => ({ ...v, [r.custom_id]: e.target.value }))} />}
            </label>
          ))}
          <div className="vc-dialog-btns">
            <span className="grow" />
            <button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>Submit</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
export function InteractionModalHost() {
  const ev = useChat(s => s.interactionModal);
  return ev ? <ModalForm key={ev.interaction} ev={ev} /> : null;
}
