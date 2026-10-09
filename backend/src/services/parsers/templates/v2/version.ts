/**
 * Version strings for v2 templates, compared as numbers.
 *
 * The v1 registry orders airline templates with `>` on strings, which is the
 * trap the 2026-09-17 plan names: "2024-10" sorts before "2024-9", and
 * "2.10.0" before "2.9.0". v2 validates the format first and then compares
 * component by component.
 *
 * One grammar covers both forms in use: semver (`2.7.0`, `2.7.0-rc.10`) and
 * the date versions the template repository writes (`2026.10.01`,
 * `2026.10.01.2`). Two to four numeric components, then an optional semver
 * pre-release and build suffix. A missing component counts as zero, so
 * `1.2` equals `1.2.0`, and leading zeros carry no weight (`2026.10.01`
 * equals `2026.10.1`).
 */

const VERSION_RE =
  /^(\d+(?:\.\d+){1,3})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedVersion {
  readonly core: readonly string[];
  readonly prerelease: readonly string[];
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(version);
  if (!match) return null;
  return {
    core: match[1].split("."),
    prerelease: match[2] ? match[2].split(".") : [],
  };
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

/**
 * Compare two non-negative digit strings exactly, at any length.
 *
 * Done on the digits rather than through `Number` so a twenty-digit component
 * cannot lose precision and compare equal to its neighbour.
 */
function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

const NUMERIC_ID = /^\d+$/;

/** Semver §11: numeric identifiers sort below alphanumeric ones. */
function compareIdentifier(a: string, b: string): number {
  const aNum = NUMERIC_ID.test(a);
  const bNum = NUMERIC_ID.test(b);
  if (aNum && bNum) return compareDigits(a, b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // A release outranks every pre-release of the same core: 2.7.0 > 2.7.0-rc.10.
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0;
    return a.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const cmp = compareIdentifier(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * -1, 0 or 1. Throws on a string `isValidVersion` rejects — every caller in
 * the loader holds versions the envelope schema has already validated, so an
 * invalid one here is a programming error, not input.
 */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  const length = Math.max(x.core.length, y.core.length);
  for (let i = 0; i < length; i++) {
    const cmp = compareDigits(x.core[i] ?? "0", y.core[i] ?? "0");
    if (cmp !== 0) return cmp;
  }
  return comparePrerelease(x.prerelease, y.prerelease);
}
