/**
 * A share key never leaves the server. It is what joins one member's entry to
 * the others' copies, and propagation trusts it only inside a share group —
 * but a key a client never sees is a key no client can replay, guess at or
 * paste into an import. Every request schema strips it (Zod drops unknown
 * keys); this replacer is the outbound half: `res.json` of ANY route, the
 * all-data export included, drops a `shareKey` property wherever it sits.
 */
export const SHARE_KEY_FIELD = "shareKey";

export function withoutShareKeys(key: string, value: unknown): unknown {
  return key === SHARE_KEY_FIELD ? undefined : value;
}
