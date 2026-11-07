/**
 * One figure of one person for the side-by-side table, and the difference between two of them.
 * Abstention is a result (CLAUDE.md): a figure that is withheld, partial or not like-for-like has
 * a reason and no difference — never a zero.
 */
import type { MetricKey } from "../../shared/comparisonMetrics";
import { judge, type UnrankedReason } from "./ranking";
import type { LeaderboardRow } from "./types";

export interface Cell {
  value: number | null;
  /** The figure is a lower bound ("≥"). */
  partial: boolean;
  reason: UnrankedReason | null;
}

export type Diff =
  /** The person's figures are not here at all (withdrawn, unreachable …): the cell stays empty. */
  | { kind: "none" }
  /** There is a figure on at least one side, but the two cannot be set against each other. */
  | { kind: "notComparable" }
  | { kind: "value"; value: number };

/** Reasons that describe the whole row, not one figure. */
const ROW_LEVEL: ReadonlySet<UnrankedReason> = new Set([
  "notShared",
  "yearNotShared",
  "withdrawn",
  "unreachable",
  "outdated",
  "federationOff",
  "otherYear",
]);

/** `row` is undefined for a friend the server no longer lists: they stopped sharing back. */
export function cellFor(
  row: LeaderboardRow | undefined,
  metric: MetricKey,
  year: number | null,
  selfDomains: string | null
): Cell {
  if (!row) return { value: null, partial: false, reason: "withdrawn" };
  return {
    ...judge(row, metric, year, selfDomains),
    partial: row.snapshot?.partial.includes(metric) ?? false,
  };
}

export function diffOf(self: Cell, friend: Cell): Diff {
  if (friend.reason && ROW_LEVEL.has(friend.reason)) return { kind: "none" };
  if (self.value === null || friend.value === null) return { kind: "notComparable" };
  if (self.partial || friend.partial) return { kind: "notComparable" };
  return { kind: "value", value: self.value - friend.value };
}

export const domainSetOf = (row: LeaderboardRow): string | null =>
  row.snapshot ? [...row.snapshot.domains].sort().join(",") : null;
