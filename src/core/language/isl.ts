import type { JsonValue } from '../json.js';
import type { Catalog } from '../schema/types.js';
import { schemaObject } from '../schema/types.js';
export type ISLNode =
  | { kind: 'call'; name: string; args: ISLNode[] }
  | { kind: 'literal'; raw: string; value: JsonValue | undefined };
export const isExpression = (value: unknown): value is string =>
  typeof value === 'string' && /^\s*\{[\s\S]*\}\s*$/.test(value);
/** ISL arity comes from structured argument contracts, never prose signatures. */
export function islArity(catalog: Catalog, name: string): { min: number; max: number } {
  const args = schemaObject(catalog.islByName[name]?.schema.definitions?.arguments);
  return {
    min: args?.minItems ?? 0,
    max:
      args?.maxItems ??
      (Array.isArray(args?.items) && args.additionalItems === false ? args.items.length : Infinity),
  };
}
/** Conservative graphical subset. Unsupported syntax is retained as the original expression text. */
export function parseISLExpression(value: string, catalog: Catalog): ISLNode | null {
  if (!isExpression(value)) return null;
  const source = value.trim().slice(1, -1);
  let at = 0;
  const space = () => {
    while (at < source.length && /\s/.test(source[at] ?? '')) at++;
  };
  function expression(depth: number): ISLNode {
    if (depth > 32) throw Error('Expression depth');
    space();
    const begin = at;
    const quote = source[at];
    if (quote === '"' || quote === "'") {
      at++;
      let escaped = false;
      while (at < source.length) {
        const char = source[at++];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === quote) {
          const raw = source.slice(begin, at);
          const decoded: unknown =
            quote === '"' ? JSON.parse(raw) : raw.slice(1, -1).replace(/\\(['\\])/g, '$1');
          if (typeof decoded !== 'string') throw Error('Invalid literal');
          return { kind: 'literal', raw, value: decoded };
        }
      }
      throw Error('Unterminated literal');
    }
    const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(at));
    if (match) {
      const name = match[0];
      at += name.length;
      space();
      if (source[at] === '(') {
        if (!catalog.islByName[name]) throw Error('Unknown function');
        at++;
        space();
        const args: ISLNode[] = [];
        while (source[at] !== ')') {
          args.push(expression(depth + 1));
          space();
          if (source[at] === ',') {
            at++;
            space();
            if (source[at] === ')') throw Error('Trailing comma');
          } else if (source[at] !== ')') throw Error('Missing separator');
        }
        at++;
        const arity = islArity(catalog, name);
        if (args.length < arity.min || args.length > arity.max) throw Error('Invalid arity');
        return { kind: 'call', name, args };
      }
      if (['true', 'false', 'null', 'undefined'].includes(name))
        return {
          kind: 'literal',
          raw: name,
          value: name === 'undefined' ? undefined : name === 'null' ? null : name === 'true',
        };
      throw Error('Unsupported identifier');
    }
    const number = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(at));
    if (!number) throw Error('Unsupported expression');
    at += number[0].length;
    return { kind: 'literal', raw: number[0], value: Number(number[0]) };
  }
  try {
    const node = expression(0);
    space();
    return at === source.length && node.kind === 'call' ? node : null;
  } catch {
    return null;
  }
}
export function serializeISL(node: ISLNode, inner = false): string {
  const body =
    node.kind === 'literal'
      ? node.raw
      : `${node.name}(${node.args.map((arg) => serializeISL(arg, true)).join(', ')})`;
  return inner ? body : `{${body}}`;
}

/** Lexical spans shared by coloring and hover; quoted ISL arguments remain data. */
export function islSourceTokens(
  source: string,
): { kind: 'call' | 'symbol'; text: string; offset: number; length: number }[] {
  const open = source.indexOf('{'),
    close = source.lastIndexOf('}');
  if (open < 0 || close <= open) return [];
  const tokens = /'(?:\\.|[^'\\])*'|\\"(?:\\.|[^"\\])*\\"|\b([A-Za-z_$][\w$]*)\s*(?=\()|[(),]/g;
  return [...source.slice(open + 1, close).matchAll(tokens)].flatMap((match) => {
    const name = match[1];
    if (!name && !/^[(),]$/.test(match[0])) return [];
    const text = name ?? match[0];
    return [
      {
        kind: name ? ('call' as const) : ('symbol' as const),
        text,
        offset: open + 1 + match.index,
        length: text.length,
      },
    ];
  });
}
