// Server tiers (PROTOCOL 19.0a): the words for their answers (TierPage.jsx draws the page)
export const RETRY_KEY = 'ember_tier_retry'; // "<sid>|<tier>": buy this once back from linking a Nookara account for payments

export const untilText = t => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };

export function tierErrorText(code) {
  switch (code) {
    case 'owner_only': return 'Only the server owner can buy a tier.';
    case 'unknown_tier': return "That tier isn't on sale any more.";
    case 'tiers_unavailable': return "This homeserver doesn't sell tiers.";
    case 'payment_link_missing': return 'The Nookara account you linked no longer allows payments here. Link it again in My account.';
    case 'declined': return 'The payment was declined on Nookara.';
    case 'expired': return 'The payment request expired. Buy again to get a new one.';
    case 'insufficient_credits': return "There aren't enough credits on that Nookara account.";
    case 'instance_unreachable': case 'unreachable': return "Couldn't reach the homeserver. Try again.";
    default: return "The payment didn't go through. Try again.";
  }
}
