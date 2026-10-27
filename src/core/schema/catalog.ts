import { isRecord, isObject } from '../json.js';
import type { JsonValue } from '../json.js';
import type { Schema, SchemaBundle, Catalog, FunctionDefinition, ISLDefinition } from './types.js';
import { schemaObject } from './types.js';

/** Resolve document identities and JSON Pointers, including document-local references. */
export function resolveRef(
  bundle: SchemaBundle,
  ref: string,
  current = 'api.json',
): Schema | undefined {
  const [file, fragment = ''] = ref.split('#');
  const filename = file
    ? Object.keys(bundle).find((k) => k === file || schemaObject(bundle[k])?.$id === file)
    : current;
  let node: unknown = filename ? bundle[filename] : undefined;
  for (const part of decodeURIComponent(fragment).split('/').slice(1)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    node = Array.isArray(node) ? node[Number(key)] : isRecord(node) ? node[key] : undefined;
  }
  return typeof node === 'boolean' || isRecord(node) ? (node as Schema) : undefined;
}
export function expandSchema(
  bundle: SchemaBundle,
  schema: Schema | undefined,
  current = 'api.json',
  seen = new Set<string>(),
): Schema | undefined {
  const obj = schemaObject(schema);
  if (!obj?.$ref || seen.has(current + ':' + obj.$ref)) return schema;
  const resolved = resolveRef(bundle, obj.$ref, current);
  if (resolved === false) return false;
  if (resolved === true) return true;
  if (!resolved) return schema;
  const { $ref, ...rest } = obj;
  return expandSchema(
    bundle,
    { ...resolved, ...rest },
    $ref.split('#')[0] || current,
    new Set([...seen, current + ':' + $ref]),
  );
}
export function possibleTypes(
  bundle: SchemaBundle,
  schema: Schema | undefined,
  depth = 0,
): string[] {
  if (depth > 8) return ['any'];
  const expanded = expandSchema(bundle, schema);
  if (expanded === false) return ['void'];
  const obj = schemaObject(expanded);
  if (!obj) return ['any'];
  if ('const' in obj)
    return [obj.const === null ? 'null' : Array.isArray(obj.const) ? 'array' : typeof obj.const];
  if (obj.enum)
    return [
      ...new Set(
        obj.enum.map((value) =>
          value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
        ),
      ),
    ];
  if (obj.type) return Array.isArray(obj.type) ? obj.type : [obj.type];
  const branches = obj.anyOf ?? obj.oneOf ?? obj.allOf;
  return branches
    ? [...new Set(branches.flatMap((s) => possibleTypes(bundle, s, depth + 1)))]
    : ['any'];
}
export const signature = (bundle: SchemaBundle, schema: Schema | undefined): string =>
  possibleTypes(bundle, schema).join(' | ');

/** Only schema-discriminated functions are executable; descriptive helper documents are excluded. */
export function getCatalog(bundle: SchemaBundle, extensionFiles = new Set<string>()): Catalog {
  const functions: FunctionDefinition[] = [];
  for (const [file, node] of Object.entries(bundle)) {
    const schema = schemaObject(node);
    const name = schemaObject(schema?.properties?.type)?.const;
    if (!schema || typeof name !== 'string' || file === 'api.json') continue;
    if (!schema.definitions?.__api__ && !extensionFiles.has(file)) continue;
    functions.push({
      name,
      file,
      title: schema.title ?? name,
      description: schema.markdownDescription ?? schema.description ?? '',
      schema,
      props: schema.properties ?? {},
      required: schema.required ?? [],
      examples: schema.examples ?? [],
      returnSchema: expandSchema(
        bundle,
        schema.definitions?.return ?? schemaObject(bundle['returnTypes.json'])?.definitions?.[name],
        file,
      ),
      category: extensionFiles.has(file) ? 'extras' : 'gcscript',
    });
  }
  const isl: ISLDefinition[] = [];
  const visit = (node: Schema | undefined, group: string, extras: boolean): void => {
    const schema = schemaObject(node);
    if (!schema) return;
    if (schema.pattern && schema.title && schema.definitions?.arguments)
      isl.push({ name: schema.title, group, schema, category: extras ? 'extras' : 'isl' });
    for (const branch of schema.anyOf ?? []) visit(branch, schema.title ?? group, extras);
  };
  visit(bundle['lang.json'], 'ISL', false);
  for (const file of extensionFiles)
    if (file !== 'lang.json' && !schemaObject(bundle[file])?.properties?.type)
      visit(bundle[file], 'Extras', true);
  const uniqueISL = [...new Map(isl.map((entry) => [entry.name, entry])).values()];
  const byName = Object.fromEntries(functions.map((f) => [f.name, f]));
  const islByName = Object.fromEntries(uniqueISL.map((f) => [f.name, f]));
  Object.setPrototypeOf(byName, null);
  Object.setPrototypeOf(islByName, null);
  return { functions, byName, isl: uniqueISL, islByName };
}

/** Seed palette blocks from documented invocations, then required fields, without executing code. */
export function blankFunction(fn: FunctionDefinition, bundle: SchemaBundle): JsonValue {
  const sample = fn.examples.find((v) => isObject(v) && v.type === fn.name);
  if (sample) return structuredClone(sample);
  return Object.fromEntries([
    ['type', fn.name],
    ...fn.required
      .filter((k) => k !== 'type')
      .map((key) => {
        const schema = schemaObject(expandSchema(bundle, fn.props[key], fn.file));
        const type = possibleTypes(bundle, fn.props[key])[0];
        const value: JsonValue =
          schema?.const ??
          schema?.examples?.[0] ??
          (type === 'object'
            ? {}
            : type === 'array'
              ? []
              : type === 'number' || type === 'integer'
                ? 0
                : type === 'boolean'
                  ? false
                  : '');
        return [key, value];
      }),
  ]);
}
