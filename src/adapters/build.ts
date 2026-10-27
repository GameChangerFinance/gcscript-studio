import { gc } from './gc';
import { dataURIText, toGCFiles } from './files';
import type { BuildService } from '../core/project/build';
import type { SchemaBundle } from '../core/schema/types';
import type { JsonValue } from '../core/json';
import { isJsonValue, isRecord } from '../core/json';
import type { ValidationReport, Diagnostic } from '../core/validation';
/** Serialization is the only bridge from open schema vocabulary to GC's strict JSON domain. */
export function schemaJSON(schema: SchemaBundle): JsonValue {
  const value: unknown = JSON.parse(JSON.stringify(schema));
  if (!isJsonValue(value)) throw Error('Schema contains non-JSON values');
  return value;
}
export const buildService: BuildService = {
  async build(request) {
    return dataURIText(
      await gc.build.file({
        ...request,
        files: toGCFiles(request.files),
        useSchema: schemaJSON(request.useSchema),
        allowedProtocols: ['app'],
      }),
    );
  },
};
export async function validateBuilt(
  input: string,
  useSchema: SchemaBundle,
  fileUri: string,
): Promise<ValidationReport> {
  const result: unknown = JSON.parse(
    dataURIText(await gc.validate.file({ input, useSchema: schemaJSON(useSchema), fileUri })),
  );
  if (
    !isRecord(result) ||
    typeof result.isValid !== 'boolean' ||
    !Array.isArray(result.errors) ||
    !Array.isArray(result.warnings)
  )
    throw Error('Invalid GC validation report');
  const diagnostics = (values: unknown[]): Diagnostic[] =>
    values.map((value) => {
      if (!isRecord(value) || typeof value.message !== 'string')
        throw Error('Invalid GC diagnostic');
      return {
        message: value.message,
        ...(typeof value.code === 'string' ? { code: value.code } : {}),
        ...(typeof value.fileUri === 'string' ? { fileUri: value.fileUri } : {}),
        ...(isJsonValue(value.provided) ? { provided: value.provided } : {}),
        ...(isJsonValue(value.details) ? { details: value.details } : {}),
        ...(Array.isArray(value.examples) ? { examples: value.examples.filter(isJsonValue) } : {}),
        ...(Array.isArray(value.relatedDocs)
          ? {
              relatedDocs: value.relatedDocs.filter(
                (item): item is string => typeof item === 'string' && /^https:\/\//.test(item),
              ),
            }
          : {}),
        ...(isRecord(value.location)
          ? {
              location: Object.fromEntries(
                Object.entries(value.location).filter(
                  (entry): entry is [string, number] => typeof entry[1] === 'number',
                ),
              ),
            }
          : {}),
        ...(typeof value.jsonPath === 'string' ? { jsonPath: value.jsonPath } : {}),
        ...(typeof value.suggestion === 'string' ? { suggestion: value.suggestion } : {}),
      };
    });
  return {
    isValid: result.isValid,
    errors: diagnostics(result.errors),
    warnings: diagnostics(result.warnings),
  };
}
