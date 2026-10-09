/**
 * The proposal a `.travstats` file becomes — the package proposal's shape
 * (`../package/types.ts`: create / attach / skip, with the matched row and
 * the reason) carried over to every kind of entry the file holds.
 */
import { z } from "zod";
import type { EntityAction, ProposalReason, ProposalTrip } from "../package/types";

export type TripFileEntryKind = "flight" | "stay" | "cruise" | "rail" | "rental" | "visit" | "stop";

export interface TripFileEntryProposal {
  /** The file-local key (`f1`). */
  key: string;
  kind: TripFileEntryKind;
  action: EntityAction;
  /** The matched row, for attach and skip. */
  id: string | null;
  reason?: ProposalReason;
  /** What the review shows: a flight number and route, a hotel name, a station pair. */
  label: string;
  /** The entry's first local day, when it has one. */
  day: string | null;
}

export interface TripFileBookingProposal {
  key: string;
  action: "create" | "attach";
  id: string | null;
  reference: string | null;
  price: number | null;
  currency: string | null;
}

export interface TripFilePlaceProposal {
  key: string;
  action: "create" | "reuse";
  id: string | null;
  name: string;
}

export interface TripFileProposal {
  trip: ProposalTrip;
  /** What the exporter chose to include. */
  options: { documents: boolean; photos: boolean; private: boolean };
  exportedAt: string;
  appVersion: string;
  bookings: TripFileBookingProposal[];
  places: TripFilePlaceProposal[];
  entries: TripFileEntryProposal[];
  /** Journal entries to write (private files only); ones already on the trip are not counted. */
  journal: { create: number; skip: number };
  documents: { create: number; skip: number };
  photos: { create: number; skip: number };
}

export const tripFileChoicesSchema = z
  .object({ tripName: z.string().trim().min(1).max(200).optional() })
  .strict();
export type TripFileChoices = z.infer<typeof tripFileChoicesSchema>;
