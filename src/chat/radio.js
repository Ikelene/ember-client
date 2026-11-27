// the radio player: one audio element for the whole app, its volume and state
import { useSyncExternalStore } from 'react';
import { apiFetch } from '../api.js';

const VOL_KEY = 'ember_radio_volume';

const readVol = () => { try { const v = Number(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) && localStorage.getItem(VOL_KEY) !== null ? Math.min(Math.max(v, 0), 1) : 0.4; } catch { return 0.4; } };

const R = { audio: null, ctx: null, analyser: null, gain: null, node: null, url: null, token: 0, gestureWait: null, retries: 0 };

let snap = { status: 'off', volume: readVol(), paused: false, proxied: false };

const subs = new Set();

const emit = patch => { snap = { ...snap, ...patch }; subs.forEach(f => f()); };

const subscribe = f => { subs.add(f); return () => subs.delete(f); };

const getSnap = () => snap;

export const useRadio = () => useSyncExternalStore(subscribe, getSnap, getSnap);

export const radioAnalyser = () => (snap.proxied && snap.status === 'playing' && !snap.paused ? R.analyser : null);

function teardown() {
  R.token++;
  if (R.gestureWait) { removeEventListener('pointerdown', R.gestureWait, true); removeEventListener('keydown', R.gestureWait, true); R.gestureWait = null; }
  if (R.audio) {
    try { R.audio.pause(); R.audio.removeAttribute('src'); R.audio.load(); } catch { /* gone */ }
    R.audio = null;
  }
  try { R.node?.disconnect(); } catch { /* gone */ }
  R.node = null;
}

// autoplay is blocked until the first click / key press: wait for one, then try again
function waitForGesture(token) {
  emit({ status: 'waiting' });
  if (R.gestureWait) return;
  R.gestureWait = () => {
    removeEventListener('pointerdown', R.gestureWait, true); removeEventListener('keydown', R.gestureWait, true);
    R.gestureWait = null;
    if (token === R.token && !snap.paused) playWhenAllowed(token);
  };
  addEventListener('pointerdown', R.gestureWait, true);
  addEventListener('keydown', R.gestureWait, true);
}

function playWhenAllowed(token) {
  const a = R.audio;
  if (!a) return;
  const usesCtx = snap.proxied && R.ctx;
  // the AudioContext also needs a gesture; resume() just hangs without one, so give it a moment
  const ctxOk = () => (!usesCtx || R.ctx.state === 'running' ? Promise.resolve(true)
    : Promise.race([R.ctx.resume().then(() => true, () => false), new Promise(r => setTimeout(() => r(R.ctx.state === 'running'), 400))]));
  a.play().then(ctxOk).then(ok => {
    if (token !== R.token) return;
    if (ok) emit({ status: 'playing' }); else waitForGesture(token);
  }).catch(e => {
    if (token !== R.token) return;
    if (e?.name === 'NotAllowedError') waitForGesture(token); // a load error shows up as the 'error' event
  });
}

function direct(url, token) {
  if (token !== R.token) return;
  try { R.node?.disconnect(); } catch { /* gone */ }
  R.node = null;
  const a = new Audio();
  a.preload = 'none';
  a.volume = snap.volume;
  a.src = url;
  a.addEventListener('error', () => { if (token === R.token) emit({ status: 'error' }); });
  a.addEventListener('playing', () => { if (token === R.token) emit({ status: 'playing' }); });
  R.audio = a;
  emit({ proxied: false, status: 'loading' });
  if (!snap.paused) playWhenAllowed(token); else emit({ status: 'paused' });
}

async function proxied(url, token) {
  let src;
  try { src = (await apiFetch('/chat/radio/ticket', { method: 'POST', body: JSON.stringify({ url }) })).src; } catch { return direct(url, token); }
  if (token !== R.token) return;
  const a = new Audio();
  a.crossOrigin = 'anonymous';
  a.preload = 'none';
  a.volume = 1; // loudness is the gain node, so the bars don't shrink with the volume
  a.src = src;
  let started = false, steady = null;
  a.addEventListener('playing', () => {
    started = true;
    // playing fine for 30 s: a later drop gets the full set of retries again (they used to run out for good after 3)
    clearTimeout(steady); steady = setTimeout(() => { if (token === R.token) R.retries = 0; }, 30e3);
    if (token === R.token && (!R.ctx || R.ctx.state === 'running')) emit({ status: 'playing' });
  });
  const dropped = () => {
    clearTimeout(steady);
    if (token !== R.token) return;
    if (!started) return direct(url, token); // proxy refused it (not audio, unreachable, busy): play it straight, no bars
    emit({ status: 'error' });
    // the stream dropped after playing (or a live stream "ended", which is the same thing): tune in again, a fresh
    // ticket each time, waiting a bit longer each try (3 s, 6 s, 12 s, 24 s, 30 s)
    if (R.retries < 5) { const wait = Math.min(30e3, 3000 * 2 ** R.retries); R.retries++; setTimeout(() => { if (token === R.token && !snap.paused) restart(); }, wait); }
  };
  a.addEventListener('error', dropped);
  a.addEventListener('ended', dropped);
  R.audio = a;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!R.ctx) {
      R.ctx = new AC();
      R.analyser = R.ctx.createAnalyser();
      R.analyser.fftSize = 512;
      R.analyser.smoothingTimeConstant = 0.82;
      R.gain = R.ctx.createGain();
      R.analyser.connect(R.gain).connect(R.ctx.destination);
    }
    R.gain.gain.value = snap.volume;
    R.node = R.ctx.createMediaElementSource(a);
    R.node.connect(R.analyser);
    emit({ proxied: true, status: 'loading' });
  } catch {
    a.volume = snap.volume; // no WebAudio: it still plays
    emit({ proxied: false, status: 'loading' });
  }
  if (!snap.paused) playWhenAllowed(token); else emit({ status: 'paused' });
}

export function startRadio(url) {
  if (R.url === url) return;
  teardown();
  R.url = url;
  R.retries = 0;
  proxied(url, R.token);
}

// live radio: after a pause or a drop, start from "now" again instead of the old buffer
function restart() {
  const url = R.url;
  if (!url) return;
  teardown();
  R.url = url;
  proxied(url, R.token);
}

export function stopRadio() {
  teardown();
  R.url = null;
  emit({ status: 'off', proxied: false });
}

export function setRadioVolume(v) {
  v = Math.min(Math.max(Number(v) || 0, 0), 1);
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* private mode */ }
  if (R.audio) { if (snap.proxied && R.gain) R.gain.gain.value = v; else R.audio.volume = v; }
  emit({ volume: v });
}

export function toggleRadioPause() {
  const paused = !snap.paused;
  emit({ paused });
  if (!R.audio) return;
  if (paused) { R.audio.pause(); emit({ status: 'paused' }); }
  else restart();
}
