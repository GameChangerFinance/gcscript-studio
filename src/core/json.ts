import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  getLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonPath = (string | number)[];
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isObject = (value: JsonValue | undefined): value is JsonObject => isRecord(value);
export const isJsonValue = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value)
    ? value.every(isJsonValue)
    : isRecord(value) && Object.values(value).every(isJsonValue));

/** Parse JSONC without silently accepting syntax errors or non-JSON results. */
export function parseJSONC(text: string): JsonValue {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors[0])
    throw Error(`JSONC: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
  if (!isJsonValue(value)) throw Error('Expected a JSON value');
  return value;
}
export function getAt(value: JsonValue, path: JsonPath): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of path)
    current = Array.isArray(current)
      ? current[Number(key)]
      : isObject(current)
        ? Object.hasOwn(current, String(key))
          ? current[String(key)]
          : undefined
        : undefined;
  return current;
}
/** Modify a single path, retaining neighboring comments and formatting. undefined removes the path. */
export function patchJSONC(text: string, path: JsonPath, value: JsonValue | undefined): string {
  return applyEdits(
    text,
    modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }),
  );
}
export const sourcePathAt = (text: string, offset: number): JsonPath =>
  getLocation(text, offset).path;
export function sourceRange(
  text: string,
  path: JsonPath,
): { offset: number; length: number } | null {
  const tree = parseTree(text);
  const node = tree && findNodeAtLocation(tree, path);
  return node ? { offset: node.offset, length: node.length } : null;
}
export interface ValueChange {
  path: JsonPath;
  value: JsonValue;
  structural: boolean;
}
export function collectChangedLeaves(
  before: JsonValue,
  after: JsonValue,
  path: JsonPath = [],
): ValueChange[] {
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length)
    return after.flatMap((value, i) =>
      collectChangedLeaves(before[i] ?? null, value, [...path, i]),
    );
  if (
    isObject(before) &&
    isObject(after) &&
    JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after))
  )
    return Object.entries(after).flatMap(([key, value]) =>
      collectChangedLeaves(before[key] ?? null, value, [...path, key]),
    );
  return JSON.stringify(before) === JSON.stringify(after)
    ? []
    : [{ path, value: after, structural: typeof before === 'object' || typeof after === 'object' }];
}
/** Block edits preserve scalar comments; structural edits explicitly request normalization approval. */
export function updateSource(
  text: string,
  next: JsonValue,
  approveNormalization: () => boolean,
): string {
  const changes = collectChangedLeaves(parseJSONC(text), next);
  if (!changes.length) return text;
  if (changes.length < 100 && changes.every((c) => !c.structural && c.path.length))
    return changes.reduce((source, change) => patchJSONC(source, change.path, change.value), text);
  if (hasComments(text) && !approveNormalization())
    throw Error('Edit cancelled to preserve JSONC comments');
  return JSON.stringify(next, null, 2) + '\n';
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Lexical comment detection avoids mistaking URLs or string contents for comments. */
export function hasComments(text: string): boolean {
  // jsonc-parser exposes these SyntaxKind values as ambient const enums, unavailable
  // to Vite isolated compilation. Keep the documented token codes local to this adapter.
  const tokenKind = { endOfFile: 17, lineComment: 12, blockComment: 13 } as const;
  const scanner = createScanner(text);
  for (let token = scanner.scan(); token !== tokenKind.endOfFile; token = scanner.scan())
    if (token === tokenKind.lineComment || token === tokenKind.blockComment) return true;
  return false;
}
