import { getAt, isObject, isJsonValue, parseJSONC, sourceRange } from './json.js';
import type { JsonValue, JsonPath } from './json.js';
export interface Diagnostic {
  message: string;
  code?: string;
  jsonPath?: string;
  suggestion?: string;
  fileUri?: string;
  examples?: JsonValue[];
  relatedDocs?: string[];
  provided?: JsonValue;
  details?: JsonValue;
  location?: { line?: number; column?: number; offset?: number; length?: number };
}
export interface ValidationReport {
  isValid: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  file?: string;
  revision?: number;
}
/** GC diagnostics use JSON Pointer, including escaped slashes and tildes in user keys. */
export function diagnosticPath(pointer: string): JsonPath {
  return pointer === ''
    ? []
    : pointer
        .replace(/^\//, '')
        .split('/')
        .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}
export interface DiagnosticEdit {
  title: string;
  offset: number;
  length: number;
  text: string;
}
/** Offer a small set of exact GC enum corrections, only while the provided value still matches. */
export function diagnosticEdits(source: string, diagnostic: Diagnostic): DiagnosticEdit[] {
  if (diagnostic.code !== 'code-invalid-const-enum' || diagnostic.jsonPath === undefined) return [];
  try {
    const path = diagnosticPath(diagnostic.jsonPath);
    if (JSON.stringify(getAt(parseJSONC(source), path)) !== JSON.stringify(diagnostic.provided))
      return [];
    const range = sourceRange(source, path);
    const values = isObject(diagnostic.details) ? diagnostic.details.closestValues : undefined;
    if (!range || !Array.isArray(values)) return [];
    return values
      .filter(isJsonValue)
      .slice(0, 3)
      .map((value) => ({
        title: 'Use ' + JSON.stringify(value),
        ...range,
        text: JSON.stringify(value),
      }));
  } catch {
    return [];
  }
}
/** Bounded human help; retain the full GC report separately for inspection/export. */
export function diagnosticMessage(diagnostic: Diagnostic): string {
  const parts = [diagnostic.message];
  if (diagnostic.suggestion) parts.push(diagnostic.suggestion);
  const examples = diagnostic.examples
    ?.slice(0, 3)
    .map((value) => JSON.stringify(value))
    .filter((value) => value.length <= 180);
  if (examples?.length) parts.push('Examples: ' + examples.join(' · '));
  return parts.join('\n');
}

/** Debounce bursts; an interval also drains sustained edits/retries, with no overlapping runs. */
export function createValidationScheduler(
  run: () => Promise<void>,
  debounce: number,
  interval: number,
): { schedule(): void; dispose(): void } {
  let dirty = false,
    running = false,
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function drain(): Promise<void> {
    if (!dirty || running || disposed) return;
    clearTimeout(timer);
    dirty = false;
    running = true;
    let failed = false;
    try {
      await run();
    } catch {
      dirty = true;
      failed = true;
    } finally {
      running = false;
      if (dirty && !disposed && !failed) {
        clearTimeout(timer);
        timer = setTimeout(() => void drain(), debounce);
      }
    }
  }
  const tick = setInterval(() => void drain(), interval);
  return {
    schedule() {
      if (disposed) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void drain(), debounce);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearInterval(tick);
    },
  };
}
