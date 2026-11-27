// the mic / speaker / camera menus in voice
import { micProcessing, setPrefs, sensLabel, micMeter, canSelectOutput, refreshDevices, prefs, knownDevices } from './voice.js';
import { openMenu } from './menus.js';

function deviceItems(kind, chosen, pick, fallbackName) {
  const list = knownDevices()[kind] || [];
  const ok = chosen && list.some(d => d.deviceId === chosen);
  const hint = chosen && !ok && list.length ? 'Your pick is unplugged' : !list.length ? 'Allow access to list devices' : '';
  return [
    { label: 'Default', hint, radio: true, checked: !ok, onClick: () => pick('') },
    ...list.map((d, i) => ({ label: d.label || `${fallbackName} ${i + 1}`, radio: true, checked: ok && d.deviceId === chosen, onClick: () => pick(d.deviceId) })),
  ];
}

// device lists come from enumerateDevices (async), so remember where the click was and open right after
async function voiceMenu(e, build) {
  e.preventDefault?.();
  e.stopPropagation?.();
  const at = { clientX: e.clientX, clientY: e.clientY, touch: !!e.touch, preventDefault() {}, stopPropagation() {} };
  await refreshDevices();
  openMenu(at, build(prefs()));
}

export function micMenu(e) {
  voiceMenu(e, p => {
    const live = micProcessing();
    return [
      { type: 'head', label: 'Input device' },
      ...deviceItems('audioinput', p.input, id => setPrefs({ input: id }), 'Microphone'),
      'sep',
      { type: 'slider', label: 'Input volume', min: 0, max: 200, value: p.inVol ?? 100, format: v => `${v}%`, onChange: v => setPrefs({ inVol: v }), hint: live ? '' : "Applies once you're connected (needs a browser with Web Audio)." },
      { type: 'slider', label: 'Mic sensitivity', min: 0, max: 100, value: p.sens ?? 0, format: sensLabel, meter: micMeter, onChange: v => setPrefs({ sens: v }), hint: 'Quieter than the marker is not sent, so background noise stays out. All the way left = off.' },
      { label: 'Noise suppression', checked: p.noiseSuppression !== false, onClick: () => setPrefs({ noiseSuppression: p.noiseSuppression === false }) },
    ];
  });
}

export function outputMenu(e) {
  voiceMenu(e, p => [
    ...(canSelectOutput() ? [{ type: 'head', label: 'Output device' }, ...deviceItems('audiooutput', p.output, id => setPrefs({ output: id }), 'Speakers'), 'sep'] : []),
    { type: 'slider', label: 'Output volume', min: 0, max: 100, value: p.outVol ?? 100, format: v => `${v}%`, onChange: v => setPrefs({ outVol: v }) },
    { type: 'slider', label: 'Soundboard volume', min: 0, max: 100, value: p.board ?? 60, format: v => (v ? `${v}%` : 'Off'), onChange: v => setPrefs({ board: v }), hint: "How loud other people's soundboard sounds are for you." },
  ]);
}

export function cameraMenu(e) {
  voiceMenu(e, p => [
    { type: 'head', label: 'Camera' },
    ...deviceItems('videoinput', p.camera, id => setPrefs({ camera: id }), 'Camera'),
  ]);
}
