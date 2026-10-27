import type { SchemaBundle } from '../../core/schema/types';
import { isRecord } from '../../core/json';
/** Isolate schema document identities so Monaco never issues implicit network requests. */
export function makeMonacoSchemas(bundle: SchemaBundle, namespace: string) {
  function rewrite(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === '$ref' &&
        typeof child === 'string' &&
        !child.startsWith('#') &&
        !/^[a-z]+:/i.test(child)
          ? namespace + child
          : rewrite(child),
      ]),
    );
  }
  return Object.entries(bundle).map(([file, schema]) => ({
    uri: namespace + file,
    fileMatch:
      file === 'api.json' ? ['**/*.gcscript', '**/*.gcscript.json', '**/*.gcscript.jsonc'] : [],
    schema:
      typeof schema === 'boolean'
        ? schema
        : { ...(rewrite(schema) as object), $id: namespace + file },
  }));
}
