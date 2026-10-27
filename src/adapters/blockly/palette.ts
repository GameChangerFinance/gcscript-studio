import type * as Blockly from 'blockly/core';
import type { Catalog } from '../../core/schema/types';
import type { StudioConfig } from '../../config';
import { languageColor } from '../../config';
export const CATEGORY_LABELS = {
  gcscript: 'GCScript DSL',
  extras: 'Extras · Build stage',
  isl: 'ISL',
  json: 'JSON types',
  'user-defined': 'JSON entries',
} as const;
/** Categories come from language origin and published ISL groups, never argument-name guesses. */
export function palette(
  catalog: Catalog,
  config: StudioConfig,
  filter = '',
): Blockly.utils.toolbox.ToolboxInfo {
  const query = filter.trim().toLowerCase();
  const contents: Blockly.utils.toolbox.ToolboxItemInfo[] = [];
  for (const category of ['gcscript', 'extras'] as const) {
    const functions = catalog.functions.filter(
      (fn) =>
        fn.category === category &&
        (fn.name + ' ' + fn.title + ' ' + fn.description).toLowerCase().includes(query),
    );
    if (functions.length)
      contents.push({
        kind: 'category',
        name: CATEGORY_LABELS[category],
        colour: languageColor(config, '', category),
        contents: functions.map((fn) => ({
          kind: 'block',
          type: 'studio_step',
          fields: { TYPE: fn.name, KEY: fn.name },
        })),
      });
  }
  const isl = catalog.isl.filter((fn) =>
    (fn.name + ' ' + fn.schema.description).toLowerCase().includes(query),
  );
  const groups = [...new Set(isl.map((fn) => fn.group))];
  contents.push({
    kind: 'category',
    name: CATEGORY_LABELS.isl,
    colour: config.colors.categories.isl,
    contents: [
      { kind: 'block', type: 'studio_expression' },
      ...groups.map((group) => ({
        kind: 'category',
        name: group,
        colour: config.colors.categories.isl,
        contents: isl
          .filter((fn) => fn.group === group)
          .map((fn) => ({ kind: 'block', type: 'studio_isl_call', fields: { TYPE: fn.name } })),
      })),
    ],
  });
  contents.push({
    kind: 'category',
    name: CATEGORY_LABELS.json,
    colour: config.colors.categories.json,
    contents: ['string', 'number', 'boolean', 'null', 'object', 'array'].map((type) => ({
      kind: 'block',
      type: 'studio_' + type,
    })),
  });
  contents.push({
    kind: 'category',
    name: CATEGORY_LABELS['user-defined'],
    colour: config.colors.categories['user-defined'],
    contents: [
      { kind: 'block', type: 'studio_member' },
      { kind: 'block', type: 'studio_item' },
    ],
  });
  return { kind: 'categoryToolbox', contents };
}
