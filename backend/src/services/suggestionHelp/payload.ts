/**
 * "KI fragen" for an ambiguous inbox suggestion (forgejo#439 phase 2).
 *
 * The model sees the minimum it needs and nothing else: the name candidates,
 * the distance to the nearest of them, the dwell, the names of the places
 * nearby and the local day. No coordinate, no raw track, no account name.
 * Its answer is ADVISORY: a ranked choice with a reason, shown to the person;
 * nothing is written without their click.
 */

export type SuggestionHelpInput = {
  /** The names the suggestion could mean, most likely first. */
  candidates: string[];
  /** Metres from the suggestion's point to the nearest candidate; null when unknown. */
  distanceM: number | null;
  /** Minutes spent there; null when unknown. */
  dwellMin: number | null;
  /** Names of the account's places nearby. */
  nearbyPlaces: string[];
  /** `YYYY-MM-DD` on the suggestion's own clock. */
  localDay: string;
};

/** The field names a request carries — what the confirmation dialog lists. */
export const SUGGESTION_HELP_FIELDS = [
  "candidates",
  "distanceM",
  "dwellMin",
  "nearbyPlaces",
  "localDay",
] as const;

export type SuggestionHelpAnswer = {
  ranking: Array<{ name: string; reason: string }>;
};

const MAX_CANDIDATES = 8;
const MAX_NEARBY = 10;
const MAX_NAME = 120;
const MAX_REASON = 400;

const clip = (s: string, n: number) => s.trim().slice(0, n);

/** The exact object that is sent: a whitelist, so no extra field can ride along. */
export function helpPayload(input: SuggestionHelpInput): SuggestionHelpInput {
  return {
    candidates: input.candidates.slice(0, MAX_CANDIDATES).map((c) => clip(c, MAX_NAME)),
    distanceM: input.distanceM === null ? null : Math.round(input.distanceM),
    dwellMin: input.dwellMin === null ? null : Math.round(input.dwellMin),
    nearbyPlaces: input.nearbyPlaces.slice(0, MAX_NEARBY).map((c) => clip(c, MAX_NAME)),
    localDay: input.localDay,
  };
}

export const HELP_SYSTEM =
  "You help a traveller decide which place a recorded stop was. " +
  "You get candidate names, the distance to the nearest candidate in metres, the minutes spent, " +
  "names of the traveller's saved places nearby and the local day. " +
  'Answer only with JSON: {"ranking":[{"name":"<one of the candidates>","reason":"<one short sentence>"}]}, ' +
  "best first, only names from the candidates.";

export function helpPrompt(payload: SuggestionHelpInput): string {
  return JSON.stringify(payload);
}

/**
 * Read the model's answer. Only names that ARE candidates survive — a model
 * that invents a place is not offered as a choice. An answer with none left
 * is `null` (the caller says "no usable answer"), never an empty success.
 */
export function parseHelpAnswer(
  text: string,
  candidates: readonly string[]
): SuggestionHelpAnswer | null {
  const body = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/g, "")
    .trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { ranking?: unknown }).ranking;
  if (!Array.isArray(raw)) return null;
  const known = new Map(candidates.map((c) => [c.trim().toLowerCase(), c]));
  const seen = new Set<string>();
  const ranking: SuggestionHelpAnswer["ranking"] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const name = (r as { name?: unknown }).name;
    const reason = (r as { reason?: unknown }).reason;
    if (typeof name !== "string") continue;
    const canonical = known.get(name.trim().toLowerCase());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    ranking.push({
      name: canonical,
      reason: typeof reason === "string" ? clip(reason, MAX_REASON) : "",
    });
  }
  return ranking.length > 0 ? { ranking } : null;
}
