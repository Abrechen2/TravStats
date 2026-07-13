/** Discord content, issue titles, notes and branch names are user-supplied. They get escaped, always. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A URL is only safe to interpolate into `href="..."` if its SCHEME is
 * http(s). `esc()` alone stops attribute breakout, but never inspects the
 * scheme — a `javascript:` or `data:` URL survives untouched and executes
 * when the owner clicks it. The config loader also rejects these at load
 * time (defense in depth), but the renderer must never trust that a caller
 * validated its input, so it checks again here. Returns the escaped, safe
 * href string, or `null` if the URL must not become a live link.
 */
export function escUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? esc(value) : null;
}

/**
 * Renders a jump link when `url` is present AND safe. When `url` is present
 * but its scheme is not http(s), the label still renders — as plain escaped
 * text, never as `<a>` — so the information survives without being
 * clickable.
 */
export function renderLink(url: string | null, label: string): string {
  if (url === null) return "";
  const safeHref = escUrl(url);
  return safeHref !== null ? `<a href="${safeHref}">${esc(label)}</a>` : esc(label);
}
