// Where a Nookara account-storage upload (/uploads/...) can be linked from. Pure, no imports (the node tests load it).
// cdn.nookara.cc serves /uploads/ ONLY (no /t/ temp files, no API), so it appears in the upload patterns and nowhere else.
// Every pattern is anchored on "https://" and the host is followed straight by "/", so look-alikes (cdn.nookara.cc.evil.example,
// evilcdn.nookara.cc, cdn.nookara.cc@evil.example, http://) never match.
const R = String.raw;
export const HOME_ORIGIN_SRC = R`(?:ember\.)?nookara\.cc|velora\.ikelene\.net`; // old + current hosts (also serve /t/)
export const UPLOAD_ORIGIN_SRC = R`(?:ember\.|cdn\.)?nookara\.cc|velora\.ikelene\.net`; // hosts that serve /uploads/
const VID_EXT = 'mp4|webm|mov', AUD_EXT = 'mp3|ogg|wav|m4a|aac|flac|weba|opus';
export const VID = new RegExp(R`^https:\/\/((?:${UPLOAD_ORIGIN_SRC})\/uploads|files\.catbox\.moe)\/\S+\.(${VID_EXT})$`, 'i');
export const AUD = new RegExp(R`^https:\/\/((?:${UPLOAD_ORIGIN_SRC})\/uploads|files\.catbox\.moe)\/\S+\.(${AUD_EXT})$`, 'i');
export const VUP = new RegExp(R`^https:\/\/(?:${UPLOAD_ORIGIN_SRC})\/uploads\/(images|videos|audio|files)\/[^\s?#]+(#n=[^\s#]*)?$`, 'i');
// an account-storage or old catbox link: gets "#n=<real name>" appended when sent
export const NAMED_LINK = new RegExp(R`^https:\/\/((files|litter)\.catbox\.moe|(?:${UPLOAD_ORIGIN_SRC})\/uploads)\/`);
// a picture the "Save to Saved Media" button works on (account uploads, /t/ temp files, catbox)
export const SAVEABLE = new RegExp(R`^https:\/\/((?:${UPLOAD_ORIGIN_SRC})\/uploads|(?:${HOME_ORIGIN_SRC})\/t|files\.catbox\.moe)\/`);
// any Nookara upload / temp link (never unfurled)
export const NOOKARA_FILE = new RegExp(R`^https:\/\/(?:(?:${UPLOAD_ORIGIN_SRC})\/uploads|(?:${HOME_ORIGIN_SRC})\/t)\/`, 'i');
// the same file on any of the hosts compares equal: "/uploads/videos/x.mp4"; anything else comes back without ?query / #fragment
export function uploadKey(url) {
  const bare = String(url || '').split(/[?#]/)[0];
  const m = new RegExp(R`^https:\/\/(?:${UPLOAD_ORIGIN_SRC})(\/uploads\/.+)$`, 'i').exec(bare);
  return m ? m[1] : bare;
}
