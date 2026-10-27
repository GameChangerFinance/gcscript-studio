import { describe, expect, it } from 'vitest';
import {
  collectChangedLeaves,
  errorMessage,
  getAt,
  isJsonValue,
  parseJSONC,
  patchJSONC,
  sourcePathAt,
  sourceRange,
  updateSource,
} from '../../src/core/json';
describe('JSONC editing', () => {
  it('parses comments and trailing commas, rejects syntax and empty input', () => {
    expect(parseJSONC('{/*a*/"x":1,}')).toEqual({ x: 1 });
    expect(() => parseJSONC('')).toThrow();
    expect(() => parseJSONC('{')).toThrow('JSONC:');
  });
  it('retains comments on scalar edits and exact source for no change', () => {
    const source = '{\n // keep\n "amount": "9007199254740993",\n "nested": [true, null]\n}';
    const next = updateSource(
      source,
      { amount: '9007199254740994', nested: [false, null] },
      () => false,
    );
    expect(next).toContain('// keep');
    expect(parseJSONC(next)).toEqual({ amount: '9007199254740994', nested: [false, null] });
    expect(updateSource(source, parseJSONC(source), () => false)).toBe(source);
  });
  it('requires explicit approval to normalize structural edits with comments', () => {
    const source = '{//keep\n"a":1}';
    expect(() => updateSource(source, { b: 2, a: 1 }, () => false)).toThrow(
      'preserve JSONC comments',
    );
    expect(parseJSONC(updateSource(source, { b: 2, a: 1 }, () => true))).toEqual({ b: 2, a: 1 });
    expect(updateSource('{"a":1}', { a: [1] }, () => false)).toContain('[\n');
  });
  it('patches and deletes at source paths', () => {
    const text = '{"x":[{"a":2}]}';
    expect(getAt(parseJSONC(text), ['x', 0, 'a'])).toBe(2);
    expect(getAt(0, ['missing'])).toBeUndefined();
    expect(sourcePathAt(text, text.indexOf('2'))).toEqual(['x', 0, 'a']);
    expect(sourceRange(text, ['x', 0, 'a'])).toEqual({ offset: text.indexOf('2'), length: 1 });
    expect(sourceRange(text, ['none'])).toBeNull();
    expect(parseJSONC(patchJSONC(text, ['x', 0, 'a'], undefined))).toEqual({ x: [{}] });
  });
  it('keeps safe JSON data and rejects non-finite or executable values', () => {
    expect(isJsonValue({ x: [true, 'a', null] })).toBe(true);
    expect(isJsonValue({ x: undefined })).toBe(false);
    expect(isJsonValue(Infinity)).toBe(false);
    expect(isJsonValue(() => {})).toBe(false);
    expect(collectChangedLeaves([1], [1, 2])[0]?.structural).toBe(true);
    expect(errorMessage('failure')).toBe('failure');
    expect(errorMessage(Error('failure'))).toBe('failure');
  });
});
