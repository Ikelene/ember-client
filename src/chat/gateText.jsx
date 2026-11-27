// the text a server's gate shows when it's locked (Gate.jsx)
import { siteHref } from './hosts.js';
import { Cake, ExternalLink, Ban, LifeBuoy } from 'lucide-react';
import { RESTRICTED_TEXT } from './store.js';

export const SUPPORT_URL = 'https://nookara.cc/support';

// where the birthday is set (Nookara account settings; a website session, the Ember token can't set it)
export const BIRTHDAY_URL = siteHref('/me#settings/birthday');

// The lockout notice by reason (store.js lockReason). Staff restrictions keep the old wording; Nookara's birthday gate
// (no birthday yet / under the minimum age for their region) says what to do instead.
export function lockText(reason) {
  if (reason === 'birthday_required') return {
    icon: <Cake size={34} />, title: 'Set your birthday to use Ember',
    text: 'Ember and direct messages are off until you add your date of birth in your Nookara account settings. Only you can see it. Ember unlocks as soon as it is saved.',
    action: <a className="btn btn-primary" href={BIRTHDAY_URL} target="_blank" rel="noopener noreferrer"><Cake size={15} /> Set your birthday <ExternalLink size={13} /></a>,
  };
  if (reason === 'under_minimum_age') return {
    icon: <Ban size={34} />, title: "Ember isn't available for your account",
    text: "You're under the minimum age for chat in your region, so Ember and direct messages are off. The rest of your Nookara account works as usual. Contact Nookara support if your birthday is wrong.",
    action: <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer"><LifeBuoy size={15} /> Nookara support</a>,
  };
  return {
    icon: <Ban size={34} />, title: 'Ember is switched off',
    text: `${RESTRICTED_TEXT} Contact Nookara support if you think this is a mistake.`,
    action: <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer"><LifeBuoy size={15} /> Nookara support</a>,
  };
}
