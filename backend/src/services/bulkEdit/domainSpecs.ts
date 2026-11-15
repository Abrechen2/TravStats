import type { ShareEntity } from "../sharing/shareTypes";
import type { BulkDomain } from "../../schemas/domainBulkEdit";
import {
  deriveCruiseStatus,
  deriveLodgingStatus,
  deriveRailStatus,
  deriveRentalStatus,
} from "../../shared/statusDerivation";
import { rideEndsAt } from "../../shared/railClock";

/**
 * What differs between the domains in a bulk edit (forgejo#405 A4): which
 * table, which join table carries the companions, which columns hold the
 * operator and the class, and how a cancelled row finds its status again.
 * Everything else — the diff, the one transaction per row, the version claim,
 * the propagation, the trip statuses — is one code path in `domainBulkEdit.ts`.
 */

export type Row = Record<string, unknown> & { id: string };

export interface DomainSpec {
  domain: BulkDomain;
  /** Name of the Prisma delegate on the client and on a transaction. */
  delegate: string;
  /** Sync entity whose `updated_at` is the row's version. */
  syncEntity: string;
  shareEntity: ShareEntity;
  /** Join table of ordered companion links; stays keep only the string array. */
  links: { delegate: string; column: string } | null;
  tagsColumn: boolean;
  operatorColumn: string | null;
  classColumn: string | null;
  /** Rental: edited fields are protected from a later mail import. */
  protectsEdits: boolean;
  /**
   * Cruises and stays are CALENDAR-day facts and read "today" on the profile's
   * day anchor; a ride or a rental is a real instant and reads the clock.
   */
  dayAnchored: boolean;
  /** The status a CANCELLED row goes back to, from the dates it carries. */
  reinstated: (row: Row, now: Date | undefined) => string;
  /** The stay is written through its own update, which derives and propagates itself. */
  ownWrite: boolean;
}

const date = (row: Row, key: string): Date | null => (row[key] as Date | null | undefined) ?? null;

const rideStatus = (row: Row, now: Date | undefined): string =>
  deriveRailStatus({
    departureTime: row.departureTime as Date,
    arrivalTime: date(row, "arrivalTime"),
    current: "scheduled",
    now,
    endsAt: rideEndsAt({
      departureTime: row.departureTime as Date,
      arrivalTime: date(row, "arrivalTime"),
      depTimezone: (row.depTimezone as string | null) ?? null,
      arrTimezone: (row.arrTimezone as string | null) ?? null,
      depPrecision: (row.depPrecision as string | null) ?? null,
      arrPrecision: (row.arrPrecision as string | null) ?? null,
    }),
  });

const transport = (
  domain: "rail" | "bus" | "ferry",
  delegate: string,
  syncEntity: string,
  links: string,
  column: string,
  classColumn: string
): DomainSpec => ({
  domain,
  delegate,
  syncEntity,
  shareEntity: domain,
  links: { delegate: links, column },
  tagsColumn: true,
  operatorColumn: "operator",
  classColumn,
  protectsEdits: false,
  dayAnchored: false,
  reinstated: rideStatus,
  ownWrite: false,
});

export const DOMAIN_SPECS: Record<BulkDomain, DomainSpec> = {
  rail: transport(
    "rail",
    "railJourney",
    "rail_journey",
    "railJourneyCompanion",
    "railJourneyId",
    "travelClass"
  ),
  bus: transport(
    "bus",
    "busJourney",
    "bus_journey",
    "busJourneyCompanion",
    "busJourneyId",
    "fareClass"
  ),
  ferry: transport(
    "ferry",
    "ferryJourney",
    "ferry_journey",
    "ferryJourneyCompanion",
    "ferryJourneyId",
    "fareClass"
  ),
  rental: {
    domain: "rental",
    delegate: "rentalBooking",
    syncEntity: "rental_booking",
    shareEntity: "rental",
    links: { delegate: "rentalBookingCompanion", column: "rentalBookingId" },
    tagsColumn: true,
    operatorColumn: null,
    classColumn: null,
    protectsEdits: true,
    dayAnchored: false,
    reinstated: (row, now) =>
      deriveRentalStatus({
        pickupTime: row.pickupTime as Date,
        returnTime: row.returnTime as Date,
        current: "scheduled",
        now,
        returnPrecision: (row.returnPrecision as string | null) ?? null,
        returnTimezone: (row.returnTimezone as string | null) ?? null,
      }),
    ownWrite: false,
  },
  cruise: {
    domain: "cruise",
    delegate: "cruise",
    syncEntity: "cruise",
    shareEntity: "cruise",
    links: { delegate: "cruiseCompanion", column: "cruiseId" },
    tagsColumn: true,
    operatorColumn: null,
    classColumn: null,
    protectsEdits: false,
    dayAnchored: true,
    reinstated: (row, now) =>
      deriveCruiseStatus({
        startDate: date(row, "startDate"),
        endDate: date(row, "endDate"),
        current: "scheduled",
        now,
      }),
    ownWrite: false,
  },
  stay: {
    domain: "stay",
    delegate: "lodgingStay",
    syncEntity: "lodging_stay",
    shareEntity: "lodgingStay",
    links: null,
    tagsColumn: false,
    operatorColumn: null,
    classColumn: null,
    protectsEdits: false,
    dayAnchored: true,
    reinstated: (row, now) =>
      deriveLodgingStatus({
        checkIn: date(row, "checkIn"),
        checkOut: date(row, "checkOut"),
        current: "scheduled",
        now,
      }),
    ownWrite: true,
  },
};
