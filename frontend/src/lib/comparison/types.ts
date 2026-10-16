/** Wire types of /api/v1/comparison — the frontend mirror of backend/src/schemas/comparison.ts. */
import type { DomainKey } from "../../shared/domains";
import type { LEADERBOARD_METRICS, MetricGroup } from "../../shared/comparisonMetrics";

export interface LeaderboardScope {
  groups: MetricGroup[];
  domains: DomainKey[];
  year: number | null;
}
export interface LeaderboardSnapshot {
  schema: "travstats-leaderboard";
  version: 1;
  asOf: string;
  year: number | null;
  domains: string[];
  /** Absent = not shared; null = shared but not derivable. Unknown keys are ignored. */
  metrics: Record<string, number | null>;
  partial: string[];
}
export interface Person {
  key: string;
  kind: "self" | "local" | "remote";
  username: string;
  displayName: string;
  origin: string | null;
}
export type RowStatus =
  "ok" | "notShared" | "yearNotShared" | "withdrawn" | "unreachable" | "outdated" | "federationOff";
export type ConsentStatus = "pending" | "accepted" | "declined" | "withdrawn";
export interface LeaderboardRow {
  person: Person;
  status: RowStatus;
  snapshot: LeaderboardSnapshot | null;
  sharedYear: number | null;
}
export interface LeaderboardResponse {
  year: number | null;
  rows: LeaderboardRow[];
}
export interface PersonView {
  person: Person;
  mine: { consentId: string; status: ConsentStatus; scope: LeaderboardScope | null } | null;
  theirs: { status: ConsentStatus } | null;
}
export interface RequestView {
  consentId: string;
  person: Person;
  createdAt: string;
}
export interface BoardView {
  id: string;
  name: string;
  members: string[];
}
export interface PeopleResponse {
  requests: RequestView[];
  people: PersonView[];
  boards: BoardView[];
}
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];
