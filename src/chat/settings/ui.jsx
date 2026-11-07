// Building blocks for the newer settings pages (accounts, hosting, voice & video, theme, text & layout, blocking...):
//   <SettingsPage icon title sub>      the big icon + title + one line under it
//   <SCard title sub target>           a card; hovering it outlines `target` in the page's preview (see PreviewArea)
//   <OptionCards value options onPick> picture cards to choose between (options: [{ v, label, sub, art }])
//   <SRow title sub>{control}</SRow>   a row with text on the left and a control on the right
//   <PreviewArea> + usePv('name')      a live preview; elements marked with usePv(name) get outlined while a card with
//                                       that target is hovered, so you can see what the setting changes
// Square by default; Modern (html.vc-rounded) softens them (settings-ui.css).
import { createContext, useContext, useState } from 'react';
import './settings-ui.css';

const HoverCtx = createContext({ target: null, set: () => {} });
export function PreviewHost({ children }) {
  const [target, set] = useState(null);
  return <HoverCtx.Provider value={{ target, set }}>{children}</HoverCtx.Provider>;
}
// className for something in the preview: outlined while its setting is hovered
export function usePv(name) {
  const { target } = useContext(HoverCtx);
  return target && (Array.isArray(name) ? name.includes(target) : target === name) ? ' pv-hl' : '';
}
export function PreviewArea({ children, label = 'Preview' }) {
  return <div className="sx-preview" aria-hidden="true"><span className="sx-preview-tag">{label}</span>{children}</div>;
}

export function SettingsPage({ icon: Icon, title, sub, children }) {
  return (
    <PreviewHost>
      <div className="sx-page">
        <header className="sx-intro">
          {Icon && <span className="sx-intro-ico"><Icon size={24} /></span>}
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        </header>
        {children}
      </div>
    </PreviewHost>
  );
}

export function SCard({ title, sub, target, action, children, className = '' }) {
  const { set } = useContext(HoverCtx);
  return (
    <section className={`sx-card ${className}`} onMouseEnter={target ? () => set(target) : undefined} onMouseLeave={target ? () => set(null) : undefined}
      onFocusCapture={target ? () => set(target) : undefined} onBlurCapture={target ? () => set(null) : undefined}>
      {(title || action) && <div className="sx-card-head"><div>{title && <h3>{title}</h3>}{sub && <p>{sub}</p>}</div>{action}</div>}
      {children}
    </section>
  );
}

export function SRow({ title, sub, icon: Icon, target, children }) {
  const { set } = useContext(HoverCtx);
  return (
    <div className="sx-row" onMouseEnter={target ? () => set(target) : undefined} onMouseLeave={target ? () => set(null) : undefined}>
      {Icon && <span className="sx-row-ico"><Icon size={18} /></span>}
      <div className="sx-row-txt"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      <div className="sx-row-ctl">{children}</div>
    </div>
  );
}

export function OptionCards({ value, options, onPick, cols }) {
  return (
    <div className="sx-opts" style={cols ? { '--cols': cols } : undefined} role="radiogroup">
      {options.map(o => (
        <button type="button" key={o.v} role="radio" aria-checked={value === o.v} className={`sx-opt${value === o.v ? ' on' : ''}`} onClick={() => onPick(o.v)} disabled={o.disabled}>
          {o.art !== undefined && <span className="sx-opt-art">{o.art}</span>}
          <span className="sx-opt-txt"><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`sx-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}

export function ResetButton({ onClick, children = 'Reset this page' }) {
  return <div className="sx-reset"><button type="button" className="btn btn-surface" onClick={onClick}>{children}</button></div>;
}
