/**
 * Where the ECB reference rates are fetched from (GitHub #391).
 *
 * Every source speaks the Frankfurter shape (`/{date}?from=&to=`), so the
 * rate client only needs a base URL. The admin picks a primary and an optional
 * fallback; both resolve to a base URL here and the resolver keeps reporting
 * `source: "ecb"` — the data is the ECB's whichever mirror served it.
 */
export const FX_SOURCE_IDS = ["frankfurter", "allratestoday", "custom"] as const;
export type FxSourceId = (typeof FX_SOURCE_IDS)[number];
export const FX_FALLBACK_IDS = ["none", ...FX_SOURCE_IDS] as const;
export type FxFallbackId = (typeof FX_FALLBACK_IDS)[number];

export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1";
export const ALLRATESTODAY_URL = "https://allratestoday.com/api/compat/frankfurter";

export interface FxSourceChoice {
  source: string | null | undefined;
  customUrl: string | null | undefined;
}

/**
 * Validate and normalise a custom base URL: http(s) only, no credentials, no
 * query or fragment. There is deliberately no private-address block — the
 * admin sets this, and a self-hosted Frankfurter on the LAN is the main use
 * case (same stance as the Immich and LLM base URLs).
 */
export function normalizeFxCustomUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  return parsed.toString().replace(/\/+$/, "");
}

/**
 * The base URL a stored choice points at, or null for "none" / an unusable
 * choice (unknown id, custom without a valid URL). An unusable choice must
 * read as "this source is absent", never throw into the rate chain.
 */
export function fxSourceUrl(choice: FxSourceChoice): string | null {
  switch (choice.source) {
    case "frankfurter":
      return FRANKFURTER_URL;
    case "allratestoday":
      return ALLRATESTODAY_URL;
    case "custom":
      return choice.customUrl ? normalizeFxCustomUrl(choice.customUrl) : null;
    default:
      return null;
  }
}
