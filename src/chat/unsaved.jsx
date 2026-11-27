import { Check } from 'lucide-react';

// busy: saving right now; disabled: can't save yet (a field is invalid)
export function UnsavedBar({ changed, bar, busy, disabled, onReset, onSave }) {
  return (
    <div className={`bf-pe-bar${changed || bar === 'saved' ? ' on' : ''}${bar ? ` ${bar}` : ''}`} role="status">
      <span className="bf-pe-bar-text">{bar === 'saved' && !changed ? <><Check size={14} className="vc-inline-ico" /> Saved</> : 'Careful - you have unsaved changes!'}</span>
      {changed && <button type="button" className="bf-pe-bar-reset" onClick={onReset}>Reset</button>}
      {changed && <button type="button" className="btn btn-primary btn-sm" disabled={busy || disabled} onClick={onSave}>{busy ? 'Saving...' : 'Save changes'}</button>}
    </div>
  );
}
