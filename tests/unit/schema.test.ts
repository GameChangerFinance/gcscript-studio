import { describe, expect, it } from 'vitest';
import { authoring, catalog, extras, runtime } from '../fixtures';
import {
  blankFunction,
  expandSchema,
  getCatalog,
  possibleTypes,
  resolveRef,
  signature,
} from '../../src/core/schema/catalog';
import { extendSchemas, parseBundle } from '../../src/core/schema/extensions';
import {
  declaredProperties,
  functionAtPath,
  schemaAtPath,
  schemaCandidates,
  supportsISL,
} from '../../src/core/schema/context';
import { describeSchema, inspectValue } from '../../src/core/schema/inspector';
import { highlightSource } from '../../src/core/language/highlight';
import { DEFAULT_CONFIG } from '../../src/config';
import { parseJSONC } from '../../src/core/json';
import { schemaObject } from '../../src/core/schema/types';
import type { SchemaBundle, SchemaObject } from '../../src/core/schema/types';
const program = {
  type: 'script',
  run: {
    imported: {
      type: '$importAsScript',
      from: { child: 'app:///lib/child.gcscript' },
      args: "{get('args')}",
    },
    config: { type: '$importAsData', as: 'object', from: { config: 'app:///config.json' } },
    nested: {
      type: 'script',
      run: {
        evaluate: { type: 'macro', run: "{get('args.test')}" },
        literal: { type: 'data', value: { type: 'script', run: '{get(42)}' } },
      },
    },
  },
};
describe('official schemas and virtual extensions', () => {
  it('catalogs executable schema functions and build-stage origins', () => {
    expect(catalog.byName.script?.category).toBe('gcscript');
    expect(catalog.byName.$importAsScript?.category).toBe('extras');
    expect(catalog.byName.$importAsData?.props.from).toBeDefined();
    expect(catalog.islByName.get?.schema.definitions?.arguments).toBeDefined();
    expect(
      catalog.functions.every(
        (fn) => !['Flow', 'Transactions', 'Keys & scripts'].includes(fn.category),
      ),
    ).toBe(true);
  });
  it('does not mutate the wallet bundle, extends nested collections and preserves restrictions', () => {
    expect(Object.keys(runtime)).not.toContain('$importAsScript.json');
    expect(runtime['script.json']).not.toEqual(authoring['script.json']);
    expect(functionAtPath(program, authoring, catalog, ['run', 'imported'])?.name).toBe(
      '$importAsScript',
    );
    expect(
      functionAtPath(program, authoring, catalog, ['run', 'nested', 'run', 'evaluate'])?.name,
    ).toBe('macro');
    expect(schemaObject(authoring['$importAsData.json'])?.additionalProperties).toBe(false);
    expect(() => extendSchemas(runtime, { 'api.json': {} })).toThrow('conflicts');
  });
  it('does not promote literal data with a type property into executable syntax', () => {
    const literal = ['run', 'nested', 'run', 'literal', 'value'];
    expect(functionAtPath(program, authoring, catalog, literal)).toBeUndefined();
    expect(supportsISL(authoring, schemaAtPath(program, authoring, [...literal, 'run']))).toBe(
      false,
    );
  });
  it('resolves ISL only in declared schema-supported fields', () => {
    expect(
      supportsISL(
        authoring,
        schemaAtPath(program, authoring, ['run', 'nested', 'run', 'evaluate', 'run']),
      ),
    ).toBe(true);
    expect(
      supportsISL(authoring, schemaAtPath(program, authoring, ['run', 'imported', 'args'])),
    ).toBe(true);
    expect(supportsISL(authoring, undefined)).toBe(false);
    expect(schemaAtPath(program, authoring, ['missing', 'field'])).toBeUndefined();
  });
  it('keeps user keys contextual even when named like language properties', () => {
    const props = declaredProperties(
      authoring,
      schemaAtPath(program, authoring, ['run']),
      program.run,
    );
    expect(props).not.toHaveProperty('nested');
    expect(
      declaredProperties(authoring, schemaAtPath(program, authoring, []), program),
    ).toHaveProperty('type');
  });
  it('retains evaluated argument scope inside arbitrary JSON maps and arrays, never literal data', () => {
    const metadata = { '674': { msg: ["{strToMetadataStr(get('args.message'))}"] } };
    const doc = {
      type: 'script',
      run: {
        build: { type: 'buildTx', tx: { auxiliaryData: metadata } },
        macro: { type: 'macro', run: metadata },
        literal: { type: 'data', value: metadata },
      },
    };
    const suffix = ['674', 'msg', 0];
    for (const path of [
      ['run', 'build', 'tx', 'auxiliaryData', ...suffix],
      ['run', 'macro', 'run', ...suffix],
    ])
      expect(supportsISL(authoring, schemaAtPath(doc, authoring, path))).toBe(true);
    expect(
      supportsISL(authoring, schemaAtPath(doc, authoring, ['run', 'literal', 'value', ...suffix])),
    ).toBe(false);
    const text = JSON.stringify(doc);
    const calls = highlightSource(text, authoring, catalog, DEFAULT_CONFIG)
      .filter((mark) => mark.category === 'isl')
      .map((mark) => text.slice(mark.offset, mark.offset + mark.length));
    expect(calls).toEqual(['strToMetadataStr', 'get', 'strToMetadataStr', 'get']);
    expect(
      schemaAtPath(doc, authoring, ['run', 'build', 'auxiliaryData', ...suffix]),
    ).toBeUndefined();
  });
  it('accepts data-only alternate schemas and rejects malformed maps', () => {
    expect(parseBundle({ type: 'object' })).toEqual({ 'api.json': { type: 'object' } });
    expect(() => parseBundle([])).toThrow();
    expect(() => parseBundle({ 'bad.txt': {} })).toThrow();
    expect(() => parseBundle({ 'x.json': 1 })).toThrow();
    expect(parseBundle({ 'x.json': false })).toEqual({ 'x.json': false });
  });
  it('supports document-local pointers, escaped paths and boolean contracts', () => {
    const bundle: SchemaBundle = {
      'api.json': {
        definitions: { 'a/b': { type: 'string' }, local: { $ref: '#/definitions/a~1b' } },
      },
      'void.json': false,
      'identity.json': { $id: 'https://schema.test/identity', type: 'number' },
    };
    expect(resolveRef(bundle, '#/definitions/a~1b')).toEqual({ type: 'string' });
    expect(expandSchema(bundle, { $ref: '#/definitions/local' })).toEqual({ type: 'string' });
    expect(resolveRef(bundle, 'https://schema.test/identity')).toEqual(bundle['identity.json']);
    expect(resolveRef(bundle, 'none')).toBeUndefined();
    expect(expandSchema(bundle, { $ref: 'void.json' })).toBe(false);
    expect(expandSchema(bundle, { $ref: 'missing' })).toEqual({ $ref: 'missing' });
    expect(signature(bundle, false)).toBe('void');
    expect(possibleTypes(bundle, { const: null })).toEqual(['null']);
    expect(possibleTypes(bundle, { anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([
      'string',
      'number',
    ]);
  });
  it('bounds recursive reference and composition traversal', () => {
    const loop: SchemaBundle = {
      'api.json': { $ref: 'loop.json' },
      'loop.json': { $ref: 'api.json' },
    };
    expect(expandSchema(loop, loop['api.json'])).toBeDefined();
    expect(
      schemaCandidates(loop, { schema: loop['api.json'] ?? true, file: 'api.json' }, {}),
    ).toEqual([]);
    expect(supportsISL(loop, { schema: loop['api.json'] ?? true, file: 'api.json' })).toBe(false);
  });
  it('creates function seeds from examples and required defaults', () => {
    const fn = catalog.byName.$importAsData;
    if (!fn) throw Error('missing');
    expect(blankFunction(fn, authoring)).toMatchObject({ type: '$importAsData', as: 'object' });
    const custom = {
      ...fn,
      name: 'custom',
      examples: [],
      required: ['type', 'list', 'flag', 'number', 'obj', 'text'],
      props: {
        type: { const: 'custom' },
        list: { type: 'array' },
        flag: { type: 'boolean' },
        number: { type: 'number' },
        obj: { type: 'object' },
        text: { type: 'string' },
      },
    };
    expect(blankFunction(custom, authoring)).toEqual({
      type: 'custom',
      list: [],
      flag: false,
      number: 0,
      obj: {},
      text: '',
    });
  });
  it('allows extras to add structured ISL declarations without overwriting runtime documents', () => {
    const extension = {
      ...extras,
      'extra-lang.json': {
        title: 'Build ISL',
        anyOf: [
          {
            title: '$test',
            pattern: '\\$test\\(.*\\)',
            definitions: { arguments: { minItems: 1, maxItems: 1 }, return: { type: 'string' } },
          },
        ],
      },
    };
    const augmented = extendSchemas(runtime, extension);
    const result = getCatalog(augmented, new Set(Object.keys(extension)));
    expect(result.islByName.$test?.category).toBe('extras');
    expect(schemaObject(augmented['lang.json'])?.anyOf?.length).toBeGreaterThan(
      schemaObject(runtime['lang.json'])?.anyOf?.length ?? 0,
    );
  });
});
describe('shared inspector and syntax model', () => {
  it('shows extension arguments and ISL return contracts', () => {
    expect(inspectValue(program, authoring, catalog, ['run', 'config'])).toMatchObject({
      kind: 'Build-stage directive',
      functionName: '$importAsData',
    });
    const info = inspectValue(
      program,
      authoring,
      catalog,
      ['run', 'nested', 'run', 'evaluate', 'run'],
      'get',
    );
    expect(info.kind).toBe('ISL function');
    expect(info.returnSchema).toBeDefined();
    expect(inspectValue(program, authoring, catalog, [])).toMatchObject({ kind: 'GCScript DSL' });
  });
  it('bounds documentation trees and handles recursive or false return contracts', () => {
    expect(describeSchema({}, false, { depth: 8, nodes: 100, chars: 1000 }).label).toBe(
      'Type: void',
    );
    const node = { properties: { a: { type: 'string' }, b: { type: 'number' } } };
    expect(describeSchema({}, node, { depth: 1, nodes: 1, chars: 10 }).children).toHaveLength(0);
    expect(
      describeSchema(runtime, { $ref: 'api.json' }, { depth: 8, nodes: 100, chars: 1000 })
        .reference,
    ).toBe('api.json');
    const recursive: SchemaObject = {};
    recursive.properties = { self: recursive };
    expect(
      JSON.stringify(describeSchema({}, recursive, { depth: 2, nodes: 5, chars: 1000 })),
    ).toContain('recursive');
  });
  it('uses one palette for script/imports, extras, ISL and user-defined map keys', () => {
    const text = JSON.stringify(program, null, 2),
      marks = highlightSource(text, authoring, catalog, DEFAULT_CONFIG);
    const marked = (word: string, category: string) =>
      marks.find(
        (mark) =>
          text.slice(mark.offset, mark.offset + mark.length) === word && mark.category === category,
      );
    expect(marked('script', 'gcscript')?.color).toBe(DEFAULT_CONFIG.colors.functions.script);
    expect(marked('$importAsScript', 'extras')?.color).toBe(
      DEFAULT_CONFIG.colors.functions.$importAsScript,
    );
    expect(marked('get', 'isl')?.color).toBe(DEFAULT_CONFIG.colors.categories.isl);
    expect(marked('imported', 'user-defined')).toBeDefined();
    expect(
      marks.filter((mark) => text.slice(mark.offset, mark.offset + mark.length) === 'get'),
    ).toHaveLength(2);
  });
  it('does not highlight function-like text or calls inside literal data', () => {
    const doc = {
      type: 'script',
      run: { a: { type: 'data', value: '{get(1)}' }, b: { type: 'macro', run: "{get('get(5)')}" } },
    };
    const text = JSON.stringify(doc),
      marks = highlightSource(text, authoring, catalog, DEFAULT_CONFIG);
    expect(marks.filter((mark) => mark.category === 'isl')).toHaveLength(1);
    expect(highlightSource('bad', authoring, catalog, DEFAULT_CONFIG)).toEqual([]);
    expect(
      highlightSource(text, authoring, catalog, {
        ...DEFAULT_CONFIG,
        limits: { ...DEFAULT_CONFIG.limits, syntaxCharacters: 1 },
      }),
    ).toEqual([]);
    expect(parseJSONC(text)).toEqual(doc);
  });
});
