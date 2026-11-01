/**
 * Field checks the server pages draw under the field, in the design's voice
 * (§5.9). The server validates again; these exist so a typo is named before the
 * save button is pressed, not after a round trip.
 */

/** An address needs its scheme: the server takes http(s) only. */
export function addressProblem(value: string): "scheme" | null {
  const v = value.trim();
  if (v === "") return null;
  return /^https?:\/\/\S+$/i.test(v) ? null : "scheme";
}

/** A passkey domain is a bare host name: no scheme, no path, no port, no IP address. */
export function rpIdProblem(value: string): "domain" | null {
  const v = value.trim();
  if (v === "") return null;
  if (/[/:\s]/.test(v)) return "domain";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return "domain";
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(v)
    ? null
    : "domain";
}

/** One origin per line; blank lines are how people separate things, not entries. */
export function parseOrigins(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The first line that is not an address, or null. */
export function originsProblem(text: string): "scheme" | null {
  return parseOrigins(text).some((o) => addressProblem(o) !== null) ? "scheme" : null;
}
