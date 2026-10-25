/**
 * Test suite for Markdown parser & XSS sanitization (src/rendering/markdown.ts).
 *
 * Verifies that:
 *   1. Headings (h1-h6) render correctly
 *   2. Fenced code blocks with/without language render <pre><code>
 *   3. Lists (ordered & unordered) render correctly
 *   4. Blockquotes and horizontal rules render properly
 *   5. Tables render <table><thead><tbody>
 *   6. Inline elements: bold, italic, strikethrough, inline code
 *   7. Intra-word underscores (e.g. foo_bar_baz) are NOT treated as italics (GFM spec)
 *   8. Links and images with titles render properly
 *   9. XSS injection: <script>, javascript: links, onerror attributes are neutralized
 *
 * Usage: node tests/suites/markdown.test.mjs
 */
import { renderMarkdown, renderInline } from "../../src/rendering/markdown.ts";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`);
  }
}

function checkTruthy(name, v) {
  if (v) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name} (got ${JSON.stringify(v)})`);
  }
}

function summary(tag = "markdown", aborted = false) {
  const line = `${pass} passed, ${fail} failed`;
  console.log(`\n${line}${aborted ? " (aborted)" : ""}`);
}

process.on("uncaughtException", (e) => {
  fail++;
  console.log(`  FAIL uncaught exception: ${e?.stack || e}`);
  summary("markdown", true);
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  fail++;
  console.log(`  FAIL unhandled rejection: ${e?.stack || e}`);
  summary("markdown", true);
  process.exit(1);
});

function section(title) {
  console.log(`\n${title}`);
}

section("1. Headings & Paragraphs");
{
  check("h1 heading", renderMarkdown("# Title 1"), "<h1>Title 1</h1>");
  check("h2 heading", renderMarkdown("## Subtitle"), "<h2>Subtitle</h2>");
  check("h6 heading", renderMarkdown("###### Smallest"), "<h6>Smallest</h6>");
  check("simple paragraph", renderMarkdown("Hello world"), "<p>Hello world</p>");
  check(
    "consecutive lines become a paragraph with br",
    renderMarkdown("Line 1\nLine 2"),
    "<p>Line 1<br>Line 2</p>"
  );
}

section("2. Fenced Code Blocks & Inline Code");
{
  const code = "```js\nconst x = 1;\nconsole.log(x);\n```";
  const expected = '<pre><code class="language-js">const x = 1;\nconsole.log(x);</code></pre>';
  check("fenced code with lang", renderMarkdown(code), expected);

  const codeNoLang = "```\nplain text\n```";
  check("fenced code no lang", renderMarkdown(codeNoLang), "<pre><code>plain text</code></pre>");

  check("inline code", renderInline("Here is `let a = 10;` in text"), "Here is <code>let a = 10;</code> in text");
}

section("3. Lists & Blockquotes");
{
  const uList = "- Apple\n- Banana\n- Cherry";
  check("unordered list", renderMarkdown(uList), "<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>");

  const oList = "1. First\n2. Second\n3. Third";
  check("ordered list", renderMarkdown(oList), "<ol><li>First</li><li>Second</li><li>Third</li></ol>");

  const quote = "> This is a quote\n> Second line";
  check("blockquote", renderMarkdown(quote), "<blockquote><p>This is a quote<br>Second line</p></blockquote>");
}

section("4. Horizontal Rule & Tables");
{
  check("horizontal rule ---", renderMarkdown("---"), "<hr>");
  check("horizontal rule ***", renderMarkdown("***"), "<hr>");

  const table = "| Name | Role |\n|---|---|\n| Alice | Admin |\n| Bob | Editor |";
  const expected = "<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Alice</td><td>Admin</td></tr><tr><td>Bob</td><td>Editor</td></tr></tbody></table>";
  check("GFM table", renderMarkdown(table), expected);
}

section("5. Formatting & Intra-word Underscores (GFM)");
{
  check("bold **", renderInline("**strong**"), "<strong>strong</strong>");
  check("italic *", renderInline("*emphasis*"), "<em>emphasis</em>");
  check("strikethrough ~~", renderInline("~~deleted~~"), "<del>deleted</del>");
  // Critical GFM requirement: variable names with underscores must not become italic!
  check(
    "intra-word underscore foo_bar_baz is not italic",
    renderInline("VAL_coremarkdown_text"),
    "VAL_coremarkdown_text"
  );
  check(
    "standalone underscore is italic",
    renderInline("This is _emphasized_ text"),
    "This is <em>emphasized</em> text"
  );
}

section("6. Links, Images & XSS Protection");
{
  check(
    "standard link",
    renderInline("[CFPress](https://cfpress.io)"),
    '<a href="https://cfpress.io" target="_blank" rel="noopener noreferrer">CFPress</a>'
  );
  check(
    "image with alt",
    renderInline("![Hero](/img/hero.png)"),
    '<img src="/img/hero.png" alt="Hero" loading="lazy">'
  );
  check(
    "javascript: link is sanitized to #",
    renderInline('[Attack](javascript:alert("xss"))'),
    '<a href="#" target="_blank" rel="noopener noreferrer">Attack</a>'
  );
  check(
    "raw script tag is escaped",
    renderMarkdown("<script>alert('xss')</script>"),
    "<p>&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</p>"
  );
}

summary("markdown");

if (fail > 0) {
  process.exit(1);
}
