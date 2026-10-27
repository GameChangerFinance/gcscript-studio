import type { JsonPath, JsonValue } from '../json.js';
import { getAt, isObject } from '../json.js';
import type { Catalog, FunctionDefinition, SchemaBundle } from '../schema/types.js';
import { functionAtPath, schemaAtPath, supportsISL } from '../schema/context.js';
import { isExpression } from './isl.js';
export interface StructureRow {
  path: JsonPath;
  name: string;
  position: number;
  value: JsonValue;
  fn: FunctionDefinition | undefined;
  collections: JsonPath[];
  expressions: { path: JsonPath; value: string }[];
}
export interface ScopeDescription {
  path: JsonPath;
  title: string;
  rows: StructureRow[];
  type: 'object' | 'array';
}
export function childCollections(value: JsonValue | undefined, path: JsonPath): JsonPath[] {
  return value && typeof value === 'object'
    ? Object.entries(value)
        .filter(([, child]) => child && typeof child === 'object')
        .map(([key]) => [...path, Array.isArray(value) ? Number(key) : key])
    : [];
}
export function describeScope(
  document: JsonValue,
  path: JsonPath,
  bundle: SchemaBundle,
  catalog: Catalog,
): ScopeDescription {
  const value = getAt(document, path);
  if (!value || typeof value !== 'object') throw Error('Scope must be a JSON collection');
  const scan = (
    value: JsonValue,
    location: JsonPath,
    output: StructureRow['expressions'],
    depth: number,
  ): void => {
    if (depth > 30 || output.length >= 48) return;
    if (isExpression(value) && supportsISL(bundle, schemaAtPath(document, bundle, location)))
      output.push({ path: location, value });
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value))
        scan(child, [...location, Array.isArray(value) ? Number(key) : key], output, depth + 1);
  };
  return {
    path,
    title: path.length ? String(path.at(-1)) : 'Document root',
    type: Array.isArray(value) ? 'array' : 'object',
    rows: Object.entries(value).map(([key, child], i) => {
      const childPath = [...path, Array.isArray(value) ? Number(key) : key],
        expressions: StructureRow['expressions'] = [];
      scan(child, childPath, expressions, 0);
      return {
        path: childPath,
        name: key,
        position: i + 1,
        value: child,
        fn: functionAtPath(document, bundle, catalog, childPath),
        collections: childCollections(child, childPath),
        expressions,
      };
    }),
  };
}
/** Reorder by insertion order; object keys and every scalar retain their exact meaning. */
export function reorderValue(document: JsonValue, path: JsonPath, delta: number): JsonValue {
  if (!path.length) throw Error('Cannot reorder the document root');
  const parentPath = path.slice(0, -1),
    key = path.at(-1),
    value = getAt(document, parentPath);
  if (!value || typeof value !== 'object') throw Error('No parent collection');
  const entries = Object.entries(value),
    index = entries.findIndex(([name]) => name === String(key)),
    target = index + delta;
  if (index < 0 || target < 0 || target >= entries.length) return document;
  const entry = entries[index];
  if (!entry) return document;
  entries.splice(index, 1);
  entries.splice(target, 0, entry);
  const replacement: JsonValue = Array.isArray(value)
    ? entries.map(([, child]) => child)
    : Object.fromEntries(entries);
  const next = structuredClone(document);
  if (!parentPath.length) return replacement;
  const owner = getAt(next, parentPath.slice(0, -1)),
    last = parentPath.at(-1);
  if (Array.isArray(owner) && typeof last === 'number') owner[last] = replacement;
  else if (isObject(owner) && last !== undefined)
    Object.defineProperty(owner, last, {
      value: replacement,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return next;
}
