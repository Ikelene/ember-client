// Recording a voice message: the recorder hook the composer drives, and the bar with the live waveform that stands in for the text box.
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { SWIPE_CANCEL_PX } from './voice-note.js';
import { fmtTime } from './fmtTime.js';

const STEP_MS = 70, BAR = 3, GAP = 2;
function LiveWave({ voice }) {
  const canvas = useRef(null);
  const live = useRef(voice);
  live.current = voice;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0, last = 0;
    const bars = [];
    const color = getComputedStyle(el).color;
    const draw = now => {
      raf = requestAnimationFrame(draw);
      if (now - last < STEP_MS) return;
      last = now;
      bars.push(live.current.phase === 'recording' ? live.current.level() : 0);
      const ratio = devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) { el.width = Math.round(w * ratio); el.height = Math.round(h * ratio); }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const fit = Math.ceil(w / (BAR + GAP));
      if (bars.length > fit) bars.splice(0, bars.length - fit);
      bars.forEach((v, i) => {
        const bar = Math.max(2, Math.round(v * h));
        ctx.fillRect(w - (bars.length - i) * (BAR + GAP) + GAP, Math.round((h - bar) / 2), BAR, bar);
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvas} className="vc-voice-wave" aria-hidden="true" />;
}
function Elapsed({ voice }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 250); return () => clearInterval(t); }, []);
  return <span className="vc-voice-time">{fmtTime(voice.elapsed() / 1000)}</span>;
}
// mode: 'hold' (touch: let go sends, slide left deletes) | 'click' (desktop: the send button sends, the bin discards)
export function VoiceBar({ voice, mode, dragX = 0, onDiscard }) {
  const pull = Math.min(1, Math.max(0, -dragX / SWIPE_CANCEL_PX));
  return (
    <div className={`vc-voice-bar ${mode}${voice.phase === 'starting' ? ' starting' : ''}`} role="status" aria-label="Recording a voice message" style={mode === 'hold' && dragX ? { transform: `translateX(${Math.min(0, dragX) * 0.5}px)`, opacity: 1 - pull * 0.5 } : undefined}>
      {mode === 'click' && <button type="button" className="vc-ico-btn vc-voice-discard" title="Discard (Esc)" onClick={onDiscard}><Trash2 size={18} /></button>}
      <i className="vc-voice-dot" aria-hidden="true" />
      <Elapsed voice={voice} />
      {voice.phase === 'starting' ? <span className="vc-voice-hint">Starting your microphone...</span> : <LiveWave voice={voice} />}
      {voice.phase === 'full' && <span className="vc-voice-hint">5 minute limit reached</span>}
      {mode === 'hold' && voice.phase !== 'starting' && <span className={`vc-voice-hint slide${pull > 0.6 ? ' armed' : ''}`}><ChevronLeft size={14} aria-hidden="true" />{pull > 0.6 ? 'Let go to delete' : 'Slide to delete'}</span>}
    </div>
  );
}
