// Plan limits a homeserver sets on its servers (a homeserver may sell tiers; it reports them as "managed"). The server answers 403 `plan_limit` { what, limit, used?, plan? } (a number
// reached, or limit false / 0 for a feature the plan doesn't have) or `plan_feature` { what, limit: 0|null, plan, message } (a feature the
// plan doesn't include at all). This file turns those into one clear card over the dimmed page: "Not included in your plan",
// and an inline notice for "you've used N of M". Pages use usePlan(what, used): it knows the answer up front (from the plan the server
// reports) and also catches the error from a request (catchPlan). Everything is read defensively: unknown fields are ignored.
import { useContext } from 'react';
import { Lock, TriangleAlert } from 'lucide-react';
import { NAMES, canon, PlanCtx, featureName, usePlan } from './plans.js';

const nounOf = what => NAMES[canon(what)]?.[1] || String(what || 'items').replace(/_/g, ' ');

// (the plan is the homeserver's: Ember has nowhere to change it, so it says who can)
function Actions() {
  return <div className="bf-pg-actions"><small className="vc-hint">The homeserver's admins decide what each plan includes.</small></div>;
}

// A whole feature isn't in the plan: the page's normal content stays rendered (so people can see what it looks like), dimmed and inert
// under a dark overlay with the "Not included in your plan" card. `block` null = no gate: the children render as they are.
// The children must render safely with empty data (pages stop loading / polling while gated).
export function PlanGate({ block, title, children }) {
  const ctx = useContext(PlanCtx);
  if (!block) return <>{children}</>;
  const plan = block.plan || ctx?.name;
  return (
    <div className="bf-pg-wrap">
      <div className="bf-pg-under" inert="" aria-hidden="true">{children}</div>
      <div className="bf-pg-overlay">
        <div className="card bf-ss-card bf-pg" role="region" aria-label="Not included in your plan">
          <div className="card-header"><span className="card-title"><Lock size={15} /> Not included in your plan</span></div>
          <div className="card-body">
            <p className="bf-pg-text"><b>{title || featureName(block.what)}</b> isn't included in this server's plan{plan ? ` (${plan})` : ''} on its homeserver.</p>
            <Actions />
          </div>
        </div>
      </div>
    </div>
  );
}

// "You've used N of M" - the number is reached; creating one more is refused
export function PlanNotice({ block }) {
  const ctx = useContext(PlanCtx);
  if (!block) return null;
  const plan = block.plan || ctx?.name;
  return (
    <div className="vc-note warn bf-pg-note">
      <TriangleAlert size={14} />
      {canon(block.what) === 'max_upload_mb'
        ? <span><b>Your plan allows files up to {block.limit} MB</b>{plan ? ` (${plan})` : ''}. </span>
        : <span><b>You've used {block.used ?? block.limit} of {block.limit} {nounOf(block.what)}</b> on this server's plan{plan ? ` (${plan})` : ''}.</span>}
      <Actions />
    </div>
  );
}

// "Bots: 1 / 2" in a page's header, when the plan says how many there can be
export function PlanUsage({ what, used, label }) {
  const p = usePlan(what, used);
  if (p.limit === null) return null;
  const u = p.used;
  return <span className={`bf-pg-use${u !== null && u >= p.limit ? ' full' : ''}`} title="What this server's plan allows">{label || featureName(what).replace(/^The /, '')}: {u !== null ? `${u} / ${p.limit}` : `up to ${p.limit}`}</span>;
}
