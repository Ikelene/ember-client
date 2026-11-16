import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_TARGETS, detectAppTarget, linuxDownloads } from '../src/chat/appDownloadInfo.js';

test('the app picker starts on this device', () => {
  assert.equal(detectAppTarget('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0'), 'windows');
  assert.equal(detectAppTarget('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1', 0), 'mac');
  assert.equal(detectAppTarget('Mozilla/5.0 (Linux; Android 15; Pixel 8) Mobile Chrome/130.0'), 'android');
  assert.equal(detectAppTarget('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'), 'linux');
});
test('devices with no app start with nothing picked', () => {
  assert.equal(detectAppTarget('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), null);
  assert.equal(detectAppTarget('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1', 5), null); // an iPad asking for desktop sites
  assert.equal(detectAppTarget(''), null);
});
test('each app has its own download link', () => {
  assert.equal(APP_TARGETS.mac.path, '/ember/download?os=mac');
  assert.equal(APP_TARGETS.windows.path, '/ember/download?os=windows');
  assert.equal(APP_TARGETS.android.path, '/ember/android/');
});
test('Linux packages come from latest.json, with an install command each', () => {
  const d = linuxDownloads({ linux: { version: '1.2.3', appimage: { url: 'https://cdn.nookara.cc/ember/Ember-1.2.3.AppImage', size: 104857600 }, deb: { url: 'https://cdn.nookara.cc/ember/ember_1.2.3_amd64.deb' }, pacman: { url: 'http://insecure.example/x.pkg.tar.zst' } } });
  assert.equal(d.version, '1.2.3');
  assert.deepEqual(d.items.map(i => i.id), ['appimage', 'deb']); // (not https: left out)
  assert.equal(d.items[0].command, 'chmod +x Ember-1.2.3.AppImage && ./Ember-1.2.3.AppImage');
  assert.equal(d.items[0].mb, 100);
  assert.equal(d.items[1].command, 'sudo apt install ./ember_1.2.3_amd64.deb');
  assert.equal(linuxDownloads({}), null);
  assert.equal(linuxDownloads({ linux: { appimage: { url: 'javascript:alert(1)' } } }), null);
  assert.equal(APP_TARGETS.linux.name, 'Linux');
});
