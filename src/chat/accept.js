// File inputs for pictures. Chrome on Android opens Android's Photo Picker for an input that only accepts pictures, and a
// photo from it often can't be read (NotReadableError: the picker's copy changes right after Chrome takes it, so the banner
// cropper stayed black - Ikelene's Galaxy S21, Android 15, 2026-11-16). There the input takes any file, which opens Android's
// normal chooser (photos and files from it read fine); what comes back is still checked by the cropper and the server.
const ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
export const pictureAccept = types => (ANDROID ? undefined : types);
