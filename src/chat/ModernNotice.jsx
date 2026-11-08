// Modern is the new default: index.html moved this device over from Classic (bf_modern_default = 'notice'), so say so once,
// with a way straight back. Either button settles it ('seen'); the choice stays in Settings > Look & feel > Design.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { setDesign } from './design.js';

const KEY = 'bf_modern_default';
const pending = () => { try { return localStorage.getItem(KEY) === 'notice'; } catch { return false; } };

export default function ModernNotice() {
  const [open, setOpen] = useState(pending);
  if (!open) return null;
  const done = classic => {
    try { localStorage.setItem(KEY, 'seen'); } catch { /* private mode */ }
    if (classic) setDesign('square');
    setOpen(false);
  };
  return createPortal(
    <div className="vc-modal-back vc-modern-notice-back" role="presentation">
      <div className="vc-modern-notice vl-rise" role="dialog" aria-modal="true" aria-labelledby="vc-mn-title">
        <span className="vc-modern-notice-ico"><Sparkles size={26} /></span>
        <h2 id="vc-mn-title">Modern is the new default</h2>
        <p>Ember now uses the Modern look: bigger, softer and roomier, with themes, fonts and more. You can switch back to Classic at any time in Settings &gt; Look &amp; feel &gt; Design.</p>
        <div className="vc-modern-notice-btns">
          <button type="button" className="btn btn-surface" onClick={() => done(true)}>Go back to Classic</button>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => done(false)}>Got it</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
