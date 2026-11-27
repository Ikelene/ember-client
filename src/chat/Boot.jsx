import { EMBER_MARK } from './emberLogo.js';
import { EMBER_ASSETS } from '../compat.js';

export function BootMark({ size = 88, className = '' }) {
  return (
    <svg className={`vc-bootmark ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ '--boot-t': `${-(Math.round(performance.now()) % 2400)}ms` }}>
      <path className="base" d={EMBER_MARK} pathLength="100" />
      <path className="run" d={EMBER_MARK} pathLength="100" />
    </svg>
  );
}

export function BootScreen() {
  return (
    <div className="vc-boot" role="status" aria-label="Loading Ember">
      <div className="vc-boot-in"><img className="vc-boot-logo" src={`${EMBER_ASSETS}/logo-photo-256.jpg?v=2`} alt="" width={112} height={112} draggable={false} style={{ '--boot-t': `${-(Math.round(performance.now()) % 2600)}ms` }} /><span className="vc-boot-name">Ember</span></div>
    </div>
  );
}
