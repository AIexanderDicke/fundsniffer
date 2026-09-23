import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  byId,
  cellsOf,
  decodeEntities,
  extractJsonObject,
  findAll,
  findFirst,
  hasClass,
  innerText,
  parseHtml,
  textOf,
} from "../src/parse/html.ts";

const HTML = `<!doctype html>
<html>
  <body>
    <!-- a comment -->
    <div id="outer" class="a b">
      <h1>Hello &amp; <b>World</b></h1>
      <table>
        <tr><td>Label</td><td>0,20&nbsp;%</td></tr>
        <tr><td colspan="2">spanned</td></tr>
      </table>
      <img src="https://x/y?a=1&amp;b=2">
      <script>const chartUrls = {"A":"\\u003cimg src=\\"https://x?labels=a;b&values=1;2\\"\\u003e"};</script>
    </div>
  </body>
</html>`;

describe("parseHtml", () => {
  it("builds a tree with attributes and void elements", () => {
    const root = parseHtml(HTML);
    const outer = byId(root, "outer");
    assert.ok(outer);
    assert.equal(outer.attrs.class, "a b");
    assert.equal(hasClass(outer, "b"), true);
    assert.equal(hasClass(outer, "c"), false);

    const image = findFirst(outer, (element) => element.tag === "img");
    assert.equal(image?.attrs.src, "https://x/y?a=1&amp;b=2");
  });

  it("keeps script content as raw text", () => {
    const root = parseHtml(HTML);
    const script = findFirst(root, (element) => element.tag === "script");
    assert.ok(script);
    assert.match(textOf(script), /const chartUrls/);
  });

  it("ignores comments and doctype", () => {
    const root = parseHtml(HTML);
    const text = textOf(root);
    assert.doesNotMatch(text, /a comment/);
    assert.doesNotMatch(text, /doctype/i);
  });
});

describe("text helpers", () => {
  it("collapses whitespace and decodes entities", () => {
    const root = parseHtml(HTML);
    const heading = findFirst(root, (element) => element.tag === "h1");
    assert.equal(heading ? innerText(heading) : "", "Hello & World");
  });

  it("collects table cells and drops non-cells", () => {
    const root = parseHtml(HTML);
    const rows = findAll(root, (element) => element.tag === "tr");
    assert.equal(rows.length, 2);
    assert.equal(cellsOf(rows[0]!).length, 2);
    assert.equal(cellsOf(rows[1]!).length, 1);
    assert.equal(innerText(cellsOf(rows[1]!)[0]!), "spanned");
  });

  it("decodes named and numeric entities", () => {
    assert.equal(decodeEntities("A&#252; &amp; &#x41;"), "Aü & A");
  });
});

describe("extractJsonObject", () => {
  it("extracts the balanced object containing the needle", () => {
    const root = parseHtml(HTML);
    const script = findFirst(root, (element) => element.tag === "script");
    const json = extractJsonObject(textOf(script!), '"A"');
    assert.ok(json);
    assert.deepEqual(JSON.parse(json), {
      A: '<img src="https://x?labels=a;b&values=1;2">',
    });
  });

  it("returns null when the needle is missing", () => {
    assert.equal(extractJsonObject("var x = {};", '"Missing"'), null);
  });
});
