/**
 * What the bulk-refresh card says — exactly ONE of these.
 *
 * The card used to decide each message on its own, and they contradicted each
 * other: with no AeroDataBox key and nothing to refresh it said both "Du
 * benötigst einen AeroDataBox-Schlüssel …" and "Alle Flüge … sind aktuell"
 * (forgejo#88 acceptance, 2026-10-10). The order below is the answer to "what
 * matters most right now": a refusal or a failure first, then whether there is
 * anything to do at all, and only then whether a key is missing for it.
 */
export type BulkRefreshState =
  | { kind: "demo" }
  | { kind: "error"; message: string }
  | { kind: "loading" }
  | { kind: "upToDate" }
  | { kind: "needsKey"; pending: number }
  | { kind: "ready"; pending: number };

export function bulkRefreshState(input: {
  demoBlocked: boolean;
  previewError: string | null;
  remaining: number | null;
  hasProvider: boolean;
}): BulkRefreshState {
  if (input.demoBlocked) return { kind: "demo" };
  if (input.previewError) return { kind: "error", message: input.previewError };
  if (input.remaining === null) return { kind: "loading" };
  // Nothing to refresh: a missing key is beside the point.
  if (input.remaining === 0) return { kind: "upToDate" };
  if (!input.hasProvider) return { kind: "needsKey", pending: input.remaining };
  return { kind: "ready", pending: input.remaining };
}
