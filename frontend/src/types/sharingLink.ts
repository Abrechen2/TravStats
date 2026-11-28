/**
 * Linking an existing copy of a trip (forgejo#440) — the shapes of
 * `/sharing/trips/:tripId/link*` and `/sharing/remote/offers/:id/link*`.
 */
import type { ShareDisplayValue } from "./sharing";

/** `best`: the bulk link's — the better value wins each difference, a tie keeps both. */
export type LinkDecision = "mine" | "theirs" | "both" | "best";
/** One differing field's own choice in the dry run. */
export type FieldChoice = "mine" | "theirs" | "both";
/** Per pair (`ref`), per field group: the person's own choices. */
export type LinkChoices = Record<string, Record<string, FieldChoice>>;

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

/** Before the other side agreed to sharing: this and nothing else. */
export interface AwaitingConsent {
  access: "awaitingConsent";
}

export type LinkCandidates = { access: "full"; candidates: LinkCandidate[] } | AwaitingConsent;

export interface LinkEntryView {
  entity: LinkEntity;
  label: string;
  when: string | null;
}

/**
 * An entry only one side holds (owner, 2026-11-28): added to the other copy only when ticked;
 * `duplicateOf` names a similar entry there. Absent on servers before rc.49.
 */
export interface LinkOneSidedView extends LinkEntryView {
  ref?: string;
  duplicateOf?: { label: string; when: string | null } | null;
}

export type LineQuality = "drawn" | "routed" | "straight" | "none";

/** A differing value: a display value (times in the place's zone) or a line by its quality. */
export type LinkValue =
  ShareDisplayValue | { kind: "line"; quality: LineQuality; points: number; lines?: number };

export interface LinkConflictView {
  /** A fact, or the group decided together (`geometry`, `departureTime`, `checkIn`). */
  field: string;
  /** The original short string form (kept for installed clients). */
  here: string;
  there: string;
  /** The same values for display: times in the place's zone, a line by its quality. */
  display: { here: LinkValue; there: LinkValue };
  /** The side whose value is better; null when equal in quality. */
  better: "here" | "there" | null;
  /** Equal quality, different values: only the person can decide. */
  real: boolean;
}

export interface LinkMatchView extends LinkEntryView {
  ref: string;
  linked: boolean;
  conflicts: LinkConflictView[];
  /** Differing facts the server computes again or the transfer cannot carry. */
  recomputed: string[];
  automatic: boolean;
}

export interface LinkPreview {
  access: "full";
  here: LinkTripView;
  there: LinkTripView;
  counts: {
    matched: number;
    onlyHere: number;
    onlyThere: number;
    conflicting: number;
    needsReview: number;
  };
  /** The quality rule settles every difference: the bulk link takes it. */
  automatic: boolean;
  byType: {
    entity: LinkEntity;
    here: number;
    there: number;
    matched: number;
    differing: number;
  }[];
  matched: LinkMatchView[];
  onlyHere: LinkOneSidedView[];
  onlyThere: LinkOneSidedView[];
  /** Ports the other server names that this one lacks: added on linking. */
  newPorts?: string[];
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
  /** One-sided entries the person ticked and the link added. */
  added?: number;
}

export type LinkPreviewAnswer = LinkPreview | AwaitingConsent;

/** The bulk link's list (UAT 2026-11-27). */
export interface BulkPair {
  /** Local: the caller's trip; across servers: the offer id. */
  id: string;
  trip: LinkTripView | null;
  other: LinkTripView;
  reason: LinkCandidate["reason"] | null;
  linked: boolean;
  ambiguous: boolean;
  from?: { displayName: string; origin: string };
}

export type BulkPairs = { access: "full"; pairs: BulkPair[] } | AwaitingConsent;

export interface BulkOfferCandidate extends LinkTripView {
  offered: boolean;
}

/** Local link proposals (Codex P1, 2026-11-27). */
export type LinkProposalStatus = "pending" | "linked" | "declined";

export interface SentLinkProposal {
  id: string;
  tripId: string;
  recipient: { id: string; displayName: string };
  status: LinkProposalStatus;
}

export interface ReceivedLinkProposal {
  id: string;
  from: { id: string; displayName: string };
  trip: LinkTripView;
  createdAt: string;
}

export interface ProposableTrip extends LinkTripView {
  status: LinkProposalStatus | null;
}
