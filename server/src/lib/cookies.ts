/**
 * Parses a `Cookie` header into a name -> value map.
 *
 * @param header - The raw header, possibly undefined.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}
