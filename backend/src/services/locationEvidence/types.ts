/**
 * The provider-neutral shape of everything location history suggests to
 * TravStats (TravTrack plan, phase 3, E1): a stay, a market or venue visit, a
 * country day, a journey. TravTrack and Dawarich findings read alike; the
 * evidence key and the point digests never leave the server.
 */
import type { Coverage } from "../locationProvider/types";

export const EVIDENCE_PROVIDERS = ["travtrack", "dawarich"] as const;
export type EvidenceProvider = (typeof EVIDENCE_PROVIDERS)[number];

export type EvidenceKind = "stay" | "market" | "venue" | "country" | "journey";
export type EvidenceAlgorithm = "stay" | "market" | "country" | "journey";

export type EvidenceStatus =
  "pending" | "accepted" | "rejected" | "invalidated" | "covered" | "superseded";

/** Why a finding was made: a stable code and scalar params, never prose, never a coordinate. */
export type Explanation = { code: string; params: Record<string, number | string> };

/** The point of a position history the evidence keys are built from. */
export type KeyedObservation = { atMs: number; lat: number; lon: number };

export type EvidenceSuggested = {
  id: string;
  kind: EvidenceKind;
  provider: { kind: EvidenceProvider; rev: number };
  /** `[fromMs, untilMs)`. */
  window: { fromMs: number; untilMs: number };
  algorithm: { name: EvidenceAlgorithm; version: number };
  explanation: Explanation;
  status: EvidenceStatus;
  /**
   * How complete the read behind the finding was (T4's vocabulary). Null when
   * the row never recorded it — every finding from before versioning: a
   * legacy Dawarich scan knew it only for the whole run, not per finding.
   */
  coverage: Coverage | null;
};
