// Alberta time fix (Ikelene 2026-11-14). Alberta stays on UTC-6 all year since 2026-11-01, but browsers ship their own time zone
// data and theirs still puts America/Edmonton on MST (UTC-7) for the winter, so every time Ember shows was an hour early there
// ("1 hour ahead of you" on your own time, log times off by one). Only for a browser whose zone is America/Edmonton AND whose
// data is the old one (December 2026 = UTC-7): dates/times are formatted in UTC-6 and getTimezoneOffset() says 360 from
// 2026-11-01 on. It turns itself off once the browser's data knows the new rule. (Nookara's server already has it.)
// Loaded first (main.jsx). The same file is in Nookara's dashboard (dashboard-src/src/lib/tzfix.js) and public/assets/js/tzfix.js.
(function fixAlbertaTime() {
  try {
    const NativeDTF = Intl.DateTimeFormat;
    if (new NativeDTF().resolvedOptions().timeZone !== 'America/Edmonton') return;
    if (new Date(Date.UTC(2026, 11, 1, 12)).getTimezoneOffset() !== 420) return; // the browser already knows
    const ZONE = 'Etc/GMT+6'; // (POSIX sign: UTC-6)
    const FROM = Date.UTC(2026, 10, 1, 8); // 2026-11-01 02:00 MDT, when Alberta stopped changing clocks
    const withZone = (date, opts) => {
      if (opts && opts.timeZone) return opts;
      if (date != null && new Date(date).getTime() < FROM) return opts; // (older dates: the old rule was right)
      return { ...(opts || {}), timeZone: ZONE };
    };
    // Intl.DateTimeFormat without a timeZone: UTC-6 (format() of older dates is rare enough to keep simple)
    function DateTimeFormat(locales, opts) { return new NativeDTF(locales, opts && opts.timeZone ? opts : { ...(opts || {}), timeZone: ZONE }); }
    DateTimeFormat.prototype = NativeDTF.prototype;
    DateTimeFormat.supportedLocalesOf = NativeDTF.supportedLocalesOf.bind(NativeDTF);
    Intl.DateTimeFormat = DateTimeFormat;
    for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
      const orig = Date.prototype[m];
      Date.prototype[m] = function patched(locales, opts) { return orig.call(this, locales, withZone(this, opts)); };
    }
    const origOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function patchedOffset() { return this.getTime() >= FROM ? 360 : origOffset.call(this); };
  } catch { /* leave the browser's own */ }
})();
