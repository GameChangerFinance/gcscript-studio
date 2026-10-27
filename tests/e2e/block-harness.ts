import { getConfig } from '../../src/config';
import { createBlockEditor } from '../../src/adapters/blockly/editor';
import { serializeValue, changeISLSlots, metadata } from '../../src/adapters/blockly/blocks';
import type { StudioBlock } from '../../src/adapters/blockly/blocks';
import { extendSchemas, parseBundle } from '../../src/core/schema/extensions';
import { getCatalog } from '../../src/core/schema/catalog';
import { errorMessage, parseJSONC } from '../../src/core/json';

async function main(): Promise<void> {
  const config = await getConfig();
  config.colors.functions.get = '#d47788';
  const runtime = parseBundle(await (await fetch('/tests/fixtures/runtime-schema.json')).json());
  const extras = parseBundle(await (await fetch('/extras.json.full')).json());
  const authoring = extendSchemas(runtime, extras),
    catalog = getCatalog(authoring, new Set(Object.keys(extras)));
  const snapshot = { runtime, authoring, catalog, source: 'fixture' };
  const results: Record<string, boolean> = {};
  const source =
    '{\n//keep this comment\n"type":"script","run":{"macro":{"type":"macro","run":"{ return( get( \'args.message\' ) ) }"},"literal":{"type":"data","value":{"type":"script","run":"{get(42)}","":false,"array":[null,0,"hello"]}},"import":{"type":"$importAsData","as":"string","from":["app:///message.txt"]}}}';
  const host = document.createElement('div');
  host.style.cssText = 'height:800px;width:1200px';
  document.body.appendChild(host);
  let updated = source,
    status = '';
  const editor = createBlockEditor(
    host,
    source,
    snapshot,
    { ...config.defaults, islDisplay: 'blocks' },
    config,
    location.origin + '/',
    (value) => {
      updated = value;
    },
    () => {},
    (message) => {
      status = message;
    },
    () => {},
  );
  const root = editor.workspace.getTopBlocks(false)[0];
  if (!root) throw Error('Missing root block');
  results.lossless = JSON.stringify(serializeValue(root)) === JSON.stringify(parseJSONC(source));
  const all = editor.workspace.getAllBlocks(false);
  const literal = all.find(
    (block) =>
      JSON.stringify(metadata(block).path) === JSON.stringify(['run', 'literal', 'value']) &&
      block.type === 'studio_object',
  );
  results.literalNotExecutable = Boolean(literal);
  const scriptBlock = all.find(
    (block) => block.type === 'studio_function' && block.getFieldValue('TYPE') === 'script',
  );
  const importBlock = all.find((block) => block.getFieldValue('TYPE') === '$importAsData');
  results.colors =
    scriptBlock?.getColour() === config.colors.functions.script &&
    importBlock?.getColour() === config.colors.functions.$importAsData;
  const get = all.find(
    (block) => block.type === 'studio_isl_call' && block.getFieldValue('TYPE') === 'get',
  ) as StudioBlock | undefined;
  results.islContract = Boolean(get && (get.islCount ?? 0) === 1);
  results.colors = Boolean(results.colors && get?.getColour() === config.colors.functions.get);
  const ret = all.find(
    (block) => block.type === 'studio_isl_call' && block.getFieldValue('TYPE') === 'return',
  ) as StudioBlock | undefined;
  if (ret) {
    try {
      changeISLSlots(ret, 0);
      results.connectedArgumentProtected = false;
    } catch {
      results.connectedArgumentProtected = true;
    }
  }
  const value = all.find(
    (block) => block.type === 'studio_string' && block.getFieldValue('TEXT') === 'hello',
  );
  value?.setFieldValue('edited', 'TEXT');
  await new Promise((resolve) => setTimeout(resolve, config.timing.blocksDebounce + 200));
  results.commentPreserved = updated.includes('//keep this comment') && updated.includes('edited');
  const floating = editor.workspace.newBlock('studio_string');
  floating.initSvg();
  floating.render();
  await new Promise((resolve) => setTimeout(resolve, 50));
  results.floatingUndo =
    editor.flushHistory(false) === false && editor.workspace.getTopBlocks(false).length === 1;
  await new Promise((resolve) => setTimeout(resolve, 50));
  results.floatingRedo =
    editor.flushHistory(true) === false && editor.workspace.getTopBlocks(false).length === 2;
  editor.workspace.getBlockById(floating.id)?.dispose(false);
  const beforeInvalid = updated;
  editor.syncSource('{ invalid');
  results.invalidSourceUsesSharedHistory = editor.flushHistory(false) === true;
  value?.setFieldValue('must not overwrite invalid code', 'TEXT');
  await new Promise((resolve) => setTimeout(resolve, config.timing.blocksDebounce + 200));
  results.invalidSourceProtected =
    updated === beforeInvalid && status.includes('Fix invalid source');
  editor.dispose();
  host.remove();
  const report = document.getElementById('report');
  if (report) report.textContent = JSON.stringify(results);
}
void main().catch((error) => {
  const report = document.getElementById('report');
  if (report) report.textContent = JSON.stringify({ error: errorMessage(error) });
});
