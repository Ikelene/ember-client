// Settings > Voice & video: pick your mic / speakers / camera, set volumes + sensitivity, and test them.
// Everything is saved through voice.js (prefs / setPrefs); the mic test and camera preview below open their
// own streams (own AudioContext) and close them again on stop, on unmount, or when you join a call.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Headphones, Video, VideoOff, AudioLines, Square, ShieldCheck, Volume2, Music } from 'lucide-react';
import { useChat } from '../store.js';
import { prefs, setPrefs, refreshDevices, knownDevices, micMeter, canSelectOutput, sensLabel } from '../voice.js';
import { SettingsPage, SCard, SRow, Switch, ResetButton } from './ui.jsx';
import './voice-page.css';

// the values voice.js starts with, for the prefs this page manages
const DEFAULTS = { input: '', output: '', camera: '', inVol: 100, outVol: 100, sens: 0, board: 60, noiseSuppression: true };
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
// same scale as voice.js: sensitivity s -> threshold at (-70 + 0.6 s) dB, the meter shows -70..-10 dB as 0..1
const sensToRms = s => (s > 0 ? Math.pow(10, (-70 + s * 0.6) / 20) : 0);
const rmsToMeter = rms => clamp(((rms > 0 ? 20 * Math.log10(rms) : -100) + 70) / 60, 0, 1);
const stopStream = s => s?.getTracks().forEach(t => t.stop());

// the mic as a call opens it (voice.js micConstraints): echo cancellation + auto gain always on, noise suppression from prefs
const micConstraints = (id, ns) => ({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: ns, autoGainControl: true, channelCount: 1 }, video: false });
const camConstraints = id => ({ video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 854, max: 1280 }, height: { ideal: 480, max: 720 } }, audio: false });
const gone = e => ['OverconstrainedError', 'NotFoundError'].includes(e?.name);
// open the saved device; if it was unplugged, fall back to the system default (like voice.js)
async function open(make, id) { try { return await navigator.mediaDevices.getUserMedia(make(id)); } catch (e) { if (id && gone(e)) return navigator.mediaDevices.getUserMedia(make('')); throw e; } }
const sinkFor = (id, list) => (id && (!list.length || list.some(d => d.deviceId === id)) ? id : 'default');

function DevicePicker({ value, list, fallback, onPick, label }) {
  const ok = value && list.some(d => d.deviceId === value);
  return (
    <select className="form-select vp-select" aria-label={label} value={ok ? value : ''} onChange={e => onPick(e.target.value)}>
      <option value="">Default</option>
      {list.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${fallback} ${i + 1}`}</option>)}
      {value && !ok && list.length > 0 && <option value={value} disabled>Your pick is unplugged</option>}
    </select>
  );
}

export default function VoicePage() {
  const p = useChat(s => s.voicePrefs) || prefs();
  const inCall = useChat(s => !!s.voice);
  const [devs, setDevs] = useState(() => knownDevices());
  const [askErr, setAskErr] = useState({});
  const [testing, setTesting] = useState(false);
  const [testErr, setTestErr] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [camStream, setCamStream] = useState(null);
  const fillRef = useRef(null);
  const meterWrap = useRef(null);
  const test = useRef(null); // { stream, ctx, gain, gate, an, buf, audio, hold, open }
  const pRef = useRef(p);
  pRef.current = p;

  const reload = useCallback(async () => { setDevs({ ...(await refreshDevices()) }); }, []);
  useEffect(() => {
    void reload();
    const md = navigator.mediaDevices, h = () => { void reload(); };
    md?.addEventListener?.('devicechange', h);
    return () => md?.removeEventListener?.('devicechange', h);
  }, [reload]);

  const needs = kind => !devs[kind]?.length || devs[kind].every(d => !d.label);
  const askAccess = async kind => {
    setAskErr(e => ({ ...e, [kind]: '' }));
    try { stopStream(await navigator.mediaDevices.getUserMedia(kind === 'videoinput' ? { video: true } : { audio: true })); await reload(); }
    catch { setAskErr(e => ({ ...e, [kind]: kind === 'videoinput' ? "Ember can't use your camera. Check your browser's site settings." : "Ember can't use your microphone. Check your browser's site settings." })); }
  };

  // â”€â”€ mic test: mic -> input volume -> noise gate -> your speakers â”€â”€
  const stopTest = useCallback(() => {
    const t = test.current;
    test.current = null;
    if (!t) return;
    try { t.audio.pause(); t.audio.srcObject = null; } catch { /* fine */ }
    stopStream(t.stream);
    try { t.ctx.close(); } catch { /* fine */ }
  }, []);
  const startTest = useCallback(async () => {
    stopTest();
    setTestErr('');
    const cur = pRef.current;
    let stream;
    try { stream = await open(id => micConstraints(id, cur.noiseSuppression !== false), cur.input); }
    catch { setTesting(false); setTestErr("Ember can't use your microphone. Check your browser's site settings."); return; }
    if (typeof AudioContext === 'undefined') { stopStream(stream); setTesting(false); setTestErr("This browser can't run the mic test."); return; }
    const ctx = new AudioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream), gain = ctx.createGain(), gate = ctx.createGain(), an = ctx.createAnalyser(), dest = ctx.createMediaStreamDestination();
    an.fftSize = 512;
    gain.gain.value = clamp(cur.inVol ?? 100, 0, 200) / 100;
    src.connect(gain);
    gain.connect(an);
    gain.connect(gate).connect(dest);
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = dest.stream;
    audio.volume = clamp(cur.outVol ?? 100, 0, 100) / 100;
    if (canSelectOutput()) { try { await audio.setSinkId(sinkFor(cur.output, knownDevices().audiooutput)); } catch { /* default output */ } }
    audio.play().catch(() => {});
    test.current = { stream, ctx, gain, gate, an, buf: new Float32Array(an.fftSize), audio, hold: 0, open: 1 };
    void reload(); // labels show up once the mic is allowed
  }, [stopTest, reload]);

  // start / restart when the mic or noise suppression changes; stop when you join a call or leave the page
  useEffect(() => {
    if (!testing) return undefined;
    if (inCall) { setTesting(false); return undefined; }
    void startTest();
    return stopTest;
  }, [testing, inCall, p.input, p.noiseSuppression, startTest, stopTest]);
  // live changes while testing
  useEffect(() => {
    const t = test.current;
    if (!t) return;
    t.gain.gain.setTargetAtTime(clamp(p.inVol ?? 100, 0, 200) / 100, t.ctx.currentTime, 0.02);
    t.audio.volume = clamp(p.outVol ?? 100, 0, 100) / 100;
    if (canSelectOutput()) t.audio.setSinkId(sinkFor(p.output, devs.audiooutput || [])).catch(() => {});
  }, [p.inVol, p.outVol, p.output, devs]);

  // the level meter: the test's own mic, or your mic in the call (voice.js micMeter); written straight to the DOM
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = now => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const t = test.current, cur = pRef.current, thr = sensToRms(clamp(cur.sens, 0, 100));
      let level = null;
      if (t) {
        t.an.getFloatTimeDomainData(t.buf);
        let sum = 0;
        for (let i = 0; i < t.buf.length; i++) sum += t.buf[i] * t.buf[i];
        const rms = Math.sqrt(sum / t.buf.length);
        level = rmsToMeter(rms);
        // the same gate a call uses: below the marker for a quarter second = quiet
        const o = thr <= 0 || rms >= thr ? 1 : (performance.now() < t.hold ? 1 : 0);
        if (thr <= 0 || rms >= thr) t.hold = performance.now() + 250;
        if (o !== t.open) { t.open = o; t.gate.gain.setTargetAtTime(o, t.ctx.currentTime, o ? 0.005 : 0.05); }
      } else if (inCall) level = micMeter();
      const el = fillRef.current, wrap = meterWrap.current;
      if (el) el.style.width = `${Math.round((level ?? 0) * 100)}%`;
      if (wrap) {
        wrap.classList.toggle('live', level != null);
        wrap.classList.toggle('above', level != null && level * 100 >= clamp(cur.sens, 0, 100) && level > 0);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [inCall]);

  // â”€â”€ camera preview â”€â”€
  useEffect(() => {
    if (!camOn) return undefined;
    let alive = true, got = null;
    setCamErr('');
    open(camConstraints, p.camera).then(s => {
      if (!alive) { stopStream(s); return; }
      got = s;
      setCamStream(s);
      void reload();
    }, () => { if (alive) { setCamErr("Ember can't use your camera. Check your browser's site settings."); setCamOn(false); } });
    return () => { alive = false; stopStream(got); setCamStream(null); };
  }, [camOn, p.camera, reload]);

  const set = patch => setPrefs(patch);
  const sens = clamp(p.sens ?? 0, 0, 100);
  const meterShown = testing || inCall;

  return (
    <SettingsPage icon={Mic} title="Voice & video" sub="Pick your mic, speakers and camera, and check how you sound.">
      <SCard title="Microphone" sub="What you talk into.">
        <SRow title="Input device" icon={Mic}>
          <DevicePicker label="Input device" value={p.input} list={devs.audioinput || []} fallback="Microphone" onPick={id => set({ input: id })} />
        </SRow>
        {needs('audioinput') && (
          <div className="vp-ask">
            <span>Your browser hides device names until you let Ember use the mic.</span>
            <button type="button" className="btn btn-surface btn-sm vp-btn" onClick={() => askAccess('audioinput')}><ShieldCheck size={14} /> Allow microphone access</button>
            {askErr.audioinput && <small className="vp-err">{askErr.audioinput}</small>}
          </div>
        )}
        <div className="vp-slider">
          <div className="vp-slider-head"><b>Input volume</b><span>{p.inVol ?? 100}%</span></div>
          <input type="range" min={0} max={200} value={p.inVol ?? 100} aria-label="Input volume" onChange={e => set({ inVol: Number(e.target.value) })} />
          {!inCall && <small>Used in calls and in the mic test below.</small>}
        </div>
        <SRow title="Noise suppression" sub="Cuts out fans, typing and other steady noise.">
          <Switch on={p.noiseSuppression !== false} label="Noise suppression" onChange={v => set({ noiseSuppression: v })} />
        </SRow>
      </SCard>

      <SCard title="Mic sensitivity" sub="Quieter than the marker is not sent, so background noise stays out. All the way left is off.">
        <div className="vp-slider">
          <div className="vp-slider-head"><b>Sensitivity</b><span>{sensLabel(sens)}</span></div>
          <div ref={meterWrap} className="vp-sens">
            <div className="sx-meter vp-meter" aria-hidden="true">
              <i ref={fillRef} />
              {sens > 0 && <b style={{ left: `calc(${sens}% - 1px)` }} />}
            </div>
            <input type="range" min={0} max={100} value={sens} aria-label="Mic sensitivity" onChange={e => set({ sens: Number(e.target.value) })} />
          </div>
          <small>{meterShown ? 'The bar turns green when you are loud enough to be heard.' : 'Start the mic test to see your level here.'}</small>
        </div>
      </SCard>

      <SCard title="Mic test" sub="Hear yourself the way others hear you. Use headphones so you don't get an echo."
        action={inCall ? null : testing
          ? <button type="button" className="btn btn-surface btn-sm vp-btn" onClick={() => setTesting(false)}><Square size={14} /> Stop testing</button>
          : <button type="button" className="btn btn-primary btn-sm vp-btn" onClick={() => setTesting(true)}><AudioLines size={14} /> Let's check</button>}>
        {inCall
          ? <p className="vp-note">The mic test is off while you're in a call. Your level still shows on the sensitivity bar above.</p>
          : testing
            ? <p className="vp-note"><span className="vp-dot" aria-hidden="true" /> Testing. Say something, you should hear yourself.</p>
            : <p className="vp-note">Press Let's check, then talk.</p>}
        {testErr && <small className="vp-err">{testErr}</small>}
      </SCard>

      <SCard title="Speakers" sub="What you hear calls through.">
        {canSelectOutput() && (
          <SRow title="Output device" icon={Headphones} sub={needs('audiooutput') ? 'Allow microphone access above to see your speakers by name.' : undefined}>
            <DevicePicker label="Output device" value={p.output} list={devs.audiooutput || []} fallback="Speakers" onPick={id => set({ output: id })} />
          </SRow>
        )}
        <div className="vp-slider">
          <div className="vp-slider-head"><b><Volume2 size={14} /> Output volume</b><span>{p.outVol ?? 100}%</span></div>
          <input type="range" min={0} max={100} value={clamp(p.outVol ?? 100, 0, 100)} aria-label="Output volume" onChange={e => set({ outVol: Number(e.target.value) })} />
        </div>
        <div className="vp-slider">
          <div className="vp-slider-head"><b><Music size={14} /> Soundboard volume</b><span>{p.board ? `${p.board}%` : 'Off'}</span></div>
          <input type="range" min={0} max={100} value={clamp(p.board ?? 60, 0, 100)} aria-label="Soundboard volume" onChange={e => set({ board: Number(e.target.value) })} />
          <small>How loud other people's soundboard sounds are for you.</small>
        </div>
      </SCard>

      <SCard title="Camera" sub="What people see when you turn your camera on."
        action={camOn
          ? <button type="button" className="btn btn-surface btn-sm vp-btn" onClick={() => setCamOn(false)}><VideoOff size={14} /> Stop video</button>
          : <button type="button" className="btn btn-primary btn-sm vp-btn" onClick={() => setCamOn(true)}><Video size={14} /> Test video</button>}>
        <SRow title="Camera" icon={Video}>
          <DevicePicker label="Camera" value={p.camera} list={devs.videoinput || []} fallback="Camera" onPick={id => set({ camera: id })} />
        </SRow>
        {needs('videoinput') && !camOn && (
          <div className="vp-ask">
            <span>Your browser hides camera names until you let Ember use it.</span>
            <button type="button" className="btn btn-surface btn-sm vp-btn" onClick={() => askAccess('videoinput')}><ShieldCheck size={14} /> Allow camera access</button>
            {askErr.videoinput && <small className="vp-err">{askErr.videoinput}</small>}
          </div>
        )}
        {camOn && (
          <div className="vp-cam">
            {camStream
              ? <video autoPlay playsInline muted ref={el => { if (el && el.srcObject !== camStream) el.srcObject = camStream; }} />
              : <span className="vp-cam-wait">Starting camera...</span>}
          </div>
        )}
        {camErr && <small className="vp-err">{camErr}</small>}
      </SCard>

      <ResetButton onClick={() => { setTesting(false); setCamOn(false); set({ ...DEFAULTS }); }} />
    </SettingsPage>
  );
}
