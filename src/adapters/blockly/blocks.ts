import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import type { StudioConfig } from '../../config';
import { languageColor } from '../../config';
import type { JsonPath, JsonValue } from '../../core/json';
import { isObject, isRecord } from '../../core/json';
import type { Catalog, SchemaBundle } from '../../core/schema/types';
import { functionAtPath, schemaAtPath, supportsISL } from '../../core/schema/context';
import { islArity, isExpression, parseISLExpression, serializeISL } from '../../core/language/isl';
import type { ISLNode } from '../../core/language/isl';
export interface BlockContext {
  catalog: Catalog;
  bundle: SchemaBundle;
  document: JsonValue;
  config: StudioConfig;
  islDisplay: 'text' | 'blocks';
}
export interface BlockMetadata {
  path: JsonPath;
  typePos?: number;
  propertyOrder?: string[];
  originalISL?: string;
  canonicalISL?: string;
  literalRaw?: string;
}
export type StudioBlock = Blockly.BlockSvg & { studioSlots?: string[]; islCount?: number };
const contexts = new WeakMap<Blockly.Workspace, BlockContext>();
export function setBlockContext(workspace: Blockly.Workspace, context: BlockContext): void {
  contexts.set(workspace, context);
}
function context(block: Blockly.Block): BlockContext {
  const ctx =
    contexts.get(block.workspace) ??
    (block.workspace instanceof Blockly.WorkspaceSvg && block.workspace.targetWorkspace
      ? contexts.get(block.workspace.targetWorkspace)
      : undefined);
  if (!ctx) throw Error('Block workspace context is missing');
  return ctx;
}
export function metadata(block: Blockly.Block): BlockMetadata {
  try {
    const value: unknown = JSON.parse(block.data || '{}');
    if (
      isRecord(value) &&
      Array.isArray(value.path) &&
      value.path.every((key) => typeof key === 'string' || typeof key === 'number')
    )
      return value as unknown as BlockMetadata;
  } catch {
    /* New blocks have no source path yet. */
  }
  return { path: [] };
}
const setMetadata = (block: Blockly.Block, value: BlockMetadata): void => {
  block.data = JSON.stringify(value);
};
const chain = (start: Blockly.Block | null): Blockly.Block[] => {
  const nodes: Blockly.Block[] = [],
    seen = new Set<string>();
  for (let node = start; node; node = node.getNextBlock()) {
    if (seen.has(node.id) || nodes.length > 10000) throw Error('Invalid or excessive block chain');
    seen.add(node.id);
    nodes.push(node);
  }
  return nodes;
};
const slotId = (key: string): string =>
  'ARG_' + [...new TextEncoder().encode(key)].map((n) => n.toString(16).padStart(2, '0')).join('');
const functionProps = (block: Blockly.Block): string[] =>
  Object.keys(
    context(block).catalog.byName[String(block.getFieldValue('TYPE'))]?.props ?? {},
  ).filter((key) => key !== 'type');
const input = (block: Blockly.Block, key: string) =>
  block.appendValueInput(key).setCheck(['JSON', 'ISL']);
function connectValue(parent: Blockly.Block, key: string, child: Blockly.Block): void {
  const connection = parent.getInput(key)?.connection;
  if (!connection || !child.outputConnection) throw Error('Missing JSON block connection');
  connection.connect(child.outputConnection);
}
function appendMember(parent: Blockly.Block, child: Blockly.Block): void {
  const members = chain(parent.getInputTargetBlock('CHILDREN'));
  const end = members.at(-1),
    connection = end ? end.nextConnection : parent.getInput('CHILDREN')?.connection;
  if (!connection || !child.previousConnection) throw Error('Missing collection block connection');
  connection.connect(child.previousConnection);
}
function refreshFunctionSlots(block: StudioBlock): void {
  const ctx = context(block),
    fn = ctx.catalog.byName[String(block.getFieldValue('TYPE'))],
    wanted = functionProps(block);
  for (const key of block.studioSlots ?? [])
    if (!wanted.includes(key)) {
      block.getInputTargetBlock(slotId(key))?.unplug();
      block.removeInput(slotId(key));
    }
  for (const key of wanted)
    if (!block.getInput(slotId(key)))
      input(block, slotId(key)).appendField((fn?.required.includes(key) ? '● ' : '○ ') + key);
  block.studioSlots = wanted;
  block.setColour(languageColor(ctx.config, fn?.name ?? '', fn?.category ?? 'user-defined'));
  block.setTooltip('');
}
export function changeISLSlots(block: StudioBlock, requested: number): void {
  const range = islArity(context(block).catalog, String(block.getFieldValue('TYPE')));
  const count = Math.max(range.min, Math.min(range.max, Math.floor(requested))),
    previous = block.islCount ?? 0;
  for (let i = count; i < previous; i++)
    if (block.getInputTargetBlock('ISL_ARG_' + i))
      throw Error('Disconnect argument ' + (i + 1) + ' before removing its socket.');
  for (let i = previous - 1; i >= count; i--) block.removeInput('ISL_ARG_' + i);
  for (let i = previous; i < count; i++)
    input(block, 'ISL_ARG_' + i).appendField('argument ' + (i + 1));
  block.islCount = count;
}
let defined = false;
/** Register generic block shapes once; each workspace owns its schema and color context. */
export function defineBlocks(): void {
  if (defined) return;
  defined = true;
  Blockly.setLocale(
    Object.fromEntries(
      Object.entries(En).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  );
  const define = (name: string, init: (this: StudioBlock) => void): void => {
    Blockly.Blocks[name] = { init };
  };
  const output = (block: StudioBlock) => block.setOutput(true, 'JSON');
  const statement = (block: StudioBlock, type: string) => {
    block.setPreviousStatement(true, type);
    block.setNextStatement(true, type);
  };
  const jsonColor = (block: StudioBlock) =>
    block.setColour(context(block).config.colors.categories.json);
  define('studio_object', function () {
    this.appendDummyInput().appendField('◇ object { }');
    this.appendStatementInput('CHILDREN').setCheck('MEMBER').appendField('properties');
    output(this);
    jsonColor(this);
  });
  define('studio_array', function () {
    this.appendDummyInput().appendField('▤ array [ ]');
    this.appendStatementInput('CHILDREN').setCheck('ITEM').appendField('items');
    output(this);
    jsonColor(this);
  });
  define('studio_member', function () {
    this.appendDummyInput()
      .appendField('key')
      .appendField(new Blockly.FieldTextInput('name'), 'KEY');
    input(this, 'V').appendField('value');
    statement(this, 'MEMBER');
    this.setColour(context(this).config.colors.categories['user-defined']);
  });
  define('studio_item', function () {
    input(this, 'V').appendField('item');
    statement(this, 'ITEM');
    this.setColour(context(this).config.colors.categories['user-defined']);
  });
  const functionBlock = function (this: StudioBlock, keyed: boolean, kind?: string): void {
    if (keyed)
      this.appendDummyInput()
        .appendField('step')
        .appendField(new Blockly.FieldTextInput('step'), 'KEY');
    const field = new Blockly.FieldDropdown(() => {
      const functions = context(this).catalog.functions;
      return functions.length
        ? functions.map((fn) => [fn.name, fn.name] as [string, string])
        : [['Unknown', '__unknown']];
    });
    this.appendDummyInput().appendField('◆').appendField(field, 'TYPE');
    this.appendStatementInput('CHILDREN').setCheck('MEMBER').appendField('extra properties');
    if (kind) statement(this, kind);
    else output(this);
    field.setValidator((value) => {
      queueMicrotask(() => {
        if (!this.isDisposed()) refreshFunctionSlots(this);
      });
      return value;
    });
    refreshFunctionSlots(this);
  };
  define('studio_step', function () {
    functionBlock.call(this, true, 'MEMBER');
  });
  define('studio_array_step', function () {
    functionBlock.call(this, false, 'ITEM');
  });
  define('studio_function', function () {
    functionBlock.call(this, false);
  });
  for (const type of ['string', 'number', 'expression', 'literal'])
    define('studio_' + type, function () {
      this.appendDummyInput()
        .appendField(type === 'expression' ? '∿ ISL' : type)
        .appendField(
          new Blockly.FieldTextInput(type === 'number' ? '0' : type === 'expression' ? '{}' : ''),
          'TEXT',
        );
      output(this);
      this.setColour(
        context(this).config.colors.categories[type === 'expression' ? 'isl' : 'json'],
      );
    });
  define('studio_boolean', function () {
    this.appendDummyInput()
      .appendField('boolean')
      .appendField(
        new Blockly.FieldDropdown([
          ['true', 'true'],
          ['false', 'false'],
        ]),
        'BOOL',
      );
    output(this);
    jsonColor(this);
  });
  define('studio_null', function () {
    this.appendDummyInput().appendField('∅ null');
    output(this);
    jsonColor(this);
  });
  define('studio_isl_call', function () {
    const field = new Blockly.FieldDropdown(() => {
      const names = context(this).catalog.isl.map((fn) => fn.name);
      return names.length
        ? names.map((name) => [name + '()', name] as [string, string])
        : [['function()', 'function']];
    });
    this.appendDummyInput().appendField('∿ call').appendField(field, 'TYPE');
    output(this);
    this.setColour(languageColor(context(this).config, String(this.getFieldValue('TYPE')), 'isl'));
    field.setValidator((value) => {
      queueMicrotask(() => {
        if (!this.isDisposed()) {
          const range = islArity(context(this).catalog, String(value));
          this.setColour(languageColor(context(this).config, String(value), 'isl'));
          changeISLSlots(this, Math.max(range.min, Math.min(range.max, this.islCount ?? 0)));
        }
      });
      return value;
    });
    changeISLSlots(this, islArity(context(this).catalog, String(this.getFieldValue('TYPE'))).min);
    this.setTooltip('');
  });
}
function newBlock(
  workspace: Blockly.WorkspaceSvg,
  type: string,
  path: JsonPath,
  fields: Record<string, string> = {},
  extra: Omit<BlockMetadata, 'path'> = {},
): StudioBlock {
  const block = workspace.newBlock(type) as StudioBlock;
  setMetadata(block, { path, ...extra });
  for (const [key, value] of Object.entries(fields)) block.setFieldValue(value, key);
  if (['studio_function', 'studio_step', 'studio_array_step'].includes(type))
    refreshFunctionSlots(block);
  if (type === 'studio_isl_call')
    block.setColour(
      languageColor(context(block).config, String(block.getFieldValue('TYPE')), 'isl'),
    );
  block.initSvg();
  block.render();
  return block;
}
function islBlock(workspace: Blockly.WorkspaceSvg, node: ISLNode, path: JsonPath): StudioBlock {
  if (node.kind === 'literal')
    return newBlock(workspace, 'studio_literal', path, { TEXT: node.raw });
  const block = newBlock(workspace, 'studio_isl_call', path, { TYPE: node.name });
  changeISLSlots(block, node.args.length);
  node.args.forEach((arg, i) =>
    connectValue(block, 'ISL_ARG_' + i, islBlock(workspace, arg, path)),
  );
  return block;
}
function functionBlockFromValue(
  workspace: Blockly.WorkspaceSvg,
  value: Record<string, JsonValue>,
  path: JsonPath,
  key?: string,
  arrayItem = false,
): StudioBlock {
  const type = typeof value.type === 'string' ? value.type : '';
  const fields = key === undefined ? { TYPE: type } : { TYPE: type, KEY: key };
  const block = newBlock(
    workspace,
    key !== undefined ? 'studio_step' : arrayItem ? 'studio_array_step' : 'studio_function',
    path,
    fields,
    {
      propertyOrder: Object.keys(value).filter((k) => k !== 'type'),
      typePos: Object.keys(value).indexOf('type'),
    },
  );
  for (const [name, child] of Object.entries(value))
    if (name !== 'type') {
      if (block.getInput(slotId(name)))
        connectValue(block, slotId(name), valueToBlock(workspace, child, [...path, name]));
      else appendMember(block, memberFromValue(workspace, name, child, [...path, name]));
    }
  return block;
}
function memberFromValue(
  workspace: Blockly.WorkspaceSvg,
  key: string,
  value: JsonValue,
  path: JsonPath,
): StudioBlock {
  const ctx = contexts.get(workspace);
  if (!ctx) throw Error('Workspace context missing');
  if (isObject(value) && functionAtPath(ctx.document, ctx.bundle, ctx.catalog, path))
    return functionBlockFromValue(workspace, value, path, key);
  const block = newBlock(workspace, 'studio_member', path, { KEY: key });
  connectValue(block, 'V', valueToBlock(workspace, value, path));
  return block;
}
/** Complete, ordered JSON projection. Literal objects are never silently promoted to function calls. */
export function valueToBlock(
  workspace: Blockly.WorkspaceSvg,
  value: JsonValue,
  path: JsonPath = [],
): StudioBlock {
  const ctx = contexts.get(workspace);
  if (!ctx) throw Error('Workspace context missing');
  if (Array.isArray(value)) {
    const block = newBlock(workspace, 'studio_array', path);
    value.forEach((child, i) => {
      const childPath = [...path, i];
      let member: StudioBlock;
      if (isObject(child) && functionAtPath(ctx.document, ctx.bundle, ctx.catalog, childPath))
        member = functionBlockFromValue(workspace, child, childPath, undefined, true);
      else {
        member = newBlock(workspace, 'studio_item', childPath);
        connectValue(member, 'V', valueToBlock(workspace, child, childPath));
      }
      appendMember(block, member);
    });
    return block;
  }
  if (isObject(value)) {
    if (functionAtPath(ctx.document, ctx.bundle, ctx.catalog, path))
      return functionBlockFromValue(workspace, value, path);
    const block = newBlock(workspace, 'studio_object', path);
    for (const [key, child] of Object.entries(value))
      appendMember(block, memberFromValue(workspace, key, child, [...path, key]));
    return block;
  }
  if (typeof value === 'string') {
    const evaluated =
      isExpression(value) && supportsISL(ctx.bundle, schemaAtPath(ctx.document, ctx.bundle, path));
    const tree =
      evaluated && ctx.islDisplay === 'blocks' ? parseISLExpression(value, ctx.catalog) : null;
    if (tree) {
      const block = islBlock(workspace, tree, path);
      setMetadata(block, { path, originalISL: value, canonicalISL: serializeISL(tree) });
      return block;
    }
    return newBlock(workspace, evaluated ? 'studio_expression' : 'studio_string', path, {
      TEXT: value,
    });
  }
  if (typeof value === 'number')
    return newBlock(workspace, 'studio_number', path, { TEXT: String(value) });
  if (typeof value === 'boolean')
    return newBlock(workspace, 'studio_boolean', path, { BOOL: String(value) });
  return newBlock(workspace, 'studio_null', path);
}
function serializeMembers(block: Blockly.Block): Record<string, JsonValue> {
  const entries = chain(block.getInputTargetBlock('CHILDREN')).map((child) => {
    const key = String(child.getFieldValue('KEY') ?? '');
    if (!['studio_member', 'studio_step'].includes(child.type))
      throw Error('Only named members fit inside JSON objects');
    return [
      key,
      child.type === 'studio_step'
        ? serializeFunction(child)
        : serializeValue(child.getInputTargetBlock('V')),
    ] as [string, JsonValue];
  });
  const keys = new Set<string>();
  for (const [key] of entries) {
    if (keys.has(key)) throw Error('Duplicate object key "' + key + '". Rename the cloned entry.');
    keys.add(key);
  }
  return Object.fromEntries(entries);
}
function serializeFunction(block: Blockly.Block): JsonValue {
  const props = serializeMembers(block),
    fn = String(block.getFieldValue('TYPE'));
  if (Object.hasOwn(props, 'type')) throw Error('Duplicate function type argument');
  for (const key of functionProps(block)) {
    const value = block.getInputTargetBlock(slotId(key));
    if (value) {
      if (Object.hasOwn(props, key)) throw Error('Duplicate function argument: ' + key);
      Object.defineProperty(props, key, {
        value: serializeValue(value),
        enumerable: true,
        configurable: true,
      });
    }
  }
  const meta = metadata(block);
  const order = [
    ...new Set([
      ...(meta.propertyOrder ?? []).filter((key) => Object.hasOwn(props, key)),
      ...Object.keys(props),
    ]),
  ];
  order.splice(Math.min(meta.typePos ?? 0, order.length), 0, 'type');
  return Object.fromEntries(order.map((key) => [key, key === 'type' ? fn : (props[key] ?? null)]));
}
function serializeISLBlock(block: Blockly.Block): ISLNode {
  if (block.type === 'studio_isl_call') {
    const args: ISLNode[] = [],
      count = (block as StudioBlock).islCount ?? 0,
      name = String(block.getFieldValue('TYPE'));
    let last = -1;
    for (let i = 0; i < count; i++) if (block.getInputTargetBlock('ISL_ARG_' + i)) last = i;
    for (let i = 0; i <= last; i++) {
      const child = block.getInputTargetBlock('ISL_ARG_' + i);
      if (!child) throw Error('ISL argument ' + (i + 1) + ' is empty before a later argument.');
      args.push(serializeISLBlock(child));
    }
    const range = islArity(context(block).catalog, name);
    if (args.length < range.min || args.length > range.max)
      throw Error(name + '() has invalid argument count per schema');
    return { kind: 'call', name, args };
  }
  if (block.type === 'studio_literal')
    return { kind: 'literal', raw: String(block.getFieldValue('TEXT')), value: undefined };
  const value = serializeValue(block);
  return {
    kind: 'literal',
    raw:
      block.type === 'studio_expression' && typeof value === 'string'
        ? value.trim().slice(1, -1)
        : JSON.stringify(value),
    value,
  };
}
export function serializeValue(block: Blockly.Block | null): JsonValue {
  if (!block) throw Error('Missing a connected JSON value');
  switch (block.type) {
    case 'studio_object':
      return serializeMembers(block);
    case 'studio_array':
      return chain(block.getInputTargetBlock('CHILDREN')).map((child) =>
        child.type === 'studio_array_step'
          ? serializeFunction(child)
          : child.type === 'studio_item'
            ? serializeValue(child.getInputTargetBlock('V'))
            : (() => {
                throw Error('Wrong array item block');
              })(),
      );
    case 'studio_function':
      return serializeFunction(block);
    case 'studio_string':
    case 'studio_expression':
      return String(block.getFieldValue('TEXT') ?? '');
    case 'studio_number': {
      const text = String(block.getFieldValue('TEXT')).trim();
      if (
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) ||
        !Number.isFinite(Number(text))
      )
        throw Error('Invalid JSON number: ' + text);
      return Number(text);
    }
    case 'studio_boolean':
      return block.getFieldValue('BOOL') === 'true';
    case 'studio_null':
      return null;
    case 'studio_isl_call': {
      const value = serializeISL(serializeISLBlock(block)),
        meta = metadata(block);
      return meta.originalISL && meta.canonicalISL === value ? meta.originalISL : value;
    }
    default:
      throw Error('Unexpected value block: ' + block.type);
  }
}
/** Refresh source paths after drag/reorder, so selection never points at the previous index. */
export function reindexPaths(block: Blockly.Block, path: JsonPath = []): void {
  setMetadata(block, { ...metadata(block), path });
  if (
    ['studio_object', 'studio_function', 'studio_step', 'studio_array_step'].includes(block.type)
  ) {
    if (block.type !== 'studio_object')
      for (const key of functionProps(block)) {
        const child = block.getInputTargetBlock(slotId(key));
        if (child) reindexPaths(child, [...path, key]);
      }
    for (const member of chain(block.getInputTargetBlock('CHILDREN'))) {
      const childPath = [...path, String(member.getFieldValue('KEY'))];
      reindexPaths(member, childPath);
      if (member.type === 'studio_member') {
        const child = member.getInputTargetBlock('V');
        if (child) reindexPaths(child, childPath);
      }
    }
  } else if (block.type === 'studio_array')
    chain(block.getInputTargetBlock('CHILDREN')).forEach((member, i) => {
      const childPath = [...path, i];
      reindexPaths(member, childPath);
      const child = member.getInputTargetBlock('V');
      if (child) reindexPaths(child, childPath);
    });
}
export function enhanceContextMenus(
  workspace: Blockly.WorkspaceSvg,
  onError: (message: string) => void,
): void {
  for (const raw of workspace.getAllBlocks(false)) {
    const block = raw as StudioBlock;
    block.customContextMenu = (options) => {
      const add = (text: string, action: () => void) =>
        options.push({
          text,
          enabled: !block.isInFlyout,
          callback: () => {
            try {
              Blockly.Events.setGroup(true);
              action();
            } catch (error) {
              onError(error instanceof Error ? error.message : String(error));
            } finally {
              Blockly.Events.setGroup(false);
            }
          },
        });
      if (
        ['studio_object', 'studio_function', 'studio_step', 'studio_array_step'].includes(
          block.type,
        )
      )
        add('＋ Add extra property', () => {
          const key = prompt('Property name', 'newField');
          if (key === null) return;
          const member = newBlock(workspace, 'studio_member', [], { KEY: key });
          connectValue(member, 'V', newBlock(workspace, 'studio_string', [], { TEXT: '' }));
          appendMember(block, member);
        });
      if (block.type === 'studio_array')
        add('＋ Add array item', () => {
          const member = newBlock(workspace, 'studio_item', []);
          connectValue(member, 'V', newBlock(workspace, 'studio_string', [], { TEXT: '' }));
          appendMember(block, member);
        });
      if (block.type === 'studio_isl_call') {
        add('＋ Add argument', () => changeISLSlots(block, (block.islCount ?? 0) + 1));
        add('− Remove last argument', () => changeISLSlots(block, (block.islCount ?? 0) - 1));
      }
      add('Inspect source value', () => {
        block.setTooltip('');
        block.select();
      });
    };
  }
}
