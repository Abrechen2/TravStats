import type { LodgingChainRef, LodgingMembership } from "../../types/lodging";

/** A catalogue chain as the membership form may know it: with its programme, when the caller loaded it. */
export type CatalogueChain = LodgingChainRef & { loyaltyProgram?: string | null };

const key = (value: string): string => value.trim().toLowerCase();

/**
 * Programme names the catalogue knows, minus the ones the user already holds
 * a card for — the backend refuses a second card per programme with a 409, so
 * offering one would be offering an error. The card being edited keeps its own.
 */
export function programSuggestions(
  catalog: readonly CatalogueChain[],
  memberships: readonly LodgingMembership[],
  editingId: string | null
): string[] {
  const held = new Set(
    memberships.filter((m) => m.id !== editingId).map((m) => key(m.programName))
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chain of catalog) {
    const program = chain.loyaltyProgram?.trim();
    if (!program || held.has(key(program)) || seen.has(key(program))) continue;
    seen.add(key(program));
    out.push(program);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Tiers the user has written on their cards, most used first — status names repeat across programmes. */
export function tierSuggestions(memberships: readonly LodgingMembership[]): string[] {
  const counts = new Map<string, { value: string; n: number }>();
  for (const m of memberships) {
    const tier = m.tier?.trim();
    if (!tier) continue;
    const seen = counts.get(key(tier));
    counts.set(key(tier), { value: seen?.value ?? tier, n: (seen?.n ?? 0) + 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.value.localeCompare(b.value))
    .map((entry) => entry.value);
}

/** The catalogue chains a programme covers (Marriott Bonvoy → Marriott, Sheraton, Westin …). */
export function chainIdsOfProgram(catalog: readonly CatalogueChain[], program: string): number[] {
  const wanted = key(program);
  if (!wanted) return [];
  return catalog
    .filter((c) => c.loyaltyProgram && key(c.loyaltyProgram) === wanted)
    .map((c) => c.id);
}
