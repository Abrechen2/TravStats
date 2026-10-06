import { describe, expect, it } from "vitest";
import {
  applicableTarget,
  reservationRowsFrom,
  reservationStatusKey,
  seatPatch,
  targetLabel,
} from "../railReservationModel";
import { reservationBooking, reservationLeg, target } from "./railReservationFixture";

describe("rail reservation review rules (forgejo#203)", () => {
  it("ticks an attach, leaves a change for the user, and offers nothing else", () => {
    const rows = reservationRowsFrom(
      reservationBooking([
        reservationLeg({ kind: "attach", target: target(), subSection: false }),
        reservationLeg({
          kind: "change",
          target: target({ coach: "7", seat: "61" }),
          subSection: false,
        }),
        reservationLeg({ kind: "none", reason: "noJourney" }),
        reservationLeg({ kind: "several", targets: [target(), target({ id: "journey-2" })] }),
      ])
    );
    expect(rows.map((r) => r.selected)).toEqual([true, false, false, false]);
    expect(rows.map((r) => applicableTarget(r.leg.reservation)?.id ?? null)).toEqual([
      "journey-1",
      "journey-1",
      null,
      null,
    ]);
    expect(
      applicableTarget({ kind: "alreadySet", target: target(), subSection: false })
    ).toBeNull();
  });

  it("sends only the coach and seat the reservation prints, never a clearing null", () => {
    const match = { kind: "attach" as const, target: target(), subSection: false };
    expect(seatPatch(reservationLeg(match))).toEqual({ coach: "12", seat: "133" });
    expect(seatPatch(reservationLeg(match, { coach: null }))).toEqual({ seat: "133" });
  });

  it("words each outcome by its own key", () => {
    expect(reservationStatusKey({ kind: "none", reason: "noTrain" })).toBe(
      "rail:import.reservation.status.none.noTrain"
    );
    expect(reservationStatusKey({ kind: "sameJourneyTwice", target: target() })).toBe(
      "rail:import.reservation.status.sameJourneyTwice"
    );
    expect(reservationStatusKey(undefined)).toBe("rail:import.reservation.status.none.noJourney");
  });

  it("names the target journey by train, stations and printed clock", () => {
    expect(targetLabel(target())).toBe(
      "ICE 615 Musterstadt Hbf → Beispielburg Hbf, 19.04.2026 19:55"
    );
  });
});
