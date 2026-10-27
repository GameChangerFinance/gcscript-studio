import type { JsonValue } from '../json.js';
import type { LanguageCategory } from '../../config.js';
/** JSON Schema is open to vocabulary extensions; only consumed keywords are given contracts here. */
export type Schema = boolean | SchemaObject;
export interface SchemaObject {
  [keyword: string]: unknown;
  $id?: string;
  $ref?: string;
  $schema?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  markdownDescription?: string;
  const?: JsonValue;
  enum?: JsonValue[];
  examples?: JsonValue[];
  properties?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
  required?: string[];
  patternProperties?: Record<string, Schema>;
  additionalProperties?: Schema;
  additionalItems?: Schema;
  items?: Schema | Schema[];
  prefixItems?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}
export type SchemaBundle = Record<string, Schema>;
export interface FunctionDefinition {
  name: string;
  file: string;
  title: string;
  description: string;
  schema: SchemaObject;
  props: Record<string, Schema>;
  required: string[];
  examples: JsonValue[];
  returnSchema: Schema | undefined;
  category: LanguageCategory;
}
export interface ISLDefinition {
  name: string;
  group: string;
  schema: SchemaObject;
  category: 'isl' | 'extras';
}
export interface Catalog {
  functions: FunctionDefinition[];
  byName: Record<string, FunctionDefinition>;
  isl: ISLDefinition[];
  islByName: Record<string, ISLDefinition>;
}
export interface SchemaSnapshot {
  runtime: SchemaBundle;
  authoring: SchemaBundle;
  catalog: Catalog;
  source: string;
  warning?: string;
}
export const schemaObject = (schema: Schema | undefined): SchemaObject | undefined =>
  typeof schema === 'object' && schema !== null ? schema : undefined;
