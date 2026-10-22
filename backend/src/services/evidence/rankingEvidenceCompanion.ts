import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { rankingKey, type EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { pageDistinctEntries, pageSumEntries } from "./entryMappersDomains";
import { loadVisibleDomains } from "../domainVisibility";
import { countriesTogether } from "../companions/companionCountries";
import { loadTogether, type TogetherEntry } from "../companions/companionTogether";
import { COMPANION_USE_KINDS, type CompanionUseKind } from "../companions/companionJoins";

/**
 * The entries behind one figure of "Mit wem unterwegs" on the statistics
 * overview: `companion:<figure>:<companionId>`, where the figure is `entries`,
 * one kind of entry (`trip`, `flight`, `cruise`, …), `days` or `countries`.
 * The population is the one `companionTogetherStats` counts — shared entries
 * that have happened, in the domains the caller sees — so the panel lists
 * exactly what the tile counted.
 *
 * Another account's companion answers like an unknown key (404), never 403.
 */
const UNITS: Record<CompanionUseKind, string> = {
  flight: "flights",
  trip: "trips",
  cruise: "cruises",
  lodging: "stays",
  rail: "rides",
  bus: "rides",
  ferry: "rides",
  rental: "rentals",
};

type Figure = "entries" | "days" | "countries" | CompanionUseKind;

function parseValue(value: string): { figure: Figure; companionId: string } | null {
  const at = value.indexOf(":");
  if (at <= 0) return null;
  const figure = value.slice(0, at);
  const companionId = value.slice(at + 1);
  const known =
    figure === "entries" ||
    figure === "days" ||
    figure === "countries" ||
    (COMPANION_USE_KINDS as readonly string[]).includes(figure);
  return known && companionId ? { figure: figure as Figure, companionId } : null;
}

const withFields = (e: TogetherEntry, fields: Partial<EvidenceEntry>): EvidenceEntry => ({
  ...e.entry,
  ...fields,
});

export async function resolveCompanionRankingEvidence(
  userId: string,
  value: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `companion ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
  const parsed = parseValue(value);
  if (!parsed) return null;
  const companion = await prisma.companion.findFirst({
    where: { id: parsed.companionId, userId },
    select: { id: true, displayName: true },
  });
  if (!companion) return null;

  const { kinds, byCompanion } = await loadTogether(userId, await loadVisibleDomains(userId));
  const { figure } = parsed;
  // A kind the caller has switched off has no tile, and so no evidence either.
  if (
    figure !== "entries" &&
    figure !== "days" &&
    figure !== "countries" &&
    !kinds.includes(figure)
  ) {
    return null;
  }
  const entries = byCompanion.get(companion.id) ?? [];
  const label = {
    key: `evidence.ranking.companion.${figure}`,
    values: { name: companion.displayName },
  };
  const measureBase = {
    kind: "ranking" as const,
    key: rankingKey("companion", value),
    label,
    scope,
  };

  if (figure === "days") {
    const rows = entries
      .filter((e) => e.dayKeys.length > 0)
      .map((e) => withFields(e, { credits: e.dayKeys }));
    const days = new Set(rows.flatMap((r) => r.credits ?? []));
    const paged = pageDistinctEntries(rows, page);
    return {
      measure: { ...measureBase, aggregation: "distinct", unit: "days", value: days.size },
      entries: paged.entries,
      returned: paged.entries.length,
      omitted: { count: paged.omittedCount, credits: paged.omittedCredits },
      unattributed: [],
      page,
    };
  }

  if (figure === "countries") {
    const codes = (await countriesTogether(userId, new Map([[companion.id, entries]]))).get(
      companion.id
    )?.codes;
    const visited = new Set(codes ?? []);
    // An entry is credited with the visited countries its own places lie in.
    // A country the chain rule proves without any entry lying in it (none in
    // practice, but the rule allows it) is named as unattributed, not hidden.
    const rows = entries.flatMap((e) => {
      const credits = e.touched.filter((c) => visited.has(c));
      return credits.length > 0 ? [withFields(e, { credits })] : [];
    });
    const credited = new Set(rows.flatMap((r) => r.credits ?? []));
    const paged = pageDistinctEntries(rows, page);
    const missing = visited.size - credited.size;
    return {
      measure: {
        ...measureBase,
        aggregation: "distinct",
        unit: "countries",
        value: codes === undefined || codes === null ? null : visited.size,
      },
      entries: paged.entries,
      returned: paged.entries.length,
      omitted: { count: paged.omittedCount, credits: paged.omittedCredits },
      unattributed: missing > 0 ? [{ count: missing, reason: "notPerEntry" }] : [],
      page,
    };
  }

  const matching = figure === "entries" ? entries : entries.filter((e) => e.kind === figure);
  const rows = matching.map((e) => withFields(e, { contribution: 1 }));
  const paged = pageSumEntries(rows, page);
  return {
    measure: {
      ...measureBase,
      aggregation: "sum",
      unit: figure === "entries" ? "entries" : UNITS[figure],
      value: rows.length,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, contribution: paged.omittedContribution },
    unattributed: [],
    page,
  };
}
