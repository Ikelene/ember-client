// the bot gallery's permission list and listing states (BotGalleryDev.jsx)
import { Lock, Clock, BadgeCheck, CircleAlert, EyeOff, Ban } from 'lucide-react';

export const GALLERY_PERMS = [
  ['send_messages', 'Send messages'], ['attach_files', 'Attach files'], ['manage_channels', 'Manage channels'], ['manage_server', 'Manage server'],
  ['manage_roles', 'Manage roles'], ['kick_members', 'Kick members'], ['ban_members', 'Ban members'], ['manage_messages', 'Manage messages'],
  ['mention_everyone', 'Mention everyone'], ['administrator', 'Administrator'],
];

export const STATE_INFO = {
  private: { label: 'Private', Icon: Lock, hint: 'Only you can add it.' },
  pending: { label: 'Pending review', Icon: Clock, hint: 'Waiting for Nookara staff to look at it.' },
  approved: { label: 'Approved', Icon: BadgeCheck, hint: 'Listed in the gallery with a Verified checkmark.' },
  rejected: { label: 'Rejected', Icon: CircleAlert, hint: 'Staff sent it back. Fix what they said and submit it again.' },
  delisted: { label: 'Delisted', Icon: EyeOff, hint: 'Staff took it out of the gallery. You can submit it again.' },
  banned: { label: 'Banned', Icon: Ban, hint: 'This bot can not be listed.' },
};

export const SHORT_MIN = 10, SHORT_MAX = 200, LONG_MIN = 20;
