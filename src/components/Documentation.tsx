import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Inspection, TypeTree } from '../core/schema/inspector';
import { describeSchema } from '../core/schema/inspector';
import type { SchemaBundle } from '../core/schema/types';
import type { StudioConfig } from '../config';

/** All schema-supplied HTML/Markdown goes through one sanitizer. */
export function renderMarkdown(source: string, docsUrl: string): string {
  const raw = source.replace(
    /&lt;(\/?(?:a|br|p|strong|em|b|i|code|pre|ul|ol|li|h[1-6]|blockquote)\b[\s\S]*?)&gt;/gi,
    (_, tag: string) =>
      '<' +
      tag
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&') +
      '>',
  );
  const template = document.createElement('template');
  template.innerHTML = DOMPurify.sanitize(marked.parse(raw, { async: false, gfm: true }), {
    FORBID_TAGS: ['style', 'iframe'],
    FORBID_ATTR: ['style'],
  });
  for (const link of template.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href') ?? '', docsUrl);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
        link.removeAttribute('href');
        continue;
      }
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } catch {
      link.removeAttribute('href');
    }
  }
  return template.innerHTML;
}
export function Markdown({ text, config }: { text: string; config: StudioConfig }) {
  return (
    <div
      className="studio-doc-body"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text, config.docsUrl) }}
    />
  );
}
function TypeNode({ node, config }: { node: TypeTree; config: StudioConfig }) {
  return (
    <details className="studio-type-tree">
      <summary>{node.label}</summary>
      <Markdown text={node.description} config={config} />
      {node.reference ? (
        <a
          href={config.docsUrl + node.reference.replace('.json', '.html')}
          target="_blank"
          rel="noreferrer"
        >
          Open {node.reference} ↗
        </a>
      ) : null}
      {node.children.map((child, i) => (
        <TypeNode key={child.label + i} node={child} config={config} />
      ))}
    </details>
  );
}
export function Documentation({
  info,
  bundle,
  config,
}: {
  info: Inspection;
  bundle: SchemaBundle;
  config: StudioConfig;
}) {
  const limits = {
    depth: config.limits.docDepth,
    nodes: config.limits.docNodes,
    chars: config.limits.docCharacters,
  };
  return (
    <article className="schema-md">
      <header className="studio-doc-head">
        <div className="studio-doc-kicker">{info.kind}</div>
        <h2 className="studio-doc-title">{info.title}</h2>
        <code>{info.functionName}</code>
      </header>
      <Markdown text={info.description} config={config} />
      <div className="studio-doc-return">
        <b>Returns: </b>
        {info.returnType}
      </div>
      <TypeNode
        node={describeSchema(bundle, info.returnSchema ?? info.schema, limits)}
        config={config}
      />
      {info.examples[0] !== undefined ? (
        <details className="mt-3">
          <summary>Schema example</summary>
          <pre>{JSON.stringify(info.examples[0], null, 2)}</pre>
        </details>
      ) : null}
      {info.file ? (
        <a
          href={
            info.kind === 'Build-stage directive'
              ? 'https://github.com/GameChangerFinance/gamechanger#build-multi-file-gcscript-projects'
              : config.docsUrl + info.file.replace('.json', '.html')
          }
          target="_blank"
          rel="noreferrer"
        >
          Documentation ↗
        </a>
      ) : null}
    </article>
  );
}
