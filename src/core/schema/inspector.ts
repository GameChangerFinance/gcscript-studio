import { getAt, isObject } from '../json.js';
import type { JsonPath, JsonValue } from '../json.js';
import type { Catalog, SchemaBundle, Schema } from './types.js';
import { schemaObject } from './types.js';
import { signature } from './catalog.js';
import { contextualSchema, functionAtPath, schemaAtPath } from './context.js';
export interface Inspection {
  title: string;
  kind: string;
  description: string;
  path: JsonPath;
  value: JsonValue | undefined;
  valueType: string;
  schema: Schema | undefined;
  returnSchema: Schema | undefined;
  returnType: string;
  examples: JsonValue[];
  functionName?: string;
  file?: string;
}
/** Reusable inspector content for code, nodes, blocks and alternate shells. */
export function inspectValue(
  document: JsonValue,
  bundle: SchemaBundle,
  catalog: Catalog,
  path: JsonPath,
  islName?: string,
): Inspection {
  const value = getAt(document, path),
    context = schemaAtPath(document, bundle, path);
  const fn = functionAtPath(document, bundle, catalog, path);
  const isl = islName ? catalog.islByName[islName] : undefined;
  const schema =
    isl?.schema ??
    (fn && path.length ? fn.schema : contextualSchema(bundle, context, value)) ??
    fn?.schema;
  const returns = isl?.schema.definitions?.return ?? fn?.returnSchema;
  return {
    title: isl
      ? isl.name + '()'
      : fn
        ? (schema?.title ?? fn.title)
        : String(path.at(-1) ?? 'Document root'),
    kind: isl
      ? 'ISL function'
      : fn?.category === 'extras'
        ? 'Build-stage directive'
        : fn
          ? 'GCScript DSL'
          : isObject(value)
            ? 'JSON object'
            : Array.isArray(value)
              ? 'JSON array'
              : 'JSON value',
    description: schema?.markdownDescription ?? schema?.description ?? '',
    path,
    value,
    valueType: signature(bundle, context?.schema),
    schema: schema ?? context?.schema,
    returnSchema: returns,
    returnType: returns === undefined ? 'Not specified in schema' : signature(bundle, returns),
    examples: schema?.examples ?? [],
    ...(fn ? { functionName: fn.name, file: fn.file } : {}),
  };
}
export interface TypeTree {
  label: string;
  description: string;
  children: TypeTree[];
  reference?: string;
}
/** Display budgets never alter the schema registry used for validation. */
export function describeSchema(
  bundle: SchemaBundle,
  schema: Schema | undefined,
  limits: { depth: number; nodes: number; chars: number },
): TypeTree {
  let count = 0,
    chars = 0;
  const seen = new Set<Schema>();
  function visit(node: Schema | undefined, label: string, depth: number): TypeTree {
    const obj = schemaObject(node);
    if (++count > limits.nodes || depth > limits.depth || chars > limits.chars)
      return { label, description: 'Open the reference for additional structure.', children: [] };
    if (node !== undefined && seen.has(node))
      return { label, description: 'Shared or recursive definition', children: [] };
    if (node !== undefined) seen.add(node);
    if (obj?.$ref)
      return { label, description: signature(bundle, node), reference: obj.$ref, children: [] };
    const description = (
      obj?.markdownDescription ??
      obj?.description ??
      signature(bundle, node)
    ).slice(0, Math.max(0, limits.chars - chars));
    chars += description.length;
    const children: TypeTree[] = [];
    for (const [key, child] of Object.entries(obj?.properties ?? {})) {
      if (count >= limits.nodes) break;
      children.push(
        visit(child, key + (obj?.required?.includes(key) ? ' · required' : ''), depth + 1),
      );
    }
    for (const group of ['oneOf', 'anyOf', 'allOf'] as const)
      for (const [i, child] of (obj?.[group] ?? []).entries()) {
        if (count >= limits.nodes) break;
        children.push(visit(child, group + ' ' + (i + 1), depth + 1));
      }
    if (obj?.items && count < limits.nodes) {
      if (Array.isArray(obj.items))
        obj.items.forEach((child, i) => {
          if (count < limits.nodes) children.push(visit(child, 'item ' + i, depth + 1));
        });
      else children.push(visit(obj.items, 'items', depth + 1));
    }
    return { label, description, children };
  }
  return visit(schema, 'Type: ' + signature(bundle, schema), 0);
}
