// Run from the repo root after npm ci: node tests/composer-scope.mjs
// Exercise every effect in the complete production Composer, not a reconstructed
// subset with manually supplied refs (which previously concealed a scope error).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const {transformSync}=await import(process.env.ESBUILD_MODULE || 'esbuild');
const source=readFileSync(new URL('../src/chat/Messages.jsx',import.meta.url),'utf8');
const composer=source.slice(source.indexOf('export function Composer(')).replace('export function','function');
function mount(text,mobile=false){
 const effects=[],noop=()=>{},nil=()=>null;
 const state={settings:{strip_tracking:false},emojis:[],members:{},detail:{},statusReplyDraft:null};
 const globals={React:{createElement:()=>null},useState:v=>[v,noop],useRef:current=>({current}),useEffect:f=>effects.push(f),useChat:f=>f(state),getState:()=>state,keyOf:JSON.stringify,P:{ATTACH:1},has:()=>true,useSuggestItems:()=>[],window:{matchMedia:()=>({matches:mobile})},document:{addEventListener:noop,removeEventListener:noop},addEventListener:noop,removeEventListener:noop,setTimeout:noop,loadEmojiData:()=>Promise.resolve([]),loadEmojis:noop,loadMembers:noop,clearStatusReply:noop,draftsAll:()=>({})};
 for(const name of ['Plus','X','Lock','ImageIcon','Film','Music','FileIcon','GifIcon','Smile','SendHorizontal','Typing','EmojiPicker','MediaPicker','MentionPicker'])globals[name]=nil;
 const code=transformSync(text,{loader:'jsx',jsxFactory:'React.createElement'}).code;
 runInNewContext(code+`;Composer({view:{kind:'dm',username:'TEST'},placeholder:'Message',locked:false,replyTo:null,setReplyTo:()=>{}});`,globals);
 for(const effect of effects)effect();
}
const declaration='  const uploadContext = useRef({ key, pending: 0 });';
assert(composer.includes(declaration),'Upload context must be declared inside Composer');
assert(!source.slice(source.indexOf('export function MessageList('),source.indexOf('export function Composer(')).includes(declaration),'MessageList must not own the composer upload ref');
assert.throws(()=>mount(composer.replace(declaration,'')),/uploadContext is not defined/,'Regression test reproduces the reported scope crash');
mount(composer,false);mount(composer,true);
console.log('PASS complete Composer effects resolve their upload context on desktop and mobile');
