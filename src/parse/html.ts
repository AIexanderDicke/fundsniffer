/**
 * A tiny, dependency-free HTML parser.
 *
 * We only need a tolerant tree to pull a handful of tables, `<img src>` values
 * and embedded JSON out of a finanzen.net page. This parser is not spec
 * complete: it handles comments, doctype, void elements, quoted attributes and
 * raw-text `<script>` / `<style>` elements, which is all the site throws at us.
 */

export interface HtmlElement {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export interface HtmlText {
  type: "text";
  text: string;
}

export type HtmlNode = HtmlElement | HtmlText;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  let index = 0;

  const pushText = (text: string) => {
    if (text.length === 0) return;
    stack[stack.length - 1]!.children.push({ type: "text", text });
  };

  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    if (lt > index) pushText(html.slice(index, lt));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    if (html[lt + 1] === "/") {
      const end = html.indexOf(">", lt);
      if (end === -1) {
        index = html.length;
        continue;
      }
      const tag = html
        .slice(lt + 2, end)
        .trim()
        .toLowerCase()
        .split(/[\s/]+/)[0]!;
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth]!.tag === tag) {
          stack.length = depth;
          break;
        }
      }
      index = end + 1;
      continue;
    }

    const end = findTagEnd(html, lt + 1);
    const { tag, attrs, selfClosing } = parseTag(html.slice(lt + 1, end));
    const node: HtmlElement = { type: "element", tag, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    index = end + 1;

    if (RAW_TEXT_ELEMENTS.has(tag) && !selfClosing) {
      const close = html.toLowerCase().indexOf(`</${tag}`, index);
      const textEnd = close === -1 ? html.length : close;
      const text = html.slice(index, textEnd);
      if (text.length > 0) node.children.push({ type: "text", text });
      index = close === -1 ? html.length : html.indexOf(">", close) + 1;
      continue;
    }

    if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push(node);
  }

  return root;
}

function findTagEnd(html: string, from: number): number {
  let quote = "";
  for (let index = from; index < html.length; index += 1) {
    const char = html[index]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return html.length;
}

function parseTag(raw: string): {
  tag: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
} {
  let rest = raw.trim();
  const selfClosing = rest.endsWith("/");
  if (selfClosing) rest = rest.slice(0, -1);

  const spaceIndex = rest.search(/\s/);
  const tag = (spaceIndex === -1 ? rest : rest.slice(0, spaceIndex)).toLowerCase();
  const attrs: Record<string, string> = {};

  if (spaceIndex !== -1) {
    const attrPattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    const source = rest.slice(spaceIndex);
    let match = attrPattern.exec(source);
    while (match !== null) {
      const name = match[1]!.toLowerCase();
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[name] = value;
      match = attrPattern.exec(source);
    }
  }

  return { tag, attrs, selfClosing };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "\u00a9",
  reg: "\u00ae",
  auml: "\u00e4",
  ouml: "\u00f6",
  uuml: "\u00fc",
  Auml: "\u00c4",
  Ouml: "\u00d6",
  Uuml: "\u00dc",
  szlig: "\u00df",
  euro: "\u20ac",
  hellip: "\u2026",
  ndash: "\u2013",
  mdash: "\u2014",
  times: "\u00d7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  deg: "\u00b0",
  middot: "\u00b7",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Text content of a node, entities decoded and whitespace collapsed. */
export function textOf(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textOf).join("");
}

export function innerText(node: HtmlNode): string {
  return normalizeSpace(decodeEntities(textOf(node)));
}

export function findFirst(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement | null {
  if (node.type === "element") {
    if (predicate(node)) return node;
    for (const child of node.children) {
      const found = findFirst(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

export function findAll(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean,
  results: HtmlElement[] = [],
): HtmlElement[] {
  if (node.type === "element") {
    if (predicate(node)) results.push(node);
    for (const child of node.children) findAll(child, predicate, results);
  }
  return results;
}

export function byId(root: HtmlNode, id: string): HtmlElement | null {
  return findFirst(root, (element) => element.attrs.id === id);
}

export function hasClass(element: HtmlElement, className: string): boolean {
  return (element.attrs.class ?? "").split(/\s+/).includes(className);
}

/** Direct `<td>`/`<th>` children of a row, in document order. */
export function cellsOf(row: HtmlElement): HtmlElement[] {
  return row.children.filter(
    (child): child is HtmlElement =>
      child.type === "element" && (child.tag === "td" || child.tag === "th"),
  );
}

/**
 * Extract the first balanced `{...}` object from `text` that contains `needle`.
 * Used for the inline `chartUrls = {...}` JavaScript payloads.
 */
export function extractJsonObject(text: string, needle: string): string | null {
  const at = text.indexOf(needle);
  if (at === -1) return null;

  const assignment = text.lastIndexOf("=", at);
  const braceAfterAssignment = assignment === -1 ? -1 : text.indexOf("{", assignment);
  const start =
    braceAfterAssignment !== -1 && braceAfterAssignment < at
      ? braceAfterAssignment
      : text.lastIndexOf("{", at);
  if (start === -1) return null;

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
