import { getAt, isObject } from '../json.js';
import type { JsonPath, JsonValue } from '../json.js';
import type { Catalog, Schema, SchemaBundle, SchemaObject } from './types.js';
import { schemaObject } from './types.js';
import { resolveRef } from './catalog.js';
export interface SchemaContext {
  schema: Schema;
  file: string;
  /** Unrestricted JSON descendants of an explicitly evaluated argument retain its ISL scope. */
  nestedISL?: boolean;
}

function unrestricted(schema: Schema): boolean {
  return (
    schema === true ||
    (typeof schema === 'object' &&
      Object.keys(schema).every((key) =>
        ['title', 'description', 'markdownDescription', 'examples', 'default', '$comment'].includes(
          key,
        ),
      ))
  );
}

/** Follow composition and references at the actual value, retaining local-reference identity. */
export function schemaCandidates(
  bundle: SchemaBundle,
  context: SchemaContext,
  value: JsonValue | undefined,
  seen = new Set<Schema>(),
  depth = 0,
): SchemaContext[] {
  const obj = schemaObject(context.schema);
  if (!obj || depth > 24 || seen.has(obj)) return [];
  const visited = new Set([...seen, obj]);
  if (obj.$ref) {
    const schema = resolveRef(bundle, obj.$ref, context.file);
    if (schema !== undefined)
      return schemaCandidates(
        bundle,
        { schema, file: obj.$ref.split('#')[0] || context.file },
        value,
        visited,
        depth + 1,
      );
  }
  const discriminator = isObject(value) ? value.type : undefined;
  const expected = schemaObject(obj.properties?.type)?.const;
  if (typeof discriminator === 'string' && expected !== undefined && expected !== discriminator)
    return [];
  return [
    context,
    ...[...(obj.allOf ?? []), ...(obj.oneOf ?? []), ...(obj.anyOf ?? [])].flatMap((schema) =>
      schemaCandidates(bundle, { schema, file: context.file }, value, visited, depth + 1),
    ),
  ];
}

/** No nearest-object heuristic: literal data containing a `type` key remains literal data. */
export function schemaAtPath(
  document: JsonValue,
  bundle: SchemaBundle,
  path: JsonPath,
): SchemaContext | undefined {
  let context: SchemaContext = { schema: bundle['api.json'] ?? true, file: 'api.json' };
  for (let i = 0; i < path.length; i++) {
    const part = path[i];
    if (part === undefined) return undefined;
    const value = getAt(document, path.slice(0, i));
    const candidates = schemaCandidates(bundle, context, value);
    let next: SchemaContext | undefined;
    if (unrestricted(context.schema))
      next = { schema: true, file: context.file, nestedISL: supportsISL(bundle, context) };
    for (const candidate of candidates) {
      const schema = schemaObject(candidate.schema);
      if (!schema) continue;
      let child: Schema | undefined = schema.properties?.[String(part)];
      if (Array.isArray(value) && typeof part === 'number')
        child =
          schema.prefixItems?.[part] ??
          (Array.isArray(schema.items) ? schema.items[part] : schema.items);
      if (child === undefined)
        for (const [pattern, match] of Object.entries(schema.patternProperties ?? {})) {
          try {
            if (new RegExp(pattern).test(String(part))) {
              child = match;
              break;
            }
          } catch {
            /* An invalid external pattern is not a match. */
          }
        }
      if (!Array.isArray(value)) child ??= schema.additionalProperties;
      // JSON Schema permits arbitrary children when an unconstrained branch is selected.
      if (child === undefined && unrestricted(candidate.schema)) child = true;
      if (child !== undefined) {
        next = {
          schema: child,
          file: candidate.file,
          nestedISL: unrestricted(child) && supportsISL(bundle, context),
        };
        break;
      }
    }
    if (!next) return undefined;
    context = next;
  }
  return context;
}
export function functionAtPath(
  document: JsonValue,
  bundle: SchemaBundle,
  catalog: Catalog,
  path: JsonPath,
) {
  const value = getAt(document, path);
  if (!isObject(value) || typeof value.type !== 'string') return undefined;
  const fn = catalog.byName[value.type];
  const context = schemaAtPath(document, bundle, path);
  return fn &&
    context &&
    schemaCandidates(bundle, context, value).some(
      (candidate) =>
        schemaObject(schemaObject(candidate.schema)?.properties?.type)?.const === value.type,
    )
    ? fn
    : undefined;
}
/** Recognize inline evaluation only when the argument's schema explicitly reaches lang.json. */
export function supportsISL(bundle: SchemaBundle, context: SchemaContext | undefined): boolean {
  if (context?.nestedISL) return true;
  const seen = new Set<Schema>();
  function visit(node: Schema, file: string, depth: number): boolean {
    const schema = schemaObject(node);
    if (!schema || seen.has(node) || depth > 32) return false;
    seen.add(node);
    if (schema.$ref) {
      const target = schema.$ref.split('#')[0] || file;
      if (target === 'lang.json') return true;
      const resolved = resolveRef(bundle, schema.$ref, file);
      if (resolved !== undefined && visit(resolved, target, depth + 1)) return true;
    }
    return [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])].some(
      (child) => visit(child, file, depth + 1),
    );
  }
  return context ? visit(context.schema, context.file, 0) : false;
}
export function declaredProperties(
  bundle: SchemaBundle,
  context: SchemaContext | undefined,
  value: JsonValue | undefined,
): Record<string, Schema> {
  return Object.assign(
    {},
    ...(context
      ? schemaCandidates(bundle, context, value).map(
          (candidate) => schemaObject(candidate.schema)?.properties ?? {},
        )
      : []),
  ) as Record<string, Schema>;
}
export function contextualSchema(
  bundle: SchemaBundle,
  context: SchemaContext | undefined,
  value: JsonValue | undefined,
): SchemaObject | undefined {
  if (!context) return undefined;
  return schemaCandidates(bundle, context, value)
    .map((candidate) => schemaObject(candidate.schema))
    .find((schema) => schema && (schema.properties || schema.description || schema.type));
}
