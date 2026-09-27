import { decryptApiKey, encryptApiKey } from "./encryption";

/**
 * The masked-echo protocol for stored secrets — ONE home, used by the global
 * API keys (`routes/admin/apiKeys.ts`) and the LLM provider key
 * (`routes/admin/parserSettings.ts`).
 *
 * A GET answers a stored key as "abcd****wxyz", never the key. The admin UI
 * PUTs its whole form state back, so a value that still contains "****" means
 * "unchanged — keep the stored key"; an empty string or null clears it.
 */

/** Empty, or the masked echo of a stored key — "use what is stored". */
export const looksMasked = (s: string | undefined | null): boolean => !s || s.includes("****");

/** Mask a stored (encrypted) key for display: "abcd****wxyz". */
export const maskKey = (encrypted: string | null | undefined): string | undefined => {
  const decrypted = decryptApiKey(encrypted);
  if (!decrypted) return undefined;
  if (decrypted.length <= 8) return "****";
  return decrypted.slice(0, 4) + "****" + decrypted.slice(-4);
};

/**
 * Encrypt an incoming key for storage, honouring the masked echo: undefined =
 * no update, null = clear, otherwise the ciphertext.
 */
export const encryptUnlessMasked = (incoming: string | null): string | null | undefined =>
  incoming && incoming.includes("****") ? undefined : encryptApiKey(incoming);
