/**
 * Direct mdast→React markdown renderer. Replaces the react-markdown /
 * remark-rehype pipeline with one switch over parsed nodes so streaming can
 * cache frozen blocks as React elements.
 *
 * Untrusted-output policy: link and image destinations pass a protocol
 * allowlist, images additionally require absolute HTTP(S), raw HTML renders as
 * literal text (no HTML enters the DOM), and KaTeX runs without trusted
 * commands. Fragment-anchor URLs fail the allowlist, so footnote references
 * and back-references render as plain text rather than in-page links.
 *
 * Merge-extensible node unions fall through the documented default (render
 * nothing) rather than ending in assertNever: grammars registered elsewhere
 * may add node types this renderer has no mapping for.
 */

import type * as Md from "mdast";
import type {} from "mdast-util-math";
import { normalizeUri } from "micromark-util-sanitize-uri";
import type { Key, ReactNode } from "react";
import { createElement, Fragment } from "react";
import { CodeBlock } from "./CodeBlock";
import type { PositionedBlock } from "./incremental";
import { renderTexToReact } from "./katex";
import { inlineCodeHttpUrl, remoteImageUrl, sanitizeUrl } from "./security";

/** Copy-button labels forwarded to fence CodeBlocks. */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel?: string | undefined;
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined;
}

/** Link/image reference targets collected from a document (first definition per identifier wins, as in CommonMark). */
export interface ReferenceTargets {
  /** Link/image definitions keyed by upper-cased identifier. */
  definitions: Map<string, Md.Definition>;
  /** Footnote definitions keyed by upper-cased identifier. */
  footnotes: Map<string, Md.FootnoteDefinition>;
}

export function createReferenceTargets(): ReferenceTargets {
  return { definitions: new Map(), footnotes: new Map() };
}

export function collectReferenceTargets(nodes: readonly Md.RootContent[], targets: ReferenceTargets): void {
  for (const node of nodes) {
    if (node.type === "definition") {
      const id = node.identifier.toUpperCase();
      if (!targets.definitions.has(id)) targets.definitions.set(id, node);
    } else if (node.type === "footnoteDefinition") {
      const id = node.identifier.toUpperCase();
      if (!targets.footnotes.has(id)) targets.footnotes.set(id, node);
    }
    if ("children" in node) collectReferenceTargets(node.children, targets);
  }
}

/**
 * File-mention affordance for inline code: the owner resolves an authored
 * token to the file it names, using its own vocabulary of real files — the
 * renderer never guesses at what looks like a path. Reserved for future use;
 * the current host does not provide a resolver.
 */
export interface MarkdownFileMentions {
  resolve(value: string): { open: () => void; label: string; title: string } | undefined;
}

/** One render pass's state: immutable options and targets plus the footnote numbering accumulated in document order. */
export interface MarkdownRenderContext {
  /** Streaming arm: fences render plain and TeX stays literal. */
  readonly streaming: boolean;
  /** Localized fence copy-button labels. */
  readonly codeLabels: MarkdownCodeLabels | undefined;
  /** Inline-code file mentions; absent wherever no opener vocabulary exists. */
  readonly fileMentions: MarkdownFileMentions | undefined;
  /** Inside an anchor's children: interactive mentions must not nest there. */
  readonly inLink?: boolean;
  /** Reference targets visible to this pass. */
  readonly targets: ReferenceTargets;
  /** Footnote identifiers in first-reference order; a footnote's number is its 1-based index here. */
  readonly footnoteOrder: string[];
  /** References rendered per identifier; drives the section's back-reference count. */
  readonly footnoteCounts: Map<string, number>;
}

export function renderBlocks(blocks: readonly PositionedBlock[], context: MarkdownRenderContext): ReactNode[] {
  return blocks.map((block) => renderNode(block.node, block.key, context)).filter((element) => element !== null);
}

export function wrapBlockChildren(elements: readonly ReactNode[], edges: boolean): ReactNode[] {
  const wrapped: ReactNode[] = [];
  for (const element of elements) {
    if (edges || wrapped.length > 0) wrapped.push("\n");
    wrapped.push(element);
  }
  if (edges && elements.length > 0) wrapped.push("\n");
  return wrapped;
}

/** A block child rendered for a parent that must tell paragraphs apart from other blocks. */
type BlockEntry = { paragraph: ReactNode[] } | { element: ReactNode };

function renderBlockEntries(blocks: readonly Md.RootContent[], context: MarkdownRenderContext): BlockEntry[] {
  const entries: BlockEntry[] = [];
  for (const [index, block] of blocks.entries()) {
    if (block.type === "paragraph") {
      entries.push({ paragraph: renderChildren(block.children, context) });
    } else {
      const element = renderNode(block, index, context);
      if (element !== null) entries.push({ element });
    }
  }
  return entries;
}

function renderChildren(nodes: readonly Md.RootContent[], context: MarkdownRenderContext): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index, context));
}

function renderNode(node: Md.RootContent, key: Key, context: MarkdownRenderContext): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "paragraph":
      return <p key={key}>{renderChildren(node.children, context)}</p>;
    case "heading":
      return createElement(`h${node.depth}`, { key }, ...renderChildren(node.children, context));
    case "blockquote":
      return (
        <blockquote key={key}>
          {wrapBlockChildren(
            renderChildren(node.children, context).filter((child) => child !== null),
            true,
          )}
        </blockquote>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "break":
      return (
        <Fragment key={key}>
          <br />
          {"\n"}
        </Fragment>
      );
    case "strong":
      return <strong key={key}>{renderChildren(node.children, context)}</strong>;
    case "emphasis":
      return <em key={key}>{renderChildren(node.children, context)}</em>;
    case "delete":
      return <del key={key}>{renderChildren(node.children, context)}</del>;
    case "inlineCode": {
      const value = node.value.replace(/\r?\n|\r/g, " ");
      const href = inlineCodeHttpUrl(value);
      if (href !== undefined) return <code key={key}>{renderSafeLink(href, [value], "link")}</code>;
      return <code key={key}>{value}</code>;
    }
    case "html":
      // No HTML parser enters the pipeline: raw HTML stays literal text.
      return node.value;
    case "code":
      return renderCode(node, key, context);
    case "math":
      return <Fragment key={key}>{renderTexToReact(node.value, true)}</Fragment>;
    case "inlineMath":
      return <Fragment key={key}>{renderTexToReact(node.value, false)}</Fragment>;
    case "list":
      return renderList(node, key, context);
    case "listItem":
      return renderListItem(node, listItemLoose(node), key, context);
    case "table":
      return renderTable(node, key, context);
    case "link":
      return renderAnchor(node.url, renderChildren(node.children, { ...context, inLink: true }), key);
    case "linkReference":
      return renderLinkReference(node, key, context);
    case "image":
      return renderImage(node.url, node.alt ?? "", key);
    case "imageReference":
      return renderImageReference(node, key, context);
    case "footnoteReference":
      return renderFootnoteReference(node, key, context);
    case "definition":
    case "footnoteDefinition":
      return null;
    default:
      return null;
  }
}

function renderCode(node: Md.Code, key: Key, context: MarkdownRenderContext): ReactNode {
  const language = node.lang ?? undefined;
  if (node.value === "") {
    return (
      <pre key={key}>
        <code className={language === undefined ? undefined : `language-${language}`} />
      </pre>
    );
  }
  const lang = language === undefined ? undefined : /^[\w-]+/.exec(language)?.[0];
  if (!context.streaming && lang === "math") {
    return <Fragment key={key}>{renderTexToReact(`${node.value}\n`, true)}</Fragment>;
  }
  return (
    <CodeBlock
      key={key}
      code={`${node.value}\n`}
      lang={context.streaming ? undefined : lang}
      copyLabel={context.codeLabels?.copyLabel}
      copiedLabel={context.codeLabels?.copiedLabel}
    />
  );
}

function listLoose(list: Md.List): boolean {
  return (list.spread ?? false) || list.children.some(listItemLoose);
}

function listItemLoose(item: Md.ListItem): boolean {
  return item.spread ?? item.children.length > 1;
}

function renderList(node: Md.List, key: Key, context: MarkdownRenderContext): ReactNode {
  const loose = listLoose(node);
  const properties: { start?: number; className?: string } = {};
  if (typeof node.start === "number" && node.start !== 1) properties.start = node.start;
  if (node.children.some((item) => typeof item.checked === "boolean")) {
    properties.className = "contains-task-list";
  }
  return createElement(
    node.ordered === true ? "ol" : "ul",
    { key, ...properties },
    ...node.children.map((item, index) => renderListItem(item, loose, index, context)),
  );
}

function renderListItem(item: Md.ListItem, loose: boolean, key: Key, context: MarkdownRenderContext): ReactNode {
  const entries = renderBlockEntries(item.children, context);
  const task = typeof item.checked === "boolean";
  if (task) {
    const checkbox = <input key="task-checkbox" type="checkbox" checked={item.checked === true} disabled />;
    const head = entries[0];
    if (head !== undefined && "paragraph" in head) {
      head.paragraph = head.paragraph.length > 0 ? [checkbox, " ", ...head.paragraph] : [checkbox];
    } else {
      entries.unshift({ paragraph: [checkbox] });
    }
  }
  const parts: ReactNode[] = [];
  for (const [index, entry] of entries.entries()) {
    const isParagraph = "paragraph" in entry;
    if (loose || index !== 0 || !isParagraph) parts.push("\n");
    if (!isParagraph) parts.push(entry.element);
    else if (loose) parts.push(<p key={`p-${index}`}>{entry.paragraph}</p>);
    else parts.push(<Fragment key={`p-${index}`}>{entry.paragraph}</Fragment>);
  }
  const tail = entries[entries.length - 1];
  if (tail !== undefined && (loose || !("paragraph" in tail))) parts.push("\n");
  return (
    <li key={key} className={task ? "task-list-item" : undefined}>
      {parts}
    </li>
  );
}

function renderTable(node: Md.Table, key: Key, context: MarkdownRenderContext): ReactNode {
  const align = node.align ?? null;
  const [headRow, ...bodyRows] = node.children;
  return (
    <div key={key} className="md-table-scroll">
      <table>
        {headRow !== undefined && <thead>{renderTableRow(headRow, "th", align, 0, context)}</thead>}
        {bodyRows.length > 0 && (
          <tbody>{bodyRows.map((row, index) => renderTableRow(row, "td", align, index + 1, context))}</tbody>
        )}
      </table>
    </div>
  );
}

function renderTableRow(
  row: Md.TableRow,
  cellTag: "th" | "td",
  align: readonly Md.AlignType[] | null,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const length = align === null ? row.children.length : align.length;
  const cells: ReactNode[] = [];
  for (let index = 0; index < length; index++) {
    const cell = row.children[index];
    const alignValue = align?.[index];
    cells.push(
      createElement(
        cellTag,
        { key: index, style: alignValue == null ? undefined : { textAlign: alignValue } },
        ...(cell === undefined ? [] : renderChildren(cell.children, context)),
      ),
    );
  }
  return <tr key={key}>{cells}</tr>;
}

/** Anchor over an already-authored href: allowlisted or unwrapped, external links get the safe attributes. */
function renderSafeLink(href: string, children: ReactNode[], key: Key): ReactNode {
  const safeHref = sanitizeUrl(href);
  if (safeHref === "") return <Fragment key={key}>{children}</Fragment>;
  // No target=_blank: middle-click / "open in new tab" would bypass the host
  // confirmation gate and Rust open_url allowlist. Navigation is preventDefault'd.
  return (
    <a key={key} href={safeHref}>
      {children}
    </a>
  );
}

/** Anchor over a parsed markdown destination, normalized before the allowlist sees it. */
function renderAnchor(url: string, children: ReactNode[], key: Key): ReactNode {
  return renderSafeLink(normalizeUri(url), children, key);
}

function renderImage(url: string, alt: string, key: Key): ReactNode {
  const imageSrc = remoteImageUrl(sanitizeUrl(normalizeUri(url)));
  if (imageSrc === undefined) {
    return (
      <span key={key} className="md-image-alt">
        {alt}
      </span>
    );
  }
  return (
    <img
      key={key}
      className="md-image"
      src={imageSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

function referenceSuffix(node: Md.LinkReference | Md.ImageReference): string {
  if (node.referenceType === "collapsed") return "][]";
  if (node.referenceType === "full") return `][${node.label ?? node.identifier}]`;
  return "]";
}

function renderLinkReference(node: Md.LinkReference, key: Key, context: MarkdownRenderContext): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase());
  if (definition === undefined) {
    return (
      <Fragment key={key}>
        {"["}
        {renderChildren(node.children, context)}
        {referenceSuffix(node)}
      </Fragment>
    );
  }
  return renderAnchor(definition.url, renderChildren(node.children, { ...context, inLink: true }), key);
}

function renderImageReference(node: Md.ImageReference, key: Key, context: MarkdownRenderContext): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase());
  if (definition === undefined) return `![${node.alt ?? ""}${referenceSuffix(node)}`;
  return renderImage(definition.url, node.alt ?? "", key);
}

function renderFootnoteReference(node: Md.FootnoteReference, key: Key, context: MarkdownRenderContext): ReactNode {
  const id = node.identifier.toUpperCase();
  const seen = context.footnoteCounts.get(id);
  if (seen === undefined) context.footnoteOrder.push(id);
  context.footnoteCounts.set(id, (seen ?? 0) + 1);
  return <sup key={key}>{String(context.footnoteOrder.indexOf(id) + 1)}</sup>;
}

/**
 * Render the trailing footnote section for every footnote referenced during
 * the pass, in first-reference order, with one plain-text back-reference
 * marker per rendered reference.
 */
export function renderFootnoteSection(context: MarkdownRenderContext): ReactNode | null {
  const items: ReactNode[] = [];
  for (const id of context.footnoteOrder) {
    const definition = context.targets.footnotes.get(id);
    if (definition === undefined) continue;
    const count = context.footnoteCounts.get(id) ?? 0;
    const backrefs: ReactNode[] = [];
    for (let reference = 1; reference <= count; reference++) {
      if (backrefs.length > 0) backrefs.push(" ");
      backrefs.push("↩");
      if (reference > 1) backrefs.push(<sup key={`re-${reference}`}>{String(reference)}</sup>);
    }
    const entries = renderBlockEntries(definition.children, context);
    const tail = entries[entries.length - 1];
    const body: ReactNode[] = entries.map((entry, index) =>
      "paragraph" in entry ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: static footnote paragraphs, never reordered
        <p key={`p-${index}`}>
          {entry.paragraph}
          {entry === tail && <> {backrefs}</>}
        </p>
      ) : (
        entry.element
      ),
    );
    if (tail === undefined || !("paragraph" in tail)) body.push(...backrefs);
    items.push(
      <li key={id} id={`user-content-fn-${normalizeUri(id.toLowerCase())}`}>
        {wrapBlockChildren(body, true)}
      </li>,
    );
  }
  if (items.length === 0) return null;
  return (
    <section key="footnotes" data-footnotes className="footnotes">
      <h2 id="footnote-label" className="sr-only">
        Footnotes
      </h2>
      <ol>{items}</ol>
    </section>
  );
}
