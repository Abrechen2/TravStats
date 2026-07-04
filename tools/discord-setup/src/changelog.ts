/**
 * Strip a pre-release suffix so an RC/beta version maps to its base changelog
 * entry: "2.3.0-rc.1" -> "2.3.0", "2.3.0" -> "2.3.0".
 */
export function stripPrerelease(version: string): string {
  return version.replace(/-.*$/, "");
}

/**
 * Extract the changelog body for a given version from a Keep-a-Changelog
 * document. Matches a `## [X.Y.Z] ...` or `## X.Y.Z ...` heading (brackets
 * optional) for the base version and returns everything up to the next
 * `## ` version heading. Returns null when the version has no entry.
 */
export function extractChangelogEntry(changelog: string, version: string): string | null {
  const base = stripPrerelease(version);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(`^##\\s+\\[?${escaped}\\b`);
  const lines = changelog.split(/\r?\n/);

  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break; // next version heading
    body.push(lines[i]);
  }

  const text = body.join("\n").trim();
  return text.length > 0 ? text : null;
}
