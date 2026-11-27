/**
 * How a person on another server is named beside their name (UAT 2026-11-27): "dennis · host",
 * never "dennis@http://192.0.2.7:3010" — the scheme is noise and the "@" made it read as an
 * e-mail address. The port stays: it is part of which server it is.
 */
export function originHost(origin: string): string {
  return origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
}
