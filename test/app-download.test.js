import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_TARGETS, detectAppTarget } from '../src/chat/appDownloadInfo.js';

test('the app picker starts on this device', () => {
  assert.equal(detectAppTarget('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0'), 'windows');
  assert.equal(detectAppTarget('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1', 0), 'mac');
  assert.equal(detectAppTarget('Mozilla/5.0 (Linux; Android 15; Pixel 8) Mobile Chrome/130.0'), 'android');
});
test('devices with no app start with nothing picked', () => {
  assert.equal(detectAppTarget('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), null);
  assert.equal(detectAppTarget('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1', 5), null); // an iPad asking for desktop sites
  assert.equal(detectAppTarget('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'), null);
  assert.equal(detectAppTarget(''), null);
});
test('each app has its own download link', () => {
  assert.equal(APP_TARGETS.mac.path, '/bonfire/download?os=mac');
  assert.equal(APP_TARGETS.windows.path, '/bonfire/download?os=windows');
  assert.equal(APP_TARGETS.android.path, '/bonfire/android/');
});
