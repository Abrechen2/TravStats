import { describe, expect, it } from "vitest";
import { canSubmit, draftFrom, saveErrorFrom, toBusInput } from "../busFormModel";
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
    expect(draft.dayOnly).toBe(false);
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
    expect(draft.dayOnly).toBe(true);
    const input = toBusInput(draft);
    expect(input.departureLocal).toBe("2026-09-20");
    expect(input.arrivalLocal).toBeNull();
  });

  it("day-only drops the clock part of both times", () => {
    const input = toBusInput({
      ...placed,
      dayOnly: true,
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
});
