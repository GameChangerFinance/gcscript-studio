import { ClassicPreset, NodeEditor } from 'rete';
import type { GetSchemes } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { LitPlugin, Presets } from '@retejs/lit-plugin';
import type { LitArea2D } from '@retejs/lit-plugin';
import { LitElement, html, css } from 'lit';
import type { StudioConfig } from '../../config';
import { languageColor } from '../../config';
import type { JsonPath, JsonValue } from '../../core/json';
import { getAt } from '../../core/json';
import type { SchemaSnapshot } from '../../core/schema/types';
import { childCollections, describeScope } from '../../core/language/structure';
import type { ScopeDescription } from '../../core/language/structure';
import { inspectValue } from '../../core/schema/inspector';
import type { Inspection } from '../../core/schema/inspector';
export interface GraphBridge {
  select(path: JsonPath): void;
  open(path: JsonPath, parent: ScopeNode): void;
  close(node: ScopeNode): void;
  move(path: JsonPath, delta: number): void;
  doc(path: JsonPath, event: Event): void;
}
export class ScopeNode extends ClassicPreset.Node {
  width = 520;
  height = 300;
  element: HTMLElement | undefined;
  page = 0;
  focusPath: JsonPath = [];
  constructor(
    public scope: ScopeDescription,
    public bridge: GraphBridge,
    public config: StudioConfig,
    public parentId?: string,
    public expression?: string,
  ) {
    super(scope.title);
  }
}
type Schemes = GetSchemes<
  ScopeNode,
  ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;
type AreaExtra = LitArea2D<Schemes>;
class ScopeCard extends LitElement {
  static properties = { node: { attribute: false } };
  declare node: ScopeNode | undefined;
  static styles = css`
    :host {
      display: block;
      width: 520px;
      border: 1px solid var(--edge);
      border-radius: 13px;
      overflow: hidden;
      background: var(--surface);
      color: var(--txt);
      box-shadow: 0 15px 38px #0005;
      font: 12px/1.5 system-ui;
    }
    header,
    footer {
      padding: 12px 15px;
      background: var(--raised);
    }
    h3 {
      font-size: 17px;
      margin: 4px 0;
    }
    small {
      color: var(--muted);
    }
    .row {
      padding: 10px 12px;
      border-bottom: 1px solid var(--edge);
    }
    .row.focus {
      box-shadow: inset 3px 0 var(--accent);
    }
    .line {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .name {
      font-weight: 700;
      flex: 1;
    }
    .index {
      color: var(--a2);
    }
    button {
      color: var(--txt);
      background: var(--raised);
      border: 1px solid var(--edge);
      border-radius: 5px;
      padding: 4px 6px;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--accent);
    }
    .actions {
      display: flex;
      gap: 4px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 7px;
    }
    .chips button {
      font-size: 10px;
    }
    code {
      display: block;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 300px;
      overflow: auto;
      padding: 12px;
    }
    footer {
      display: flex;
      justify-content: space-between;
    }
    .close {
      float: right;
    }
  `;
  private stop(event: Event): void {
    event.stopPropagation();
  }
  protected updated(): void {
    if (this.node) this.node.element = this;
  }
  protected render() {
    const node = this.node;
    if (!node) return html``;
    const { scope, bridge, config } = node;
    const size = config.defaults.nodeChildrenLimit,
      pages = Math.max(1, Math.ceil(scope.rows.length / size));
    node.page = Math.min(node.page, pages - 1);
    const rows = scope.rows.slice(node.page * size, (node.page + 1) * size);
    return html`<header>
        <button
          class="close"
          aria-label="Close scope"
          @pointerdown=${this.stop}
          @click=${() => bridge.close(node)}
        >
          ×</button
        ><small>${node.expression ? 'ISL expression' : 'Ordered JSON scope'}</small>
        <h3>${scope.title}</h3>
        <small>${scope.path.join(' / ') || 'root'} · ${scope.rows.length} entries</small>
      </header>
      ${
        node.expression
          ? html`<code>${node.expression}</code>`
          : rows.map(
              (row) =>
                html`<section
                  class="row ${JSON.stringify(row.path) === JSON.stringify(node.focusPath) ? 'focus' : ''}"
                  @pointerdown=${this.stop}
                >
                  <div class="line">
                    <span class="index">${row.position}</span
                    ><button
                      class="name"
                      @click=${() => bridge.select(row.path)}
                      @focus=${(e: FocusEvent) => bridge.doc(row.path, e)}
                      @mouseenter=${(e: MouseEvent) => bridge.doc(row.path, e)}
                    >
                      ${row.name}</button
                    ><span
                      style="color:${languageColor(config, row.fn?.name ?? '', row.fn?.category ?? 'json')}"
                      >${row.fn?.name ?? (Array.isArray(row.value) ? 'array' : typeof row.value)}</span
                    >
                    <div class="actions">
                      <button aria-label="Move entry up" @click=${() => bridge.move(row.path, -1)}>
                        ↑</button
                      ><button
                        aria-label="Move entry down"
                        @click=${() => bridge.move(row.path, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <small>${row.fn?.title ?? JSON.stringify(row.value)?.slice(0, 80)}</small>
                  <div class="chips">
                    ${row.collections.map((path) => html`<button @click=${() => bridge.open(path, node)}>↗ ${path.at(-1)}</button>`)}${row.expressions.map((expr) => html`<button @click=${() => bridge.open(expr.path, node)}>∿ ${expr.path.at(-1)}</button>`)}
                  </div>
                </section>`,
            )
      }
      <footer>
        <small
          >${node.expression ? 'Original expression source' : `Page ${node.page + 1} of ${pages}`}</small
        >
        <div class="actions">
          <button
            aria-label="Previous scope page"
            ?disabled=${node.page === 0}
            @pointerdown=${this.stop}
            @click=${() => {
              node.page--;
              this.requestUpdate();
            }}
          >
            ◀</button
          ><button
            aria-label="Next scope page"
            ?disabled=${node.page >= pages - 1}
            @pointerdown=${this.stop}
            @click=${() => {
              node.page++;
              this.requestUpdate();
            }}
          >
            ▶
          </button>
        </div>
      </footer>`;
  }
}
if (!customElements.get('gc-scope-card')) customElements.define('gc-scope-card', ScopeCard);
export interface StructureGraph {
  ready: Promise<void>;
  focus(path: JsonPath): void;
  fit(): void;
  dispose(): void;
}
/** Rete owns movable scope cards; ribbons represent containment, never inferred execution edges. */
export function createGraph(
  host: HTMLElement,
  document: JsonValue,
  snapshot: SchemaSnapshot,
  config: StudioConfig,
  onSelect: (path: JsonPath) => void,
  onMove: (path: JsonPath, delta: number) => void,
  onDoc: (info: Inspection, event: { clientX: number; clientY: number }) => void,
): StructureGraph {
  const editor = new NodeEditor<Schemes>(),
    area = new AreaPlugin<Schemes, AreaExtra>(host),
    renderer = new LitPlugin<Schemes, AreaExtra>();
  editor.use(area);
  area.use(renderer);
  renderer.addPreset(
    Presets.classic.setup<Schemes, AreaExtra>({
      customize: {
        node: (data) => () => html`<gc-scope-card .node=${data.payload}></gc-scope-card>`,
      },
    }),
  );
  const nodes = new Map<string, ScopeNode>();
  let disposed = false;
  const svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('gc-sankey-links');
  host.appendChild(svg);
  let frame = 0;
  function draw(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      const bounds = host.getBoundingClientRect();
      svg.replaceChildren();
      for (const node of nodes.values()) {
        const parent = node.parentId
          ? [...nodes.values()].find((n) => n.id === node.parentId)
          : undefined;
        if (!parent?.element || !node.element) continue;
        const a = parent.element.getBoundingClientRect(),
          b = node.element.getBoundingClientRect();
        const x = a.right - bounds.left,
          y = a.top - bounds.top + 60,
          xx = b.left - bounds.left,
          yy = b.top - bounds.top + 60;
        const path = window.document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', `M${x},${y} C${x + 100},${y} ${xx - 100},${yy} ${xx},${yy}`);
        path.setAttribute('stroke', config.colors.categories.gcscript);
        path.setAttribute('stroke-width', '6');
        path.setAttribute('stroke-opacity', '.45');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
      }
    });
  }
  const bridge: GraphBridge = {
    select: onSelect,
    move: onMove,
    doc(path, event) {
      const rect =
        event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
      onDoc(
        inspectValue(document, snapshot.authoring, snapshot.catalog, path),
        event instanceof MouseEvent
          ? event
          : { clientX: rect?.right ?? 12, clientY: rect?.top ?? 12 },
      );
    },
    open(path, parent) {
      void add(path, parent);
    },
    close(node) {
      void (async () => {
        for (const child of [...nodes.values()])
          if (child.parentId === node.id) bridge.close(child);
        nodes.delete(JSON.stringify(node.scope.path));
        if (!disposed) await editor.removeNode(node.id);
        draw();
      })();
    },
  };
  async function add(path: JsonPath, parent?: ScopeNode): Promise<void> {
    if (disposed) return;
    const key = JSON.stringify(path);
    const existing = nodes.get(key);
    if (existing) {
      await AreaExtensions.zoomAt(area, [existing]);
      return;
    }
    const value = getAt(document, path);
    const scope =
      typeof value === 'string'
        ? { path, title: String(path.at(-1)), type: 'object' as const, rows: [] }
        : describeScope(document, path, snapshot.authoring, snapshot.catalog);
    const node = new ScopeNode(
      scope,
      bridge,
      config,
      parent?.id,
      typeof value === 'string' ? value : undefined,
    );
    nodes.set(key, node);
    await editor.addNode(node);
    if (disposed) return;
    const position = parent ? area.nodeViews.get(parent.id)?.position : undefined;
    await area.translate(node.id, {
      x: position ? position.x + 620 : 70,
      y: position
        ? position.y + [...nodes.values()].filter((n) => n.parentId === parent?.id).length * 80
        : 60,
    });
    draw();
  }
  area.addPipe((context) => {
    if (['nodetranslated', 'zoomed', 'translated', 'rendered'].includes(context.type)) draw();
    return context;
  });
  const observer = new ResizeObserver(draw);
  observer.observe(host);
  host.addEventListener('pointermove', draw);
  const rootPath = childCollections(document, []).find((path) => path.at(-1) === 'run') ?? [];
  const ready = add(rootPath).then(async () => {
    if (!disposed) await AreaExtensions.zoomAt(area, [...nodes.values()]);
  });
  return {
    ready,
    focus(path) {
      for (const node of nodes.values())
        if (node.scope.path.every((key, i) => path[i] === key)) {
          node.focusPath = path;
          const index = node.scope.rows.findIndex((row) =>
            row.path.every((key, i) => path[i] === key),
          );
          if (index >= 0) node.page = Math.floor(index / config.defaults.nodeChildrenLimit);
          void area.update('node', node.id);
        }
    },
    fit() {
      void AreaExtensions.zoomAt(area, [...nodes.values()]);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('pointermove', draw);
      svg.remove();
      area.destroy();
      nodes.clear();
    },
  };
}
