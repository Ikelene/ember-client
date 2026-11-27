// Internet Radio (easter egg - it has been in every ScratchCord version, so it's in Ember too).
// Chat settings radio_enabled + radio_url. While /chat is open the stream plays and bars move along the bottom of the
// page behind the messages, in the accent colour. The audio comes through Nookara (/chat/radio, signed ticket) so
// WebAudio may read it; if that fails it plays straight from the station without the bars.
// One player for the whole app: the settings tab's controls talk to the same one.
import { useEffect, useRef } from 'react';
import { useChat } from './store.js';
import { useRadio, startRadio, stopRadio, radioAnalyser } from './radio.js';

// ── the player + background bars on /chat ──
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export function RadioHost() {
  const enabled = useChat(s => !!s.settings.radio_enabled);
  const url = useChat(s => s.settings.radio_url || '');
  const animations = useChat(s => s.settings.animations !== false);
  const { status, proxied: viaNookara, paused } = useRadio();
  const canvas = useRef(null);

  useEffect(() => {
    if (enabled && /^https?:\/\//i.test(url)) startRadio(url);
    else stopRadio();
  }, [enabled, url]);
  useEffect(() => () => stopRadio(), []); // leaving /chat stops it

  const drawing = enabled && viaNookara && status === 'playing' && !paused && animations;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('vc-radio', drawing);
    if (!drawing) return () => {};
    const el = canvas.current;
    if (!el) return () => root.classList.remove('vc-radio');
    const g = el.getContext('2d');
    let raf = 0, accent = '#c084fc', accentAt = 0, still = reducedMotion();
    const mq = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)'); } catch { return null; } })();
    const onMq = () => { still = reducedMotion(); if (!still) loop(); };
    mq?.addEventListener?.('change', onMq);
    let data = null;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
    };
    size();
    addEventListener('resize', size);
    function frame(now) {
      raf = 0;
      if (document.hidden || still) { g.clearRect(0, 0, el.width, el.height); return; }
      const an = radioAnalyser();
      if (!an) { g.clearRect(0, 0, el.width, el.height); return; }
      if (now - accentAt > 2000) { accentAt = now; accent = getComputedStyle(root).getPropertyValue('--accent').trim() || accent; }
      if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const W = el.width, H = el.height;
      const dpr = W / Math.max(el.clientWidth, 1);
      const gap = 3 * dpr, bw = 8 * dpr;
      const n = Math.max(8, Math.floor(W / (bw + gap)));
      const usable = Math.floor(data.length * 0.72); // the top bins are mostly empty for music
      g.clearRect(0, 0, W, H);
      g.fillStyle = accent;
      for (let i = 0; i < n; i++) {
        // log-ish spread: more bars for the low end where music lives
        const a = Math.floor(usable * Math.pow(i / n, 1.7));
        const b = Math.max(a + 1, Math.floor(usable * Math.pow((i + 1) / n, 1.7)));
        let sum = 0;
        for (let j = a; j < b; j++) sum += data[j];
        const v = sum / (b - a) / 255;
        const h = Math.max(2 * dpr, v * v * H);
        g.globalAlpha = 0.10 + v * 0.22;
        g.fillRect(i * (bw + gap), H - h, bw, h);
      }
      g.globalAlpha = 1;
      loop();
    }
    function loop() { if (!raf && !document.hidden && !still) raf = requestAnimationFrame(frame); }
    const onVis = () => { if (!document.hidden) loop(); };
    document.addEventListener('visibilitychange', onVis);
    loop();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      document.removeEventListener('visibilitychange', onVis);
      mq?.removeEventListener?.('change', onMq);
      g.clearRect(0, 0, el.width, el.height);
      root.classList.remove('vc-radio');
    };
  }, [drawing]);

  if (!enabled) return null;
  return <canvas ref={canvas} className="vc-radio-viz" aria-hidden="true" />;
}
