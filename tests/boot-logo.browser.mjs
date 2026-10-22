// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/boot-logo.browser.mjs
// The loading screen shows Ember's bubble with a light running round it, and holds still for prefers-reduced-motion;
// the logo is one inline SVG that takes its colour from the text colour (so the rail's Home button can tint it).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dashboard = fileURLToPath(new URL('../', import.meta.url));
const chat = join(dashboard, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BootScreen}from'${chat}/Boot.jsx';import{BonfireLogo}from'${chat}/BonfireLogo.jsx';import{setDesign,getDesign}from'${chat}/design.js';window.setDesign=setDesign;window.getDesign=getDesign;
createRoot(document.getElementById('root')).render(<div><BootScreen /><div className="vc"><div className="vc-composer" id="comp">x</div></div><div id="logo" style={{color:'rgb(1, 2, 3)'}}><BonfireLogo size={30} /></div></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: dashboard }, jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json' }, define: { 'process.env.NODE_ENV': '"production"' } });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(chat, 'rounded.css'), 'utf8') + readFileSync(join(chat, 'boot.css'), 'utf8') + readFileSync(join(dashboard, 'src/styles.css'), 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><style>${css.replace(/url\(\/assets[^)]*\)/g, 'none')}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
try {
  for (const motion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ reducedMotion: motion });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.vc-boot-logo').waitFor();
    const r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.vc-boot-logo')); return { name: cs.animationName, opacity: cs.opacity, role: document.querySelector('.vc-boot').getAttribute('role') }; });
    assert.equal(r.role, 'status');
    if (motion === 'reduce') { assert.equal(r.name, 'none', 'reduced motion: no animation'); assert.equal(r.opacity, '1', 'reduced motion: just the still logo'); } else assert.equal(r.name, 'vc-boot-breathe');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS boot screen (${motion})`);
  }
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const stroke = await page.evaluate(() => getComputedStyle(document.querySelector('#logo .bf-logo path')).stroke);
  assert.equal(stroke, 'rgb(1, 2, 3)', 'the logo takes the surrounding text colour');
  console.log('PASS logo follows currentColor');
  // rounded / square: the choice is kept, and only the rounded design rounds the composer
  const radius = () => page.evaluate(() => getComputedStyle(document.querySelector('#comp')).borderRadius);
  assert.equal(await page.evaluate(() => getDesign()), 'square', 'square is the default');
  assert.equal(await radius(), '0px');
  await page.evaluate(() => setDesign('rounded')); assert.notEqual(await radius(), '0px');
  assert.equal(await page.evaluate(() => [getDesign(), localStorage.getItem('bf_design')]).then(x => x.join()), 'rounded,rounded');
  await page.evaluate(() => setDesign('square')); assert.equal(await radius(), '0px');
  console.log('PASS rounded / square switch');
} finally { await browser.close(); server.close(); }
