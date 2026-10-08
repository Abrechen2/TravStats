import { describe, expect, it } from "vitest";
import { canSubmit, draftFrom, saveErrorFrom, toBusInput } from "../busFormModel";
import type { BusJourney } from "../../../types/bus";
import type { TimeValue } from "../../../shared/time";
import { EMPTY_TERMINAL } from "../BusStationField";
import { SEOUL, rideFixture } from "./busFixture";

const placed = { ...draftFrom(null), departure: SEOUL, arrival: SEOUL };

describe("busFormModel", () => {
  it("cannot submit without two placed terminals and a departure", () => {
    const empty = draftFrom(null);
    expect(canSubmit(empty)).toBe(false);
    expect(canSubmit({ ...placed, departureLocal: "2026-09-20T09:00" })).toBe(true);
    expect(
      canSubmit({ ...placed, arrival: EMPTY_TERMINAL, departureLocal: "2026-09-20T09:00" })
    ).toBe(false);
  });

  it("sends every optional field, null when empty — blanking a field must clear it", () => {
    const input = toBusInput({ ...placed, departureLocal: "2026-09-20T09:00" });
    expect(input.operator).toBeNull();
    expect(input.lineName).toBeNull();
    expect(input.arrivalLocal).toBeNull();
    expect(input.rideKind).toBeNull();
    expect(input.fareClass).toBeNull();
    expect(input.seat).toBeNull();
    expect(input.delayMinutes).toBeNull();
    expect(input.bookingReference).toBeNull();
    expect(input.price).toBeNull();
    expect(input.distanceKm).toBeNull();
    expect(input.tripId).toBeNull();
    expect(input.notes).toBeNull();
    expect(input.departureStation.address).toBeNull();
    expect(input.status).toBe("scheduled");
    expect(input.currency).toBe("EUR");
  });

  it("a typed distance with a comma is a number; a measured one is not shown in the draft", () => {
    const input = toBusInput({
      ...placed,
      departureLocal: "2026-09-20T09:00",
      distanceKm: "159,5",
    });
    expect(input.distanceKm).toBe(159.5);
    expect(
      draftFrom({ ...rideFixture(), distanceKm: 159, distanceSource: "great_circle" }).distanceKm
    ).toBe("");
    expect(
      draftFrom({ ...rideFixture(), distanceKm: 210, distanceSource: "user" }).distanceKm
    ).toBe("210");
  });

  it("reads the stored ride back on each terminal's own clock", () => {
    const draft = draftFrom(rideFixture());
    expect(draft.departureLocal).toBe("2026-09-20T09:00");
    expect(draft.arrivalLocal).toBe("2026-09-20T11:20");
    expect(draft.cancelled).toBe(false);
    expect(draft.departureDayOnly).toBe(false);
    expect(draft.arrivalDayOnly).toBe(false);
    expect(draft.departureFold).toBeNull();
    expect(draft.arrivalFold).toBeNull();
  });

  it("a ride logged by its day alone is edited by its day and sent as a day", () => {
    const stored = rideFixture();
    const dayOnly = {
      ...stored,
      arrivalTime: null,
      times: {
        ...stored.times!,
        departure: {
          ...stored.times!.departure!,
          local: "2026-09-20T00:00:00",
          precision: "day" as const,
        },
        arrival: null,
      },
    };
    const draft = draftFrom(dayOnly);
    expect(draft.departureDayOnly).toBe(true);
    expect(draft.arrivalDayOnly).toBe(false);
    const input = toBusInput(draft);
    expect(input.departureLocal).toBe("2026-09-20");
    expect(input.arrivalLocal).toBeNull();
  });

  it("day-only drops the clock part of each end that is day-only", () => {
    const input = toBusInput({
      ...placed,
      departureDayOnly: true,
      arrivalDayOnly: true,
      departureLocal: "2026-09-20T09:00",
      arrivalLocal: "2026-09-21T11:20",
    });
    expect(input.departureLocal).toBe("2026-09-20");
    expect(input.arrivalLocal).toBe("2026-09-21");
  });

  it("sends the terminal as typed, trimmed, with its address", () => {
    const input = toBusInput({
      ...placed,
      departure: { ...SEOUL, name: "  Dong Seoul  ", address: " 50 Gangbyeon-yeok-ro " },
      departureLocal: "2026-09-20T09:00",
    });
    expect(input.departureStation).toMatchObject({
      name: "Dong Seoul",
      address: "50 Gangbyeon-yeok-ro",
    });
  });

  it("maps the server's codes to copy beside the field", () => {
    const refused = (code: string, field?: string) => ({ response: { data: { code, field } } });
    expect(saveErrorFrom(refused("BUS_ARRIVAL_BEFORE_DEPARTURE", "arrivalLocal"))).toEqual({
      key: "bus:form.errors.arrivalBeforeDeparture",
      field: "arrivalLocal",
    });
    expect(saveErrorFrom(refused("LOCAL_TIME_NONEXISTENT", "departureLocal"))).toEqual({
      key: "bus:form.errors.nonexistentTime",
      field: "departureLocal",
    });
    expect(saveErrorFrom(refused("TZ_UNRESOLVED", "departureLocal"))).toEqual({
      key: "bus:form.errors.noZone",
      field: "departureLocal",
    });
    expect(saveErrorFrom(refused("BUS_INVALID_INPUT", "seat"))).toMatchObject({
      key: "bus:form.errors.invalidField",
      fieldLabelKey: "bus:form.seatNumber",
    });
    expect(saveErrorFrom(refused("BUS_INVALID_INPUT"))).toEqual({
      key: "bus:form.errors.invalid",
      field: null,
    });
  });
  describe("the repeated autumn hour (forgejo#214)", () => {
    // 2026-10-25: Europe/Berlin goes back at 03:00 CEST, so 02:30 happens twice.
    const berlinRide = (utc: string, offset: string): BusJourney => {
      const base = rideFixture();
      const departure: TimeValue = {
        utc,
        zone: "Europe/Berlin",
        offset,
        local: "2026-10-25T02:30:00",
        precision: "minute",
      };
      return {
        ...base,
        departureTime: utc,
        depTimezone: "Europe/Berlin",
        times: { ...base.times!, departure },
      };
    };

    it("reads the later occurrence back and sends it", () => {
      const draft = draftFrom(berlinRide("2026-10-25T01:30:00.000Z", "+01:00"));
      expect(draft.departureLocal).toBe("2026-10-25T02:30");
      expect(draft.departureFold).toBe("later");
      expect(toBusInput(draft).departureFold).toBe("later");
    });

    it("reads the earlier occurrence as earlier", () => {
      const draft = draftFrom(berlinRide("2026-10-25T00:30:00.000Z", "+02:00"));
      expect(draft.departureFold).toBe("earlier");
      expect(toBusInput(draft).departureFold).toBe("earlier");
    });

    it("has no fold for a clock that exists once, and sends none", () => {
      const draft = draftFrom(rideFixture());
      expect(draft.departureFold).toBeNull();
      expect(draft.arrivalFold).toBeNull();
      const input = toBusInput(draft);
      expect(input.departureFold).toBeNull();
      expect(input.arrivalFold).toBeNull();
    });

    it("sends no fold for an end that is only a day", () => {
      const draft = draftFrom(berlinRide("2026-10-25T01:30:00.000Z", "+01:00"));
      expect(toBusInput({ ...draft, departureDayOnly: true }).departureFold).toBeNull();
    });
  });

  describe("precision per end (forgejo#215)", () => {
    const withArrival = (arrival: Partial<TimeValue> | null, departure?: Partial<TimeValue>) => {
      const base = rideFixture();
      return {
        ...base,
        times: {
          ...base.times!,
          departure: { ...base.times!.departure!, ...departure },
          arrival: arrival ? { ...base.times!.arrival!, ...arrival } : null,
        },
      };
    };

    it("a timed departure with a day-only arrival keeps the arrival as a day", () => {
      const ride = withArrival({ local: "2026-09-20T00:00:00", precision: "day" });
      const draft = draftFrom(ride);
      expect(draft.departureDayOnly).toBe(false);
      expect(draft.arrivalDayOnly).toBe(true);
      const input = toBusInput(draft);
      expect(input.departureLocal).toBe("2026-09-20T09:00");
      expect(input.arrivalLocal).toBe("2026-09-20");
      expect(input.delayMinutes).toBeNull();
    });

    it("a day-only departure with a timed arrival keeps the arrival clock", () => {
      const ride = withArrival(null, { local: "2026-09-20T00:00:00", precision: "day" });
      const withClockedArrival = {
        ...ride,
        times: { ...ride.times, arrival: rideFixture().times!.arrival },
      };
      const input = toBusInput(draftFrom(withClockedArrival));
      expect(input.departureLocal).toBe("2026-09-20");
      expect(input.arrivalLocal).toBe("2026-09-20T11:20");
    });

    it("a day-only box beside an absent arrival does not block the delay", () => {
      const draft = {
        ...draftFrom(rideFixture()),
        arrivalLocal: "",
        arrivalDayOnly: true,
        delayMinutes: "12",
      };
      expect(toBusInput(draft).delayMinutes).toBe(12);
      expect(toBusInput({ ...draft, arrivalLocal: "2026-09-20" }).delayMinutes).toBeNull();
    });

    it("does not send a delay while either end is a day, but keeps it in the draft", () => {
      const draft = { ...draftFrom(rideFixture()), delayMinutes: "12" };
      expect(toBusInput(draft).delayMinutes).toBe(12);
      for (const flags of [{ departureDayOnly: true }, { arrivalDayOnly: true }]) {
        const blocked = { ...draft, ...flags };
        expect(toBusInput(blocked).delayMinutes).toBeNull();
        expect(blocked.delayMinutes).toBe("12");
      }
    });
  });
});
