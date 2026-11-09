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
  /** 2 may carry `achievements`; the row lifts it out, so readers use `LeaderboardRow.achievements`. */
  version: 1 | 2;
  asOf: string;
  year: number | null;
  domains: string[];
  /** Absent = not shared; null = shared but not derivable. Unknown keys are ignored. */
  metrics: Record<string, number | null>;
  partial: string[];
  /** Snapshot v2 only. */
  achievements?: AchievementSection;
}
export interface AchievementSection {
  catalogue: string;
  items: { code: string; unlocked: boolean; progress: number | null }[];
}
export type AchievementsUnavailable = "olderServer" | "notShared" | "yearView";
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
  achievements?: AchievementSection;
  achievementsUnavailable?: AchievementsUnavailable;
  sharedYear: number | null;
}
export interface LeaderboardResponse {
  year: number | null;
  rows: LeaderboardRow[];
}
export interface CompareResponse {
  year: number | null;
  self: LeaderboardRow;
  /** In the order asked; a friend who is no longer visible is not a row. */
  friends: LeaderboardRow[];
}
export type InviteRedeemStatus =
  "claimed" | "awaitingAdmin" | "awaitingPeerAdmin" | "awaitingInviter";
export type AdmissionStatus = "pending" | "sent" | "approved" | "declined" | "failed" | "expired";
export interface OwnAdmission {
  id: string;
  origin: string;
  fingerprint: string;
  status: AdmissionStatus;
  failureReason: string | null;
  createdAt: string;
  expiresAt: string;
}
export interface PersonView {
  person: Person;
  mine: { consentId: string; status: ConsentStatus; scope: LeaderboardScope | null } | null;
  /** Remote people: derived from their server's last answer, `unknown` before any. */
  theirs: { status: ConsentStatus | "unknown"; answeredAt?: string | null } | null;
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
