import type { ParseDomain } from "../../lib/api/parse";

/**
 * The document a user dropped, kept so it can be handed to another import
 * dialog without asking for it again (acceptance D1, 2026-09-26: a flight
 * mail dropped into the rail dialog must lead to the flight import with the
 * same file, not to a dead end).
 */
export type ImportDocument = { kind: "file"; file: File } | { kind: "text"; text: string };

const PARSE_DOMAINS: readonly ParseDomain[] = [
  "flight",
  "cruise",
  "lodging",
  "rail",
  "rental",
  "package",
];

/**
 * The domain the server says a document really is, when that is not the one
 * the dialog asked for — `domainMismatch.detected` on any parse answer.
 * Validated here, at the boundary: an unknown value is no handoff target.
 */
export function detectedOtherDomain(result: unknown): ParseDomain | null {
  if (typeof result !== "object" || result === null) return null;
  const mismatch = (result as { domainMismatch?: unknown }).domainMismatch;
  if (typeof mismatch !== "object" || mismatch === null) return null;
  const detected = (mismatch as { detected?: unknown }).detected;
  return PARSE_DOMAINS.find((d) => d === detected) ?? null;
}
