// Exercise the complete production SoundboardButton/Picker. Only services are mocked.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const {build}=await import(process.env.ESBUILD_MODULE||'esbuild');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const chat=join(root,'src/chat').replaceAll('\\','/');
const source=process.env.SOUNDBOARD_SOURCE||chat+'/Soundboard.jsx';
const deps=process.env.SOUNDBOARD_TEST_DEPS||root;
const require=createRequire(join(deps,'package.json'));
const entry=`import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{SoundboardButton}from'${source.replaceAll('\\','/')}';import{initSheets}from'${chat}/sheets.js';
window.soundTest={play:[],preview:[],stops:0};
function App(){const[show,setShow]=useState(true);window.mountSoundboard=setShow;useEffect(()=>initSheets(),[]);return <><div id="outside" style={{position:'fixed',left:0,top:0,width:120,height:50}}>Outside</div><div style={{position:'fixed',left:180,top:80}}>{show&&<SoundboardButton/>}</div></>}
createRoot(document.getElementById('root')).render(<App/>);window.rapidUnmount=()=>{flushSync(()=>document.querySelector('[title=Soundboard]').click());flushSync(()=>window.mountSoundboard(false))};`;
const mocks={api:`export const getToken=()=>'';export const apiFetch=async()=>({servers:[{sid:'test',name:'Test sounds',sounds:[{id:'first',name:'First sound'},{id:'second',name:'Second sound'}]}]});`,voice:`export const playBoardSound=id=>soundTest.play.push(id),previewBoardSound=s=>soundTest.preview.push(s.id),stopBoardSounds=()=>soundTest.stops++;`,store:`export const toast=()=>{},errorText=t=>t;`,emoji:`export const Twemoji=()=>null;`};
const built=await build({stdin:{contents:entry,loader:'jsx',resolveDir:deps},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'services',setup(b){b.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$|^lucide-react$/},args=>({path:require.resolve(args.path)}));b.onResolve({filter:/\/(api|voice|store|emoji)\.(js|jsx)$/},args=>({path:/\/(api|voice|store|emoji)\./.exec(args.path)[1],namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const css=readFileSync(chat+'/chat.css','utf8');
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{background:#111;color:#eee}</style><div id="root"></div><script>const originalAdd=window.addEventListener,originalRemove=window.removeEventListener;window.outsideHandlers=new Set();window.addEventListener=function(type,fn,...args){if(type==='mousedown'&&!String(fn).includes('_hitTargetInterceptor'))outsideHandlers.add(fn);return originalAdd.call(this,type,fn,...args)};window.removeEventListener=function(type,fn,...args){if(type==='mousedown')outsideHandlers.delete(fn);return originalRemove.call(this,type,fn,...args)}</script><script src="/app.js"></script>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const checks=[];
try {
 for(const mobile of [false,true]) {
  const page=await browser.newPage({viewport:{width:mobile?390:1400,height:850},isMobile:mobile,hasTouch:mobile}),errors=[];
  page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByTitle('Soundboard',{exact:true}).waitFor();
  const mode=mobile?'mobile':'desktop',trigger=page.getByTitle('Soundboard',{exact:true});
  for(let i=0;i<10;i++) {
   await trigger.click();await page.waitForTimeout(70);
   if(process.env.EXPECT_SOUNDBOARD_CRASH&&errors.length){assert(errors.some(e=>e.includes('getBoundingClientRect')||e.includes('currentTarget')));console.log('REPRODUCED second-open crash: '+errors[0]);await page.close();process.exitCode=0;break;}
   assert.deepEqual(errors,[],mode+' must not crash opening '+(i+1));
   await page.locator('.vc-sb').waitFor();await page.keyboard.press('Escape');await page.locator('.vc-sb').waitFor({state:'detached'});
  }
  if(process.env.EXPECT_SOUNDBOARD_CRASH){assert(errors.length,'Expected original implementation to reproduce crash');break;}
  checks.push(mode+': ten open/Escape-close cycles without crash');
  for(let i=0;i<5;i++){await trigger.click();await page.locator('.vc-sb').waitFor();if(mobile)await trigger.dispatchEvent('click');else await trigger.click();await page.locator('.vc-sb').waitFor({state:'detached'});}
  checks.push(mode+': button toggles repeatedly without crash');
  await trigger.click();await page.getByPlaceholder('Find a sound').fill('Second');assert.equal(await page.locator('.vc-sb-play').count(),1);await page.locator('.vc-sb-prev').click();assert.deepEqual(await page.evaluate(()=>soundTest.preview),['second']);
  await page.keyboard.press('Escape');assert(await page.evaluate(()=>soundTest.stops>0));checks.push(mode+': search and preview work; close stops preview');
  await trigger.click();await page.getByTitle('Play First sound for everyone in the call').click();assert.deepEqual(await page.evaluate(()=>soundTest.play),['first']);await page.keyboard.press('Escape');checks.push(mode+': playing a sound reaches the voice handler');
  await trigger.click();await page.waitForTimeout(50);
  if(mobile)await page.locator('.vc-sheet-back').click({position:{x:5,y:5}});else await page.locator('#outside').click();
  await page.locator('.vc-sb').waitFor({state:'detached'});checks.push(mode+': outside tap dismisses picker');
  await page.evaluate(()=>window.rapidUnmount());await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>outsideHandlers.size),0);assert.equal(await page.locator('.vc-sb,.vc-sheet-back').count(),0);assert.deepEqual(errors,[]);checks.push(mode+': immediate unmount leaves no outside listener, picker or backdrop');
  await page.close();
 }
 if(!process.env.EXPECT_SOUNDBOARD_CRASH){const out=process.env.SOUNDBOARD_TEST_OUTPUT||join(root,'test-results/soundboard');mkdirSync(out,{recursive:true});writeFileSync(join(out,'results.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(checks.join('\n'));}
}finally{await browser.close();await new Promise(r=>server.close(r));}
