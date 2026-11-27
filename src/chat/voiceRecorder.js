// recording a voice note (VoiceNote.jsx)
import { useState, useRef, useEffect } from 'react';
import { pickFormat, micErrorText, voiceFileName, MAX_MS } from './voice-note.js';
import { openMicrophone } from './voice.js';
import { playSound } from './store.js';

const START_CHIME_MS = 180;

// phase: idle | starting (asking for the mic) | recording | full (hit the limit; it's kept until sent or discarded)
export function useVoiceRecorder() {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const rec = useRef(null);
  const attempt = useRef(0); // a newer press or a discard makes an unfinished start give up

  function release(r) {
    clearTimeout(r.limit);
    r.stream.getTracks().forEach(t => t.stop());
    r.ctx?.close().catch(() => {});
  }
  // -> true once it's recording
  async function start() {
    if (rec.current || phase !== 'idle') return false;
    const mine = ++attempt.current;
    setError('');
    const format = typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia ? pickFormat(m => MediaRecorder.isTypeSupported(m)) : null;
    if (!format) { setError(micErrorText({ name: 'unsupported' })); return false; }
    setPhase('starting');
    let stream;
    try { stream = await openMicrophone(); } catch (e) {
      if (mine === attempt.current) { setPhase('idle'); setError(micErrorText(e)); }
      return false;
    }
    if (mine !== attempt.current) { stream.getTracks().forEach(t => t.stop()); return false; } // let go / discarded while the mic was opening
    // the chime has to be over before the recorder listens, or it ends up at the start of the message
    playSound('voice_start', 0.5);
    await new Promise(done => setTimeout(done, START_CHIME_MS));
    if (mine !== attempt.current) { stream.getTracks().forEach(t => t.stop()); return false; }
    try {
      const recorder = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 48000 });
      const chunks = [];
      const r = { recorder, stream, chunks, started: performance.now(), ms: 0, ctx: null, analyser: null, wave: new Uint8Array(1024) };
      try { // only the waveform needs this: without it the recording still works
        r.ctx = new (window.AudioContext || window.webkitAudioContext)();
        r.ctx.resume?.().catch(() => {});
        r.analyser = r.ctx.createAnalyser();
        r.analyser.fftSize = 1024;
        r.ctx.createMediaStreamSource(stream).connect(r.analyser);
      } catch { r.analyser = null; }
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      r.done = new Promise(resolve => {
        recorder.onstop = () => {
          r.ms = performance.now() - r.started;
          const when = Date.now();
          resolve(chunks.length ? new File(chunks, voiceFileName(when, r.ms, format.ext), { type: format.type }) : null);
        };
      });
      const atLimit = () => { if (recorder.state !== 'inactive') recorder.stop(); setPhase(p => (p === 'recording' ? 'full' : p)); };
      r.limit = setTimeout(atLimit, MAX_MS);
      stream.getAudioTracks()[0]?.addEventListener('ended', atLimit); // the mic went away: keep what's there
      recorder.onerror = () => { discard(); setError(micErrorText({})); };
      rec.current = r;
      recorder.start(250);
      r.started = performance.now();
      setPhase('recording');
      return true;
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      rec.current = null;
      setPhase('idle');
      setError(micErrorText(e));
      return false;
    }
  }
  // stop and hand back the file (null if nothing was recorded)
  async function finish() {
    const r = rec.current;
    if (!r) return null;
    rec.current = null;
    attempt.current++;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    const f = await r.done;
    release(r);
    setPhase('idle');
    return f;
  }
  function discard() {
    attempt.current++;
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.recorder.ondataavailable = null;
      if (r.recorder.state !== 'inactive') { try { r.recorder.stop(); } catch { /* already stopped */ } }
      release(r);
    }
    setPhase('idle');
  }
  // 0-1: how loud the mic is right now
  const level = () => {
    const r = rec.current;
    if (!r?.analyser) return 0;
    r.analyser.getByteTimeDomainData(r.wave);
    let top = 0;
    for (const v of r.wave) { const d = Math.abs(v - 128); if (d > top) top = d; }
    return Math.min(1, top / 90);
  };
  const elapsed = () => (rec.current ? Math.min(MAX_MS, performance.now() - rec.current.started) : 0);
  useEffect(() => () => discard(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return { phase, active: phase !== 'idle', error, clearError: () => setError(''), start, finish, discard, level, elapsed };
}
