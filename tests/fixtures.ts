import { readFileSync } from 'node:fs';
import { parseBundle, extendSchemas } from '../src/core/schema/extensions';
import { getCatalog } from '../src/core/schema/catalog';
export const runtime = parseBundle(
  JSON.parse(readFileSync('tests/fixtures/runtime-schema.json', 'utf8')),
);
export const extras = parseBundle(JSON.parse(readFileSync('public/extras.json.full', 'utf8')));
export const authoring = extendSchemas(runtime, extras);
export const catalog = getCatalog(authoring, new Set(Object.keys(extras)));
