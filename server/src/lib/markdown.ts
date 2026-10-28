const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ESCAPES).map(([raw, escaped]) => [escaped, raw]),
);

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

/**
 * Escapes the five HTML-significant characters.
 *
 * @param text - Untrusted text.
 * @returns Text that is safe in element content and quoted attributes.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function unescapeHtml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_UNESCAPES[entity] ?? entity);
}

/**
 * Returns a normalised URL when it uses an allowed protocol (http, https, mailto), else null.
 *
 * @param raw - The URL as the user typed it (unescaped).
 */
export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function anchor(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
}

/**
 * Renders "markdown-lite" to sanitized HTML.
 *
 * Supported: `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `code` ``,
 * `[label](https://url)`, bare http(s) links and line breaks. The input is HTML-escaped
 * *before* any formatting is applied, and only http, https and mailto links survive, so
 * the output can't carry markup, event handlers or `javascript:` URLs.
 *
 * @param input - Raw message text from a user.
 * @returns An HTML fragment safe to inject with `innerHTML`.
 */
export function renderMarkdownLite(input: string): string {
  const slots: string[] = [];
  const stash = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;

  // eslint-disable-next-line no-control-regex
  let text = escapeHtml(input.replace(/\u0000/g, "").replace(/\r\n?/g, "\n"));

  // Code spans first: nothing inside them is formatted.
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => stash(`<code>${code}</code>`));

  // [label](url)
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const url = safeUrl(unescapeHtml(href));
    return url ? stash(anchor(url, label)) : match;
  });

  // Bare links. Trailing punctuation is usually sentence punctuation, not part of the URL.
  text = text.replace(/\bhttps?:\/\/[^\s\u0000]+/g, (match) => {
    const trimmed = match.replace(/(?:[.,!?;:)\]]|&quot;|&#39;)+$/, "");
    const rest = match.slice(trimmed.length);
    const url = safeUrl(unescapeHtml(trimmed));
    return url ? stash(anchor(url, trimmed)) + rest : match;
  });

  text = text
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "<del>$1</del>")
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");

  // Restore stashed fragments (a link label may itself contain a code placeholder).
  let previous: string;
  do {
    previous = text;
    text = text.replace(PLACEHOLDER, (_m, index: string) => slots[Number(index)] ?? "");
  } while (text !== previous);
  return text;
}
