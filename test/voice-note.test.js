import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_MS, SWIPE_CANCEL_PX, holdOutcome, isVoiceAtt, isVoiceLink, isVoiceName, micErrorText, peaksOf, pickFormat, seededPeaks, voiceFileName, voiceSeconds, voiceSummary } from '../src/chat/voice-note.js';

test('names: the file name is what marks a voice message', () => {
  const n = voiceFileName(1793700000000, 4512.4, 'weba');
  assert.equal(n, 'voice-message-1793700000000-4512.weba');
  assert.ok(isVoiceName(n));
  assert.equal(voiceSeconds(n), 4.512);
  assert.ok(isVoiceName('SPOILER_' + n));
  assert.ok(isVoiceName('voice-message-1793700000000.m4a'), 'no length in it is still one');
  assert.equal(voiceSeconds('voice-message-1793700000000.m4a'), 0);
  for (const no of ['song.weba', 'voice-message-1793700000000-1.exe', 'voice-message-1793700000000-1.html', 'my-voice-message-1793700000000.mp3', '']) assert.ok(!isVoiceName(no), no);
});
test('attachments: audio, or video because a server that sniffs the bytes calls webm video; never a file card', () => {
  const name = 'voice-message-1793700000000-4512.weba';
  assert.ok(isVoiceAtt({ type: 'audio', name }));
  assert.ok(isVoiceAtt({ type: 'video', name: 'voice-message-1793700000000-4512.webm' }));
  assert.ok(!isVoiceAtt({ type: 'file', name }));
  assert.ok(!isVoiceAtt({ type: 'audio', name: 'song.mp3' }));
  assert.ok(!isVoiceAtt(null));
});
test('links: found by the #n= name or the last path part, and previews say what it is', () => {
  const temp = 'https://cdn.nookara.cc/temp/abc123/voice-message-1793700000000-4512.weba';
  assert.ok(isVoiceLink(temp));
  assert.ok(isVoiceLink('https://nookara.cc/uploads/audio/a1b2.weba#n=' + encodeURIComponent('voice-message-1793700000000-4512.weba')));
  assert.ok(!isVoiceLink('https://example.com/song.mp3'));
  assert.ok(!isVoiceLink('https://example.com/a.weba#n=%E0%A4%A'), 'a broken name is just not one');
  assert.equal(voiceSummary(temp), 'Voice message');
  assert.equal(voiceSummary('look https://example.com/a'), 'look https://example.com/a');
});
test('format: webm where it exists, then Safari mp4, then ogg, none when nothing records', () => {
  assert.equal(pickFormat(m => m.startsWith('audio/webm')).ext, 'weba');
  assert.equal(pickFormat(m => m === 'audio/mp4').ext, 'm4a');
  assert.equal(pickFormat(m => m.startsWith('audio/ogg')).ext, 'ogg');
  assert.equal(pickFormat(() => false), null);
  assert.equal(pickFormat(() => { throw new Error('old browser'); }), null);
  assert.equal(pickFormat(() => true).type, 'audio/webm', 'upload checks get the type without the codec');
});
test('hold: letting go sends, a tap is an accident, sliding far enough deletes', () => {
  assert.equal(holdOutcome({ recordedMs: 2000, dx: 0 }), 'send');
  assert.equal(holdOutcome({ recordedMs: MIN_MS - 1, dx: 0 }), 'too_short');
  assert.equal(holdOutcome({ recordedMs: MIN_MS, dx: 0 }), 'send');
  assert.equal(holdOutcome({ recordedMs: 2000, dx: -(SWIPE_CANCEL_PX - 1) }), 'send');
  assert.equal(holdOutcome({ recordedMs: 2000, dx: -SWIPE_CANCEL_PX }), 'discard');
  assert.equal(holdOutcome({ recordedMs: 100, dx: -200 }), 'discard');
  assert.equal(holdOutcome({ recordedMs: 2000, dx: 300 }), 'send', 'sliding the other way changes nothing');
});
test('mic errors: each failure says what to do', () => {
  assert.match(micErrorText({ name: 'NotAllowedError' }), /Allow it/);
  assert.match(micErrorText({ name: 'NotFoundError' }), /No microphone/);
  assert.match(micErrorText({ name: 'NotReadableError' }), /Another app/);
  assert.match(micErrorText({ name: 'unsupported' }), /can't record/);
  assert.ok(micErrorText({}));
});
test('bars: scaled to the loudest, none empty, stable for the same file', () => {
  const p = peaksOf(Float32Array.from([0, 0.5, 0, -1, 0, 0.1, 0, 0]), 4);
  assert.deepEqual(p.map(v => Number(v.toFixed(2))), [0.5, 1, 0.1, 0.08]);
  assert.deepEqual(peaksOf(new Float32Array(0), 3), [0, 0, 0]);
  assert.deepEqual(seededPeaks('a', 8), seededPeaks('a', 8));
  assert.notDeepEqual(seededPeaks('a', 8), seededPeaks('b', 8));
  assert.ok(seededPeaks('a', 50).every(v => v >= 0.2 && v <= 0.9));
});

test('a plain voice-message file counts, a look-alike name does not', () => {
  for (const n of ['voice-message.ogg', 'voice-message (1).ogg', 'voice-message-1793800000000-25000.ogg']) assert.equal(isVoiceName(n), true, n);
  for (const n of ['voice-messages.ogg', 'my-voice-message.ogg', 'voice-message-final.ogg', 'voice-message.png']) assert.equal(isVoiceName(n), false, n);
  assert.equal(isVoiceLink('https://cdn.nookara.cc/temp/UyHKx6NMJoFTERslhD8Xhh/voice-message.ogg'), true);
});
