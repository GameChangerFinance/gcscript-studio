import { isRecord } from '../json.js';
import { schemaObject } from './types.js';
import type { Schema, SchemaBundle } from './types.js';

/** Validate schema bundles at the loading boundary; reject malformed document maps. */
export function parseBundle(value: unknown): SchemaBundle {
  if (!isRecord(value)) throw Error('Expected a JSON Schema or a schema-document bundle');
  if ('$schema' in value || 'properties' in value || 'type' in value) return { 'api.json': value };
  if (
    !Object.keys(value).length ||
    !Object.entries(value).every(
      ([key, doc]) => key.endsWith('.json') && (typeof doc === 'boolean' || isRecord(doc)),
    )
  )
    throw Error('Expected a schema-document bundle');
  return value as SchemaBundle;
}

/** Non-mutating virtual overlay. Wallet validation always retains the original bundle. */
export function extendSchemas(runtime: SchemaBundle, extras: SchemaBundle): SchemaBundle {
  for (const file of Object.keys(extras))
    if (file in runtime) throw Error(`Extension document conflicts with wallet schema: ${file}`);
  const authoring = structuredClone(runtime);
  Object.assign(authoring, structuredClone(extras));
  const calls = Object.entries(extras)
    .filter(
      ([, doc]) => typeof schemaObject(schemaObject(doc)?.properties?.type)?.const === 'string',
    )
    .map(([file]) => ({ $ref: file }));
  // Published runtime collections reference function documents directly. Extend every
  // such union; never relax an argument to arbitrary JSON just to accept a directive.
  const visit = (node: Schema): void => {
    const obj = schemaObject(node);
    if (!obj) return;
    for (const key of ['anyOf', 'oneOf'] as const) {
      const list = obj[key];
      if (
        list?.some((branch) => {
          const ref = schemaObject(branch)?.$ref;
          return (
            ref &&
            schemaObject(schemaObject(runtime[ref.split('#')[0] ?? ''])?.properties?.type)
              ?.const !== undefined
          );
        })
      )
        list.push(...structuredClone(calls));
    }
    for (const child of Object.values(obj)) {
      if (Array.isArray(child))
        for (const value of child) {
          if (isRecord(value)) visit(value);
        }
      else if (isRecord(child)) visit(child);
    }
  };
  for (const node of Object.values(authoring)) visit(node);
  // ISL augmentation uses the language's own declaration union and contracts.
  const lang = schemaObject(authoring['lang.json']);
  for (const [file, doc] of Object.entries(extras)) {
    if (calls.some((call) => call.$ref === file)) continue;
    const extra = schemaObject(doc);
    if (lang && extra?.anyOf) lang.anyOf = [...(lang.anyOf ?? []), ...structuredClone(extra.anyOf)];
  }
  const rootExtensions = Object.entries(extras).filter(
    ([, doc]) => schemaObject(doc)?.['x-studio-root'] === true,
  );
  const root = schemaObject(authoring['api.json']);
  if (root && rootExtensions.length) {
    const { $id, ...original } = root;
    authoring['api.json'] = {
      ...($id ? { $id } : {}),
      anyOf: [original, ...rootExtensions.map(([file]) => ({ $ref: file }))],
    };
  }
  return authoring;
}
