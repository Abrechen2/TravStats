import type { DbTransaction } from "../../db";
import { rideEndsAt } from "../../shared/railClock";
import {
  deriveBusStatus,
  deriveCruiseStatus,
  deriveFlightStatus,
  deriveLodgingStatus,
  deriveRailStatus,
  deriveRentalStatus,
} from "../../shared/statusDerivation";
import { dayAnchorNowFor } from "../../shared/time/profileZone";
import type { ShareEntity } from "./shareTypes";

/**
 * The derived columns of a copy (spec 2026-10-16, D4). Facts travel as stored
 * (ADR 0002); a status is a CACHE of the facts and the clock, so each copy's is
 * derived afresh with its domain's own function — for the recipient: a stay or
 * a cruise asks the recipient's calendar, as its own write path does. The
 * trip's status is re-derived by the caller (`restatusTrips`), once per trip.
 */
export type DeriveCopy = (c: DbTransaction, copyId: string, recipientId: string) => Promise<void>;

const RIDE_SELECT = {
  status: true,
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
} as const;

export const DERIVE: Readonly<Record<ShareEntity, DeriveCopy>> = {
  async flight(c, id) {
    const f = await c.flight.findUniqueOrThrow({
      where: { id },
      select: { status: true, departureTime: true, arrivalTime: true, actualArrival: true },
    });
    const status = deriveFlightStatus({ ...f, current: f.status });
    if (status !== f.status) await c.flight.update({ where: { id }, data: { status } });
  },
  async lodgingStay(c, id, recipientId) {
    const s = await c.lodgingStay.findUniqueOrThrow({
      where: { id },
      select: { status: true, checkIn: true, checkOut: true },
    });
    const status = deriveLodgingStatus({
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      current: s.status,
      now: await dayAnchorNowFor(recipientId, c),
    });
    if (status !== s.status) await c.lodgingStay.update({ where: { id }, data: { status } });
  },
  async cruise(c, id, recipientId) {
    const r = await c.cruise.findUniqueOrThrow({
      where: { id },
      select: { status: true, startDate: true, endDate: true },
    });
    const status = deriveCruiseStatus({
      startDate: r.startDate,
      endDate: r.endDate,
      current: r.status,
      now: await dayAnchorNowFor(recipientId, c),
    });
    if (status !== r.status) await c.cruise.update({ where: { id }, data: { status } });
  },
  async rail(c, id) {
    const r = await c.railJourney.findUniqueOrThrow({ where: { id }, select: RIDE_SELECT });
    const status = deriveRailStatus({ ...r, current: r.status, endsAt: rideEndsAt(r) });
    if (status !== r.status) await c.railJourney.update({ where: { id }, data: { status } });
  },
  async bus(c, id) {
    const r = await c.busJourney.findUniqueOrThrow({ where: { id }, select: RIDE_SELECT });
    const status = deriveBusStatus({ ...r, current: r.status, endsAt: rideEndsAt(r) });
    if (status !== r.status) await c.busJourney.update({ where: { id }, data: { status } });
  },
  async ferry(c, id) {
    const r = await c.ferryJourney.findUniqueOrThrow({ where: { id }, select: RIDE_SELECT });
    // A crossing derives with bus's rule: both are written through
    // `services/rides/terminalRideWrite.ts`, which calls deriveBusStatus.
    const status = deriveBusStatus({ ...r, current: r.status, endsAt: rideEndsAt(r) });
    if (status !== r.status) await c.ferryJourney.update({ where: { id }, data: { status } });
  },
  async rental(c, id) {
    const r = await c.rentalBooking.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        pickupTime: true,
        returnTime: true,
        returnPrecision: true,
        returnTimezone: true,
      },
    });
    const status = deriveRentalStatus({ ...r, current: r.status });
    if (status !== r.status) await c.rentalBooking.update({ where: { id }, data: { status } });
  },
  // A timeline stop caches nothing.
  async stop() {},
};
