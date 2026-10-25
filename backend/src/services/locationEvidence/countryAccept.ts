/**
 * Answering a TravTrack country question (TravTrack plan E6) through the
 * accept protocol (`acceptFlow.ts`, via `suggestionStore.ts`). The answer is
 * the user's own country override — "visited" or "ground" — dated at the
 * run's first day. An override the user set meanwhile is never overwritten:
 * the question resolves accepted and names it.
 */
import { AppError } from "../../middleware/errorHandler";
import type { AcceptHooks } from "./acceptFlow";
import { countryRunHolds } from "./countrySuggestions";
import { acceptSuggestion, type StoredSuggestion, type SuggestionKind } from "./suggestionStore";

export type CountryVerdict = "visited" | "ground";

const countryOf = (row: StoredSuggestion): string => {
  const code = (row.evidence as { countryCode?: unknown } | null)?.countryCode;
  // Written by `countrySuggestions` only; a row without one is not a country question.
  if (typeof code !== "string" || !/^[A-Z]{2}$/.test(code)) {
    throw new AppError("Not a country question", 409, "SUGGESTION_ALREADY_RESOLVED");
  }
  return code;
};

const countryKind = (verdict: CountryVerdict): SuggestionKind => ({
  recheck: async (row) =>
    (await countryRunHolds(row.userId, countryOf(row), {
      from: row.windowFrom,
      until: row.windowUntil,
    }))
      ? "holds"
      : "invalidated",
  apply: async (tx, row) => {
    const countryCode = countryOf(row);
    // `update: {}` — an override that exists already is the user's, and stays as it is.
    const override = await tx.countryOverride.upsert({
      where: { userId_countryCode: { userId: row.userId, countryCode } },
      create: { userId: row.userId, countryCode, verdict, note: "", day: row.windowFrom },
      update: {},
      select: { id: true },
    });
    return { kind: "countryOverride", id: override.id };
  },
});

export async function acceptCountrySuggestion(
  userId: string,
  id: string,
  verdict: CountryVerdict,
  hooks: AcceptHooks = {}
): Promise<StoredSuggestion> {
  return acceptSuggestion(userId, id, countryKind(verdict), hooks);
}
