import type {
  RailImportBooking,
  RailImportLeg,
  RailJourneyInput,
  RailReservationMatch,
  RailReservationTarget,
} from "../../types/rail";
import { wallClockLabel } from "./railImportModel";

/**
 * The review of a seat reservation booked after the ticket (forgejo#203), as
 * pure rules. A reservation never becomes a journey: each of its legs either
 * carries ONE logged journey its coach and seat can go onto, or says why not.
 * A seat that would replace a different one starts unticked — the user
 * confirms the change, it is never made for them.
 */

export interface ReservationRow {
  leg: RailImportLeg;
  /** Ticked for applying. Only a leg with one target can be ticked at all. */
  selected: boolean;
}

/** The journey a leg's seat can be written to — attach or change — else null. */
export function applicableTarget(
  match: RailReservationMatch | undefined
): RailReservationTarget | null {
  return match && (match.kind === "attach" || match.kind === "change") ? match.target : null;
}

export function reservationRowsFrom(booking: RailImportBooking): ReservationRow[] {
  return booking.legs.map((leg) => ({ leg, selected: leg.reservation?.kind === "attach" }));
}

/**
 * What the update sends: only what the reservation prints. A coach or seat it
 * does not name is left alone — a reservation never clears a stored value.
 */
export function seatPatch(leg: RailImportLeg): Pick<Partial<RailJourneyInput>, "coach" | "seat"> {
  return {
    ...(leg.coach ? { coach: leg.coach } : {}),
    ...(leg.seat ? { seat: leg.seat } : {}),
  };
}

/** The sentence that says what happens to a leg — or why nothing does. */
export function reservationStatusKey(match: RailReservationMatch | undefined): string {
  if (!match) return "rail:import.reservation.status.none.noJourney";
  if (match.kind === "none") return `rail:import.reservation.status.none.${match.reason}`;
  return `rail:import.reservation.status.${match.kind}`;
}

/** "ICE 615 Musterstadt Hbf → Beispielburg Hbf, 19.04.2026 19:55" */
export function targetLabel(target: RailReservationTarget): string {
  const train = [target.trainCategory, target.trainNumber].filter(Boolean).join(" ");
  const when = wallClockLabel(target.departureLocal);
  return `${train ? `${train} ` : ""}${target.depStationName} → ${target.arrStationName}, ${when}`;
}
