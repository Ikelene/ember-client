// Colours for ```lang code blocks (Ikelene 2026-11-23). A small tokenizer instead of a highlighting library (those are
// 100+ KB): comments, strings, numbers, keywords, literals, function calls, types, plus tags/attributes for markup and
// properties for CSS. Only blocks with a language tag are coloured (like Discord); an unknown tag gets the generic rules.
// Pure: highlight(code, lang) -> [{ t: text, c: class | '' }] whose texts join back to exactly the code.

const words = s => new Set(s.split(' '));
const C_LIKE = 'if else for while do switch case default break continue return goto try catch finally throw new delete sizeof typeof';
const JS = words(`${C_LIKE} var let const function class extends super this import export from as async await yield of in instanceof void static get set with debugger enum interface type implements private public protected readonly declare namespace abstract keyof satisfies`);
const PY = words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self print');
const C = words(`${C_LIKE} int char float double long short unsigned signed bool void struct union enum typedef const static extern volatile register inline auto class public private protected virtual override template typename namespace using operator friend this explicit constexpr nullptr_t include define ifdef ifndef endif pragma`);
const CS = words(`${C_LIKE} using namespace class struct interface enum public private protected internal static readonly const void int string bool double float long var new override virtual abstract sealed async await foreach in is as out ref params this base get set value record`);
const JAVA = words(`${C_LIKE} class interface enum extends implements public private protected static final abstract void int long short byte char boolean float double package import this super synchronized var record instanceof throws`);
const GO = words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var string int int64 float64 bool byte rune error any');
const RUST = words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while i32 i64 u8 u32 u64 usize f32 f64 bool str String Vec Option Result');
const KT = words(`${C_LIKE} fun val var class object interface data sealed open override private public internal protected is as in when import package companion init this super suspend lateinit`);
const SWIFT = words(`${C_LIKE} func let var class struct enum protocol extension import guard in as is self Self static private public internal override init deinit where repeat`);
const PHP = words(`${C_LIKE} echo function class public private protected static abstract final extends implements namespace use foreach as fn match require include require_once include_once array isset unset empty`);
const SH = words('if then else elif fi for while until do done case esac in function return exit echo export local readonly set unset source cd sudo');
const SQL = words('select from where and or not insert into values update set delete create table drop alter add index primary key foreign references join left right inner outer on group by order having limit offset as distinct union all null is in like between case when then else end default unique exists count sum avg min max');
const LUA = words('and break do else elseif end for function goto if in local not or repeat return then until while self');
const RUBY = words('begin end def class module if elsif else unless while until for in do return yield self super require include extend attr_accessor puts then case when rescue ensure raise lambda proc');
const LITERALS = words('true false null undefined None True False nil NaN Infinity');

const LANGS = {
  js: { kw: JS, line: '//', block: true, tmpl: true }, ts: 'js', jsx: 'js', tsx: 'js', javascript: 'js', typescript: 'js', mjs: 'js', cjs: 'js', json: 'js', jsonc: 'js',
  py: { kw: PY, line: '#', triple: true }, python: 'py',
  c: { kw: C, line: '//', block: true }, cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cc: 'c',
  cs: { kw: CS, line: '//', block: true }, csharp: 'cs', 'c#': 'cs',
  java: { kw: JAVA, line: '//', block: true },
  go: { kw: GO, line: '//', block: true, tmpl: true }, golang: 'go',
  rs: { kw: RUST, line: '//', block: true }, rust: 'rs',
  kt: { kw: KT, line: '//', block: true }, kotlin: 'kt',
  swift: { kw: SWIFT, line: '//', block: true },
  php: { kw: PHP, line: '//', hash: true, block: true, vars: true },
  sh: { kw: SH, line: '#', vars: true }, bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', ps1: 'sh', powershell: 'sh',
  sql: { kw: SQL, line: '--', block: true, nocase: true },
  lua: { kw: LUA, line: '--' },
  rb: { kw: RUBY, line: '#' }, ruby: 'rb',
  yaml: { kw: new Set(), line: '#', keys: true }, yml: 'yaml', toml: 'yaml', ini: 'yaml',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
};
const GENERIC = { kw: new Set([...JS, ...PY]), line: '//', hash: true, block: true };

export function langOf(lang) {
  let l = String(lang || '').toLowerCase();
  let spec = LANGS[l];
  if (typeof spec === 'string') { l = spec; spec = LANGS[spec]; }
  return { name: l, spec: spec || GENERIC };
}

function push(out, t, c) {
  if (!t) return;
  const last = out[out.length - 1];
  if (last && last.c === c) last.t += t; else out.push({ t, c });
}

// a quoted string from i (quote q), escapes included; ends at the closing quote or (single-line quotes) the line's end
function strEnd(code, i, q, multiline) {
  let j = i + q.length;
  while (j < code.length) {
    if (code[j] === '\\') { j += 2; continue; }
    if (code.startsWith(q, j)) return j + q.length;
    if (!multiline && code[j] === '\n') return j;
    j++;
  }
  return code.length;
}

function codeTokens(code, spec) {
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const rest = code.slice(i, i + 3);
    // comments
    if ((spec.line && code.startsWith(spec.line, i)) || (spec.hash && ch === '#')) {
      let j = code.indexOf('\n', i); if (j < 0) j = n;
      push(out, code.slice(i, j), 'cm'); i = j; continue;
    }
    if (spec.block && rest.startsWith('/*')) {
      let j = code.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      push(out, code.slice(i, j), 'cm'); i = j; continue;
    }
    // strings
    if (spec.triple && (rest === '"""' || rest === "'''")) { const j = strEnd(code, i, rest, true); push(out, code.slice(i, j), 'st'); i = j; continue; }
    if (ch === '"' || ch === "'" || (ch === '`' && (spec.tmpl || spec === GENERIC))) {
      const j = strEnd(code, i, ch, ch === '`');
      // a JSON / YAML-ish key: "name": -> property colour
      const key = /^\s*:/.test(code.slice(j, j + 8)) && ch !== '`';
      push(out, code.slice(i, j), key ? 'pr' : 'st'); i = j; continue;
    }
    // $variables (shell, PHP)
    if (spec.vars && ch === '$' && /[\w{]/.test(code[i + 1] || '')) {
      const m = /^\$(\{[^}\n]*\}|\w+)/.exec(code.slice(i));
      if (m) { push(out, m[0], 'va'); i += m[0].length; continue; }
    }
    // numbers
    if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] || '')) {
      const m = /^(0x[0-9a-f_]+|0b[01_]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)[a-z]*/i.exec(code.slice(i));
      push(out, m[0], 'nu'); i += m[0].length; continue;
    }
    // words
    const m = /[A-Za-z_$@]/.test(ch) && /^[@$]?[A-Za-z_$][\w$]*/.exec(code.slice(i));
    if (m) {
      const w = m[0];
      const look = code.slice(i + w.length).match(/^\s*(.)/)?.[1];
      let c = '';
      if (LITERALS.has(w)) c = 'li';
      else if (spec.kw.has(spec.nocase ? w.toLowerCase() : w)) c = 'kw';
      else if (spec.keys && look === ':' && /^\s*(-\s+)?$/.test(code.slice(code.lastIndexOf('\n', i - 1) + 1, i))) c = 'pr'; // key: at a line's start
      else if (w[0] === '@') c = 'kw';
      else if (look === '(') c = 'fn';
      else if (/^[A-Z][a-z0-9]/.test(w)) c = 'ty';
      push(out, w, c); i += w.length; continue;
    }
    // anything else (punctuation, spaces) runs on as plain text
    let j = i + 1;
    while (j < n && !/[A-Za-z0-9_$@"'`#/\-]/.test(code[j])) j++;
    push(out, code.slice(i, j), ''); i = j;
  }
  return out;
}

function cssTokens(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  let depth = 0;
  while (i < n) {
    const ch = code[i];
    if (code.startsWith('/*', i)) { let j = code.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push(out, code.slice(i, j), 'cm'); i = j; continue; }
    if (ch === '"' || ch === "'") { const j = strEnd(code, i, ch, false); push(out, code.slice(i, j), 'st'); i = j; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === '@') { const m = /^@[\w-]+/.exec(code.slice(i)); push(out, m[0], 'kw'); i += m[0].length; continue; }
    if (ch === '#' && depth > 0) { const m = /^#[0-9a-f]{3,8}\b/i.exec(code.slice(i)); if (m) { push(out, m[0], 'nu'); i += m[0].length; continue; } }
    if (/[0-9.]/.test(ch) && /[0-9]/.test(code[i + (ch === '.' ? 1 : 0)] || '') && !/[\w-]/.test(code[i - 1] || '')) {
      const m = /^\d*\.?\d+[a-z%]*/i.exec(code.slice(i)); push(out, m[0], 'nu'); i += m[0].length; continue;
    }
    if (/[A-Za-z-]/.test(ch)) {
      const m = /^-*[A-Za-z][\w-]*/.exec(code.slice(i));
      const w = m[0];
      const look = code.slice(i + w.length).match(/^\s*(.)/)?.[1];
      push(out, w, depth > 0 ? (look === ':' ? 'pr' : look === '(' ? 'fn' : 'st') : 'ty');
      i += w.length; continue;
    }
    let j = i + 1;
    while (j < n && !/[A-Za-z0-9.@#"'{}/-]/.test(code[j])) j++;
    push(out, code.slice(i, j), ''); i = j;
  }
  return out;
}

function htmlTokens(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code.startsWith('<!--', i)) { let j = code.indexOf('-->', i + 4); j = j < 0 ? n : j + 3; push(out, code.slice(i, j), 'cm'); i = j; continue; }
    const tag = /^<\/?[A-Za-z!?][\w:.-]*/.exec(code.slice(i, i + 80));
    if (tag) {
      push(out, tag[0], 'kw'); i += tag[0].length;
      // attributes until the tag closes
      while (i < n && code[i] !== '>') {
        const ch = code[i];
        if (ch === '"' || ch === "'") { const j = strEnd(code, i, ch, true); push(out, code.slice(i, j), 'st'); i = j; continue; }
        const at = /^[A-Za-z_:@#.-][\w:.-]*/.exec(code.slice(i));
        if (at) { push(out, at[0], 'pr'); i += at[0].length; continue; }
        if (code.startsWith('/>', i)) break;
        push(out, ch, ''); i++;
      }
      if (code.startsWith('/>', i)) { push(out, '/>', 'kw'); i += 2; } else if (code[i] === '>') { push(out, '>', 'kw'); i++; }
      continue;
    }
    if (code[i] === '&') { const m = /^&#?\w+;/.exec(code.slice(i)); if (m) { push(out, m[0], 'nu'); i += m[0].length; continue; } }
    let j = i + 1;
    while (j < n && code[j] !== '<' && code[j] !== '&') j++;
    push(out, code.slice(i, j), ''); i = j;
  }
  return out;
}

const MAX = 20000; // a huge paste stays plain (it would be slow to colour and nobody reads that much)

export function highlight(code, lang) {
  code = String(code ?? '');
  if (!lang || code.length > MAX) return [{ t: code, c: '' }];
  const { name, spec } = langOf(lang);
  if (name === 'css') return cssTokens(code);
  if (name === 'html') return htmlTokens(code);
  return codeTokens(code, spec);
}
