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
  here: LinkTripView;
  there: LinkTripView;
  counts: { matched: number; onlyHere: number; onlyThere: number; conflicting: number };
  byType: { entity: LinkEntity; here: number; there: number }[];
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
}
