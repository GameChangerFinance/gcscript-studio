import { getNodeValue, parseTree } from 'jsonc-parser';
import type { Node } from 'jsonc-parser';
import type { StudioConfig, LanguageCategory } from '../../config.js';
import { languageColor } from '../../config.js';
import type { JsonPath, JsonValue } from '../json.js';
import { isJsonValue } from '../json.js';
import type { Catalog, SchemaBundle } from '../schema/types.js';
import {
  declaredProperties,
  functionAtPath,
  schemaAtPath,
  supportsISL,
} from '../schema/context.js';
import { isExpression, islSourceTokens } from './isl.js';
export interface SyntaxMark {
  offset: number;
  length: number;
  category: LanguageCategory | 'key' | 'symbol';
  color: string;
}

/** Bounded AST traversal shared by every syntax consumer; no DOM or editor dependency. */
export function highlightSource(
  text: string,
  bundle: SchemaBundle,
  catalog: Catalog,
  config: StudioConfig,
): SyntaxMark[] {
  if (text.length > config.limits.syntaxCharacters) return [];
  const ast = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  if (!ast) return [];
  const value: unknown = getNodeValue(ast);
  if (!isJsonValue(value)) return [];
  const document: JsonValue = value;
  const stack: { node: Node; path: JsonPath }[] = [{ node: ast, path: [] }];
  const marks: SyntaxMark[] = [];
  let count = 0;
  const mark = (offset: number, length: number, category: SyntaxMark['category'], name = '') => {
    if (length > 0 && marks.length < config.limits.decorations)
      marks.push({
        offset,
        length,
        category,
        color:
          category === 'key'
            ? config.colors.key
            : category === 'symbol'
              ? config.colors.symbol
              : languageColor(config, name, category),
      });
  };
  while (stack.length && count++ < config.limits.syntaxNodes) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, path } = frame;
    if (node.type === 'property') {
      const key = node.children?.[0],
        child = node.children?.[1];
      if (key?.type !== 'string' || typeof key.value !== 'string' || !child) continue;
      const fn = functionAtPath(document, bundle, catalog, path);
      const properties = declaredProperties(
        bundle,
        schemaAtPath(document, bundle, path),
        getNodeValue(node.parent ?? ast) as JsonValue,
      );
      mark(
        key.offset + 1,
        key.length - 2,
        Object.hasOwn(properties, key.value) ? 'key' : 'user-defined',
      );
      if (key.value === 'type' && fn && child.type === 'string')
        mark(child.offset + 1, child.length - 2, fn.category, fn.name);
      stack.push({ node: child, path: [...path, key.value] });
    } else {
      for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) {
        const child = node.children?.[i];
        if (child) stack.push({ node: child, path: node.type === 'array' ? [...path, i] : path });
      }
      if (node.type === 'string' && typeof node.value === 'string') {
        if (isExpression(node.value) && supportsISL(bundle, schemaAtPath(document, bundle, path))) {
          const raw = text.slice(node.offset, node.offset + node.length);
          const open = raw.indexOf('{'),
            close = raw.lastIndexOf('}');
          mark(node.offset + open, 1, 'symbol');
          mark(node.offset + close, 1, 'symbol');
          for (const token of islSourceTokens(raw)) {
            if (token.kind === 'call' && catalog.islByName[token.text])
              mark(node.offset + token.offset, token.length, 'isl', token.text);
            else if (token.kind === 'symbol')
              mark(node.offset + token.offset, token.length, 'symbol');
          }
        }
      } else if (['number', 'boolean', 'null'].includes(node.type))
        mark(node.offset, node.length, 'json');
    }
  }
  return marks;
}
