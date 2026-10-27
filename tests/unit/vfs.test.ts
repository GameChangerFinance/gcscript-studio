import { describe, expect, it } from 'vitest';
import * as vfs from '../../src/core/project/vfs';
import { DEFAULT_CONFIG } from '../../src/config';
const project = () => vfs.createProject(DEFAULT_CONFIG, 'fixture-project');
const text = { text: 'hello', encoding: 'utf8' as const };
describe('virtual filesystem', () => {
  it.each(['', '/', '../secret', 'a/../b', 'a/./b', 'a//b', 'a\0b', 'a\nb', 'a'.repeat(256)])(
    'rejects unsafe write path %j',
    (path) => {
      expect(() => vfs.path(path)).toThrow();
    },
  );
  it('normalizes root, windows and absolute logical paths', () => {
    expect(vfs.path('/', true)).toBe('');
    expect(vfs.path('\\lib\\thing.json')).toBe('lib/thing.json');
    expect(vfs.parent('main.gcscript')).toBe('');
    expect(vfs.name('a/b')).toBe('b');
  });
  it('creates files/folders at an empty virtual root', () => {
    let p: vfs.Project = { ...project(), active: '', files: {} };
    p = vfs.mkdir(p, 'empty');
    p = vfs.put(p, 'hello.txt', text);
    expect(p.files['hello.txt']).toEqual(text);
    expect(p.dirs).not.toContain('');
    expect(vfs.has(p, '')).toBe(true);
  });
  it('is immutable, preserves bytes, and detects overlap in either direction', () => {
    const first = project(),
      second = vfs.put(first, 'a/b.bin', { text: 'AP8A', encoding: 'base64' });
    expect(first.dirs).toEqual([]);
    expect(second.dirs).toContain('a');
    expect(second.files['a/b.bin']?.encoding).toBe('base64');
    expect(() => vfs.put(second, 'a', text)).toThrow('Directory');
    expect(() => vfs.put(second, 'a/b.bin', text)).toThrow('already exists');
    expect(() => vfs.mkdir(second, 'a/b.bin/c')).toThrow('blocks');
    expect(vfs.put(second, 'a/b.bin', text, true).files['a/b.bin']).toEqual(text);
  });
  it('moves subtrees and active identity, copies with collision checks', () => {
    let p = vfs.put(project(), 'lib/helper.gcscript', text);
    p = { ...p, active: 'lib/helper.gcscript' };
    const moved = vfs.transfer(p, 'lib', 'src');
    expect(moved.active).toBe('src/helper.gcscript');
    expect(moved.files['lib/helper.gcscript']).toBeUndefined();
    expect(p.files['lib/helper.gcscript']).toEqual(text);
    const copied = vfs.moveInto(moved, 'src', '', true);
    expect(copied.files['src (copy)/helper.gcscript']).toEqual(text);
    expect(() => vfs.transfer(p, 'lib', 'lib/nested')).toThrow('inside itself');
    expect(() => vfs.transfer(p, 'missing', 'x')).toThrow('Source');
    expect(() => vfs.transfer(p, 'lib', 'main.gcscript')).toThrow('Destination');
    expect(() => vfs.transfer(p, 'lib', 'lib', true)).toThrow('itself');
    expect(vfs.transfer(p, 'lib', 'lib')).toBe(p);
  });
  it('removes whole subtrees and chooses an existing active file', () => {
    const p = { ...vfs.put(project(), 'dir/item', text), active: 'dir/item' };
    expect(vfs.remove(p, 'dir').active).toBe('main.gcscript');
    expect(() => vfs.remove(p, 'missing')).toThrow('Not found');
    expect(vfs.remove({ ...p, files: { 'dir/item': text } }, 'dir').active).toBe('');
  });
  it('names duplicates deterministically without conflating directories and files', () => {
    let p = vfs.put(project(), 'a.txt', text);
    p = vfs.put(p, 'a (copy).txt', text);
    expect(vfs.unique(p, 'a.txt')).toBe('a (copy 2).txt');
    expect(vfs.unique(p, 'new')).toBe('new');
    expect(() => vfs.moveInto(p, 'a.txt', 'a.txt')).toThrow('directory');
    expect(() => vfs.moveInto(p, 'a.txt', 'missing')).toThrow('directory');
  });
  it('renders directories before natural-sorted filenames including empty folders', () => {
    let p = vfs.mkdir(project(), 'empty');
    p = vfs.put(p, 'file10.txt', text);
    p = vfs.put(p, 'file2.txt', text);
    expect(vfs.tree(p).children.map((node) => node.name)).toEqual([
      'empty',
      'file2.txt',
      'file10.txt',
      'main.gcscript',
    ]);
  });
  it.each([
    ['a.gcscript', 'json'],
    ['a.gcscript.jsonc', 'json'],
    ['a.json', 'json'],
    ['a.ts', 'typescript'],
    ['a.jsx', 'javascript'],
    ['a.css', 'css'],
    ['a.html', 'html'],
    ['a.md', 'markdown'],
    ['a.yaml', 'yaml'],
    ['a.xml', 'xml'],
    ['a.bin', 'plaintext'],
  ])('selects %s language', (file, language) => {
    expect(vfs.monacoLanguage(file)).toBe(language);
  });
  it('validates persisted state and rejects collisions or missing active files', () => {
    const p = project();
    expect(vfs.parseProject(JSON.parse(JSON.stringify(p)), DEFAULT_CONFIG.version)).toEqual(p);
    expect(() => vfs.parseProject({ ...p, version: 'other' }, DEFAULT_CONFIG.version)).toThrow(
      'version',
    );
    expect(() => vfs.parseProject({ ...p, active: 'gone' }, DEFAULT_CONFIG.version)).toThrow(
      'Active',
    );
    expect(() =>
      vfs.parseProject({ ...p, files: { '../x': text } }, DEFAULT_CONFIG.version),
    ).toThrow();
    expect(() => vfs.parseProject({ ...p, dirs: ['bad//dir'] }, DEFAULT_CONFIG.version)).toThrow();
    expect(() => vfs.parseProject({ ...p, revision: -1 }, DEFAULT_CONFIG.version)).toThrow(
      'Invalid',
    );
    expect(() =>
      vfs.parseProject({ ...p, files: { bad: { text: 42 } } }, DEFAULT_CONFIG.version),
    ).toThrow('file');
  });
  it('retains __proto__ as data without prototype mutation', () => {
    const p = vfs.put(project(), '__proto__', text);
    expect(Object.getPrototypeOf(p.files)).toBe(Object.prototype);
    expect(Object.hasOwn(p.files, '__proto__')).toBe(true);
    expect(vfs.tree(p).children.some((node) => node.name === '__proto__')).toBe(true);
  });
});
