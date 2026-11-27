

// the Glint mark (viewfinder corners + a play triangle, glint/web/static/glint-icon.svg); all currentColor, square corners. Works as a menu icon too ({ size }).
export function GlintMark({ size = 14, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="12" y="12" width="26" height="6" fill="currentColor" />
      <rect x="12" y="12" width="6" height="26" fill="currentColor" />
      <rect x="62" y="12" width="26" height="6" fill="currentColor" />
      <rect x="82" y="12" width="6" height="26" fill="currentColor" />
      <rect x="12" y="82" width="26" height="6" fill="currentColor" />
      <rect x="12" y="62" width="6" height="26" fill="currentColor" />
      <rect x="62" y="82" width="26" height="6" fill="currentColor" />
      <rect x="82" y="62" width="6" height="26" fill="currentColor" />
      <polygon points="41,32 71,50 41,68" fill="currentColor" />
    </svg>
  );
}
export function NewTag() { return <span className="vc-new-tag">NEW</span>; }
