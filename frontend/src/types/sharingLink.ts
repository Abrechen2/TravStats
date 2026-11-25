/**
 * Linking an existing copy of a trip (forgejo#440) — the shapes of
 * `/sharing/trips/:tripId/link*` and `/sharing/remote/offers/:id/link*`.
 */
export type LinkDecision = "mine" | "theirs" | "both";

export type LinkEntity =
  | "flight"
  | "lodgingStay"
  | "cruise"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "roadtrip"
  | "tour"
  | "stop";

export interface LinkTripView {
  id: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
}

export interface LinkCandidate extends LinkTripView {
  reason: "period" | "name" | "overlap";
}

export interface LinkCandidates {
  /** Empty until the other side agreed to sharing. */
  candidates: LinkCandidate[];
  possibleCopy: boolean;
}

export interface LinkEntryView {
  entity: LinkEntity;
  label: string;
  when: string | null;
}

export interface LinkMatchView extends LinkEntryView {
  linked: boolean;
  conflicts: { field: string; here: string; there: string }[];
}

export interface LinkPreview {
  /** The other side has not agreed to sharing yet: counts only, none of their entries. */
  redacted: boolean;
  here: LinkTripView;
  there: LinkTripView;
  /** `onlyThere` is null while redacted. */
  counts: { matched: number; onlyHere: number; onlyThere: number | null; conflicting: number };
  byType: {
    entity: LinkEntity;
    here: number;
    there: number;
    matched: number;
    differing: number;
  }[];
  matched: LinkMatchView[];
  onlyHere: LinkEntryView[];
  onlyThere: LinkEntryView[];
}

export interface LinkResult {
  groupId: string;
  linked: number;
  alreadyLinked: number;
  skipped: number;
  settled: number;
  onlyHere: number;
  onlyThere: number;
  /** Across servers: linked, but the differing facts could not be settled. */
  settleFailed: boolean;
}
