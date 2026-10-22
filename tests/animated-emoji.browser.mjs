import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const {build}=await import(process.env.ESBUILD_MODULE||'esbuild');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),chat=join(root,'src/chat').replaceAll('\\','/');
const deps=process.env.EMOJI_TEST_DEPS||root,require=createRequire(join(deps,'package.json'));
const {encodeEmoji}=createRequire(import.meta.url)('../../emoji-image.js');
const gif=readFileSync(join(root,'tests/fixtures/animated-emoji.gif'));
let rows=[],image;
const store=`import{useSyncExternalStore}from'react';let state={emojis:[],me:{id:'fixture',username:'Tester'},detail:{}},listeners=new Set();export const getState=()=>state;export const useChat=f=>useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb)},()=>f(state));export const loadEmojis=async()=>{const d=await(await fetch('/chat/emojis')).json();state={...state,emojis:d.servers};listeners.forEach(f=>f())};export const toast=t=>window.emojiError=t,errorText=t=>t,ask=()=>{};`;
const entry=`import React,{useState,useEffect,useRef}from'react';import{createRoot}from'react-dom/client';import EmojiPicker,{EmojiManager}from'${chat}/EmojiPicker.jsx';import{renderBody}from'${chat}/text.jsx';import{fill,serialize}from'${chat}/richInput.js';import{Reactions}from'${chat}/Reactions.jsx';
function App(){const[picker,setPicker]=useState(false),[token,setToken]=useState(''),input=useRef(null);useEffect(()=>{if(token)fill(input.current,token)},[token]);window.readComposer=()=>serialize(input.current);return <><EmojiManager sid="test"/><button id="choose" onClick={()=>setPicker(true)}>Choose emoji</button>{picker&&<EmojiPicker onPick={t=>{setToken(t);setPicker(false)}} onClose={()=>setPicker(false)}/>}<output id="token">{token}</output><div id="message">{renderBody(token,{}).nodes}</div><div id="editor" ref={input} contentEditable suppressContentEditableWarning/>{token&&<Reactions m={{id:1,reactions:[{emoji:token,users:['Tester'],count:1}]}} me="Tester" canReact/>}</>}
createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:entry,loader:'jsx',resolveDir:deps},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-services',setup(b){b.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$|^lucide-react$/},a=>({path:require.resolve(a.path)}));b.onResolve({filter:/\/store\.js$/},()=>({path:'store',namespace:'fixture'}));b.onResolve({filter:/\/api\.js$/},()=>({path:'api',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='store'?store:`export const apiFetch=async(url,opts)=>{const r=await fetch(url,opts);return r.json()};`,loader:'js'}));}}]});
const server=createServer(async(req,res)=>{
 try{
  const url=req.url.split('?')[0];
  if(url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(built.outputFiles[0].text)}
  if(url.startsWith('/uploads/emojis/')){res.setHeader('Content-Type','image/gif');return res.end(image)}
  if(url.startsWith('/chat/')||url==='/assets/emoji/emoji.json'){
   res.setHeader('Content-Type','application/json');
   if(req.method==='POST'){
    const form=await new Request('http://fixture.invalid',{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'}).formData();
    const file=form.get('file'),out=await encodeEmoji(Buffer.from(await file.arrayBuffer()));image=out.data;
    const emoji={eid:'e1234567890',name:form.get('name'),animated:!!out.animated,url:'/uploads/emojis/e1234567890.'+out.extension};rows=[emoji];return res.end(JSON.stringify({emoji}));
   }
   return res.end(JSON.stringify(url==='/chat/emojis'?{servers:[{sid:'test',name:'Fixture',emojis:rows}]}:url==='/assets/emoji/emoji.json'?[]:{emojis:rows,max:100}));
  }
  if(url!=='/'){res.statusCode=404;return res.end()}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(chat+'/chat.css','utf8')}body{background:#111;color:#eee;padding:20px}.vc-picker{position:fixed;left:16px;top:180px;bottom:auto}#editor{min-height:40px}</style><div id="root"></div><script src="/app.js"></script>`);
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),checks=[];
try{
 for(const mobile of [false,true]){
  rows=[];const page=await browser.newPage({viewport:{width:mobile?390:1400,height:850},isMobile:mobile,hasTouch:mobile}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('input[type=file]').setInputFiles({name:'dance.gif',mimeType:'application/octet-stream',buffer:gif});
  await page.locator('.vc-emoji-row .vc-chip').waitFor();assert.equal(await page.locator('.vc-emoji-row img').getAttribute('src'),'/uploads/emojis/e1234567890.gif');checks.push((mobile?'mobile':'desktop')+': actual manager uploads GIF and marks it animated');
  await page.locator('#choose').click();await page.getByPlaceholder('Find an emoji').fill('dance');await page.locator('.vc-em img[alt="dance"]').click();
  assert.equal(await page.locator('#token').textContent(),'<a:dance:e1234567890>');assert.equal(await page.evaluate(()=>readComposer()),'<a:dance:e1234567890>');checks.push((mobile?'mobile':'desktop')+': picker emits animated token and rich composer preserves it');
  for(const selector of ['#message img','#editor img','.vc-react-img']){
   const img=page.locator(selector);assert.equal(await img.getAttribute('src'),'/uploads/emojis/e1234567890.gif');assert(await img.evaluate(el=>el.complete&&el.naturalWidth===128));
  }
  checks.push((mobile?'mobile':'desktop')+': message, composer and reaction load the animated GIF');assert.deepEqual(errors,[]);await page.close();
 }
 const out=process.env.EMOJI_TEST_OUTPUT||join(root,'test-results/animated-emoji');mkdirSync(out,{recursive:true});writeFileSync(join(out,'results.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(checks.join('\n'));
}finally{await browser.close();await new Promise(r=>server.close(r));}
