import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../src/chat/codeColors.js';

const join = toks => toks.map(x => x.t).join('');
const cls = (toks, t) => toks.find(x => x.t.trim() === t)?.c;

test('the tokens always join back to exactly the code', () => {
  const samples = [
    ['js', 'const x = 1; // hi\nfunction f(a) { return `t ${a}` + "s\\"q"; } /* b */'],
    ['py', 'def f(x):\n    """doc"""\n    return None  # c'],
    ['sh', 'echo "$HOME" ${X} $1 # c'],
    ['css', '.a #b { color: #fff; margin: 1.5px calc(2px); } @media x {}'],
    ['html', '<div class="a" data-x=\'1\'>hi &amp; <br/></div><!-- c -->'],
    ['yaml', 'name: x\n- key: 3 # c'],
    ['weird', '@ $ @@ "unterminated\n\'x'],
    ['sql', 'SELECT a FROM t WHERE b = 2 -- c'],
  ];
  for (const [lang, code] of samples) assert.equal(join(highlight(code, lang)), code, lang);
});

test('no language tag: plain', () => {
  assert.deepEqual(highlight('const x = 1', ''), [{ t: 'const x = 1', c: '' }]);
});

test('js: keywords, strings, numbers, comments, calls, literals', () => {
  const t = highlight('const x = foo(42, "hi", true); // note', 'js');
  assert.equal(cls(t, 'const'), 'kw');
  assert.equal(cls(t, 'foo'), 'fn');
  assert.equal(cls(t, '42'), 'nu');
  assert.equal(cls(t, '"hi"'), 'st');
  assert.equal(cls(t, 'true'), 'li');
  assert.equal(cls(t, '// note'), 'cm');
});

test('json keys get the property colour, values stay strings', () => {
  const t = highlight('{ "a": "b" }', 'json');
  assert.equal(cls(t, '"a"'), 'pr');
  assert.equal(cls(t, '"b"'), 'st');
});

test('python # comments and triple strings; sql is case-insensitive', () => {
  const p = highlight('x = 1 # c\n"""a\nb"""', 'python');
  assert.equal(cls(p, '# c'), 'cm');
  assert.equal(cls(p, '"""a\nb"""'), 'st');
  assert.equal(cls(highlight('SELECT 1', 'sql'), 'SELECT'), 'kw');
});

test('html tags and attributes, css properties', () => {
  const h = highlight('<a href="x">y</a>', 'html');
  assert.equal(cls(h, '<a'), 'kw');
  assert.equal(cls(h, 'href'), 'pr');
  assert.equal(cls(h, '"x"'), 'st');
  const c = highlight('a { color: red; }', 'css');
  assert.equal(cls(c, 'color'), 'pr');
});
