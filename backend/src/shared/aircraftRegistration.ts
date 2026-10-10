/**
 * One airframe, one key (forgejo#256): a registration as the hull ranking,
 * the hull page and every write compare it — trimmed, inner whitespace
 * removed, upper case. "d-aixa" and "D-AIXA " are the same aircraft; the
 * ranking used to count them as two.
 *
 * Hyphens are kept: some registers write them and some do not ("N123AB",
 * "D-AIXA"), and dropping them could merge two registers' different marks.
 * Null for a value with nothing left.
 */
export function normalizeRegistration(raw: string | null | undefined): string | null {
  const reg = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  return reg || null;
}
