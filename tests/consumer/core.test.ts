import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  getConfig,
  parseJSONC,
  createProject,
  tree,
  highlightSource,
  getCatalog,
} from 'gcscript-studio';
import { DEFAULT_CONFIG } from 'gcscript-studio/config';

test('built package and declarations work in a native Node ESM consumer without DOM globals', async () => {
  const config = await getConfig();
  assert.equal(config.version, DEFAULT_CONFIG.version);
  assert.deepEqual(parseJSONC('{/*comment*/"value":"9007199254740993"}'), {
    value: '9007199254740993',
  });
  assert.equal(tree(createProject(config, 'node-consumer')).children[0]?.name, 'main.gcscript');
  assert.deepEqual(highlightSource('invalid source', {}, getCatalog({}), config), []);
  assert.equal(typeof globalThis.window, 'undefined');
});
