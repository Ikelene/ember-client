import assert from 'node:assert/strict';import{writeFileSync,mkdirSync}from'node:fs';import{execFileSync}from'node:child_process';
const adb=process.env.ADB_BIN||'adb',serial=process.env.BONFIRE_TEST_SERIAL||'3A211FDJH000H7',run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8'}).trim(),shell=(...args)=>run('shell',...args),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ui(){shell('uiautomator','dump','/sdcard/bonfire-reactions-ui.xml');const xml=shell('cat','/sdcard/bonfire-reactions-ui.xml');return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));}
mkdirSync('artifacts/reaction-menu',{recursive:true});
const pages=await(await fetch('http://127.0.0.1:9223/json')).json(),p=pages.find(p=>p.url.startsWith('https://appassets.androidplatform.net/'));assert(p,'Isolated local fixture required');const ws=new WebSocket(p.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let n=0;const waiting=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const cb=waiting.get(m.id);waiting.delete(m.id);m.error?cb.reject(m.error):cb.resolve(m.result)}};const call=(method,params={})=>new Promise((resolve,reject)=>{waiting.set(++n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};const checks=[],check=async(name,expression)=>{assert.equal(await evaluate(expression),true,name);checks.push(name);console.log('PASS '+name)};
try{
 await call('Page.navigate',{url:'https://appassets.androidplatform.net/interaction-fixture.html'});await pause(1100);
 await evaluate(`localStorage.removeItem('bonfire.reaction-usage.v1:A');localStorage.removeItem('bonfire.reaction-usage.v1:B')`);
 const originalHeight=await evaluate('innerHeight');
 const nodes=await ui(),web=nodes.find(n=>n.class==='android.webkit.WebView'),bounds=/\[(\d+),(\d+)\]/.exec(web.bounds);const dpr=await evaluate('devicePixelRatio');const point=(x,y)=>[String(Math.round(+bounds[1]+x*dpr)),String(Math.round(+bounds[2]+y*dpr))];const rect=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const tap=async selector=>{const r=await rect(selector);shell('input','tap',...point(r.x,r.y));await pause(550)};
 const hold=async()=>{const r=await rect('.vc-text');shell('input','swipe',...point(r.x,r.y),...point(r.x,r.y),'1800');await pause(650)};
 await tap('.vc-head'); // Give the freshly navigated WebView actual window focus.
 await hold();await check('Pixel hold opens a menu with six quick reactions','document.querySelectorAll(".vc-quick-reactions button").length===6');
 await check('Only one visible backdrop; Android legacy dimmer hidden','document.querySelectorAll(".vc-sheet-back").length===1&&getComputedStyle(document.querySelector("#bf-sheet-scrim")).display==="none"');
 await evaluate(`window.addButton=[...document.querySelectorAll('.vc-ctx button')].find(b=>b.textContent==='Add reaction');addButton.id='pixel-add-reaction'`);
 await check('Action menu receives touches above dimmer',`(()=>{const e=document.querySelector('#pixel-add-reaction'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`);
 run('shell','screencap','-p','/sdcard/bonfire-reaction-menu.png');run('pull','/sdcard/bonfire-reaction-menu.png','artifacts/reaction-menu/pixel-menu.png');
 await tap('#pixel-add-reaction');await check('ADB tap opens the real emoji picker','!!document.querySelector(".vc-react-pop .vc-emoji-picker")');
 await tap('.vc-picker-search input');await call('Input.insertText',{text:'cat'});await pause(300);
 await check('Real picker filters emojis while Android keyboard is open','document.querySelectorAll(".vc-em").length===1');
 await tap('.vc-em');await check('ADB emoji tap adds a channel reaction','fixtureRequests.some(r=>r.method==="PUT"&&r.url==="/chat/messages/101/reactions/"+encodeURIComponent("🐈"))');
 if(await evaluate(`innerHeight<${originalHeight}-100`)){shell('input','keyevent','KEYCODE_BACK');await pause(400)}
 await hold();
 await check('Pixel quick row learns the new reaction',`(()=>{const e=document.querySelector('.vc-quick-reactions button');return (e.querySelector('img')?.alt||e.textContent)==='🐈'})()`);
 await tap('.vc-quick-reactions button');await check('Selected quick reaction toggles off without increasing usage','fixtureRequests.some(r=>r.method==="DELETE"&&r.url.endsWith(encodeURIComponent("🐈")))&&JSON.parse(localStorage.getItem("bonfire.reaction-usage.v1:A")).find(r=>r.emoji==="🐈").count===1');
 await hold();shell('input','keyevent','KEYCODE_BACK');await pause(500);await check('Android Back removes menu and backdrop','!document.querySelector(".vc-ctx,.vc-sheet-back")');
 writeFileSync('artifacts/reaction-menu/pixel-tests.json',JSON.stringify({checks,passed:checks.length},null,2));
}finally{ws.close()}
