import type { Project, VirtualFile } from './vfs.js';
import { isGCScript, path, put } from './vfs.js';
import type { SchemaBundle } from '../schema/types.js';
export interface BuildRequest {
  input: string;
  fileUri: string;
  files: Record<string, VirtualFile>;
  useSchema: SchemaBundle;
  compactOutput: boolean;
  doValidate?: boolean;
}
export interface BuildService {
  build(request: BuildRequest): Promise<string>;
}
/** Build a snapshot; the caller decides whether its revision is still current before committing. */
export async function buildProjectFile(
  service: BuildService,
  project: Project,
  source: string,
  schema: SchemaBundle,
  compact: boolean,
  doValidate = true,
): Promise<string> {
  const key = path(source),
    file = project.files[key];
  if (!isGCScript(key) || !file || file.encoding !== 'utf8')
    throw Error('Select an existing GCScript text file');
  return service.build({
    input: file.text,
    fileUri: 'app:///' + key,
    files: project.files,
    useSchema: schema,
    compactOutput: compact,
    doValidate,
  });
}
export function commitBuild(
  current: Project,
  snapshot: Project,
  source: string,
  destination: string,
  output: string,
): Project {
  if (current.id !== snapshot.id || current.revision !== snapshot.revision)
    throw Error('Project changed during build. Retry with the current files.');
  const target = path(destination);
  if (target === path(source)) throw Error('Build output cannot overwrite the source entrypoint');
  return put(current, target, { text: output, encoding: 'utf8' }, true);
}
