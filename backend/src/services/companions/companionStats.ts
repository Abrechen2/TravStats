import { prisma } from "../../db";
import { loadVisibleDomains } from "../domainVisibility";
import type { CompanionUseKind } from "./companionJoins";
import { countriesTogether } from "./companionCountries";
import { daysTogether, loadTogether } from "./companionTogether";

/** One companion's figures on the statistics overview, all time. */
export interface CompanionTogetherRow {
  id: string;
  name: string;
  /** Shared entries that have happened, of every kind the caller sees. */
  entries: number;
  /** Per kind the caller sees, trips included. */
  perKind: Partial<Record<CompanionUseKind, number>>;
  /** Distinct calendar days covered by those entries — a shared day counts once. */
  days: number;
  /** Countries visited together (the passport's rule); null where nothing could prove one. */
  countries: number | null;
  lastTogether: string | null;
}

/**
 * "Mit wem unterwegs" — every companion with at least one shared entry that
 * has happened, most days together first. Companions only on planned entries,
 * or only paying expenses, are not listed: nothing was travelled together yet.
 */
export async function companionTogetherStats(
  userId: string
): Promise<{ kinds: CompanionUseKind[]; companions: CompanionTogetherRow[] }> {
  const visible = await loadVisibleDomains(userId);
  const [{ kinds, byCompanion }, names] = await Promise.all([
    loadTogether(userId, visible),
    prisma.companion.findMany({ where: { userId }, select: { id: true, displayName: true } }),
  ]);
  const shared = new Map([...byCompanion].filter(([, entries]) => entries.length > 0));
  const countries = await countriesTogether(userId, shared);
  const nameOf = new Map(names.map((n) => [n.id, n.displayName]));
  const companions = [...shared].flatMap(([id, entries]) => {
    const name = nameOf.get(id);
    if (name === undefined) return [];
    const days = daysTogether(entries);
    const codes = countries.get(id)?.codes ?? null;
    return [
      {
        id,
        name,
        entries: entries.length,
        perKind: Object.fromEntries(
          kinds.map((kind) => [kind, entries.filter((e) => e.kind === kind).length])
        ),
        days: days.length,
        countries: codes === null ? null : codes.length,
        lastTogether: days.length > 0 ? days[days.length - 1] : null,
      },
    ];
  });
  companions.sort(
    (a, b) => b.days - a.days || b.entries - a.entries || a.name.localeCompare(b.name)
  );
  return { kinds, companions };
}
