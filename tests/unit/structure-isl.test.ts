import { describe, expect, it } from 'vitest';
import { catalog, authoring } from '../fixtures';
import { islArity, parseISLExpression, serializeISL } from '../../src/core/language/isl';
import { childCollections, describeScope, reorderValue } from '../../src/core/language/structure';
import { palette } from '../../src/adapters/blockly/palette';
import { DEFAULT_CONFIG } from '../../src/config';
import { getAt } from '../../src/core/json';
describe('ISL graphical subset', () => {
  it('takes optional argument bounds from published contracts', () => {
    expect(islArity(catalog, 'return')).toEqual({ min: 0, max: 1 });
    expect(islArity(catalog, 'missing')).toEqual({ min: 0, max: Infinity });
  });
  it('preserves nested calls and quoted values without evaluation', () => {
    const node = parseISLExpression("{get('args.\\'name')}", catalog);
    expect(node?.kind).toBe('call');
    if (!node) throw Error('missing');
    expect(serializeISL(node)).toContain("get('args.\\'name')");
    expect(parseISLExpression('{return(undefined)}', catalog)).not.toBeNull();
    expect(parseISLExpression('{return(true)}', catalog)).not.toBeNull();
    expect(parseISLExpression('{return(null)}', catalog)).not.toBeNull();
    expect(parseISLExpression('{return(-1.25e+3)}', catalog)).not.toBeNull();
    expect(parseISLExpression('{return("hi")}', catalog)).not.toBeNull();
  });
  it.each([
    'hello',
    '{unknown()}',
    '{get(}',
    '{get(1,)}',
    '{return(1,2)}',
    '{return(missing)}',
    "{return('unterminated)}",
    '{get(1)+get(2)}',
    '{return({"a":1})}',
    '{return()} extra',
  ])('retains unsupported source losslessly: %s', (source) => {
    expect(parseISLExpression(source, catalog)).toBeNull();
  });
  it('round-trips the known zero-argument form', () => {
    const node = parseISLExpression('{return()}', catalog);
    if (!node) throw Error('missing');
    expect(serializeISL(node)).toBe('{return()}');
  });
});
describe('program structure', () => {
  const doc = {
    type: 'script',
    run: {
      a: { type: 'macro', run: "{get('args')}" },
      b: { type: 'data', value: '{get(1)}' },
      c: { type: 'data', value: [1, 2] },
    },
  };
  it('builds ordered scope rows and schema-supported expression nodes', () => {
    const scope = describeScope(doc, ['run'], authoring, catalog);
    expect(scope.rows.map((row) => row.name)).toEqual(['a', 'b', 'c']);
    expect(scope.rows[0]?.fn?.name).toBe('macro');
    expect(scope.rows[0]?.expressions).toHaveLength(1);
    expect(scope.rows[1]?.expressions).toHaveLength(0);
    expect(scope.rows[2]?.collections).toEqual([['run', 'c', 'value']]);
    expect(() => describeScope(doc, ['type'], authoring, catalog)).toThrow('collection');
    expect(childCollections(null, [])).toEqual([]);
  });
  it('reorders objects/arrays without changing data or the original', () => {
    const next = reorderValue(doc, ['run', 'b'], -1);
    expect(Object.keys(getAt(next, ['run']) ?? {})).toEqual(['b', 'a', 'c']);
    expect(Object.keys(doc.run)).toEqual(['a', 'b', 'c']);
    expect(reorderValue([1, 2], [0], 1)).toEqual([2, 1]);
    expect(reorderValue(doc, ['run', 'a'], -1)).toBe(doc);
    expect(() => reorderValue(doc, [], 1)).toThrow('root');
    expect(() => reorderValue(doc, ['missing', 'child'], 1)).toThrow('parent');
  });
  it('builds language-backed drawers and filters without losing JSON primitives', () => {
    const result = JSON.stringify(palette(catalog, DEFAULT_CONFIG));
    expect(result).toContain('GCScript DSL');
    expect(result).toContain('Extras · Build stage');
    expect(result).toContain('$importAsData');
    expect(result).toContain('JSON types');
    expect(result).not.toContain('Keys & scripts');
    const filtered = JSON.stringify(palette(catalog, DEFAULT_CONFIG, 'unmatchable-function'));
    expect(filtered).toContain('studio_string');
    expect(filtered).not.toContain('studio_step');
  });
});
