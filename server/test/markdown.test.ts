import { describe, expect, it } from "vitest";
import { renderMarkdownLite, safeUrl } from "../src/lib/markdown.js";

describe("renderMarkdownLite", () => {
  it("formats bold, italic, strike and code", () => {
    expect(renderMarkdownLite("**bold** *it* _also_ ~~gone~~ `x < y`")).toBe(
      "<strong>bold</strong> <em>it</em> <em>also</em> <del>gone</del> <code>x &lt; y</code>",
    );
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdownLite('<img src=x onerror="alert(1)"><script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("links http(s) URLs safely and keeps trailing punctuation outside", () => {
    expect(renderMarkdownLite("see https://example.com/a?b=1&c=2.")).toBe(
      'see <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">https://example.com/a?b=1&amp;c=2</a>.',
    );
    expect(renderMarkdownLite("[docs](https://example.com/docs)")).toContain('href="https://example.com/docs"');
  });

  it("refuses javascript: and data: links", () => {
    const html = renderMarkdownLite("[click](javascript:alert(1)) [x](data:text/html,hi)");
    expect(html).not.toContain("<a");
    expect(html).toContain("[click](javascript:alert(1))");
  });

  it("can't break out of the href attribute", () => {
    const html = renderMarkdownLite('[x](https://e.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"\s*onmouseover=/);
  });

  it("doesn't format inside code spans or snake_case words", () => {
    expect(renderMarkdownLite("`**not bold**` my_var_name")).toBe("<code>**not bold**</code> my_var_name");
  });

  it("turns newlines into <br> and ignores injected placeholder bytes", () => {
    expect(renderMarkdownLite("a\nb")).toBe("a<br>b");
    expect(renderMarkdownLite("\u00000\u0000 hi")).toBe("0 hi");
  });

  it("only allows http, https and mailto", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
    expect(safeUrl("mailto:ada@huddle.dev")).toBe("mailto:ada@huddle.dev");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});
