import { describe, it, expect } from "vitest";
import { actualPairErrors, flightCreateGaps, flightCreateSnapshot } from "./createFormState";
import { stableSnapshot } from "../form/useDirtyGuard";
import type { Airport } from "../../lib/api";

const t = (k: string): string => k;
const muc = { iata: "MUC", icao: "EDDM" } as Airport;

const base = {
  departure: muc,
  arrival: muc,
  status: "scheduled",
  departureDate: "2026-10-09",
  departureTime: "12:00",
  arrivalDate: "2026-10-09",
  arrivalTime: "14:00",
  actualDepartureDate: "",
  actualDepartureTime: "",
  actualArrivalDate: "",
  actualArrivalTime: "",
};

/** forgejo#245 — the line beside the save names exactly what `canSubmit` refuses. */
describe("flightCreateGaps", () => {
  it("names nothing for a complete form", () => {
    expect(flightCreateGaps(base, t)).toEqual([]);
  });

  it("names the airports and every empty scheduled field, in form order", () => {
    const gaps = flightCreateGaps(
      { ...base, departure: null, arrival: null, departureTime: "", arrivalDate: "" },
      t
    );
    expect(gaps.map((g) => g.label)).toEqual([
      "flights:form.missing.departureAirport",
      "flights:form.missing.arrivalAirport",
      "flights:form.missing.departureTime",
      "flights:form.missing.arrivalDate",
    ]);
    expect(gaps[0].field).toBe("flight-form-departure-airport");
  });

  it("asks only for the airports on a historical flight", () => {
    expect(flightCreateGaps({ ...base, status: "historical", departureTime: "" }, t)).toEqual([]);
  });

  it("names the missing time of a half-filled actual pair", () => {
    const gaps = flightCreateGaps({ ...base, actualDepartureDate: "2026-10-09" }, t);
    expect(gaps).toEqual([
      { field: "timesFieldsActualDepTime", label: "flights:form.missing.actualDepartureTime" },
    ]);
    expect(actualPairErrors({ ...base, actualDepartureDate: "2026-10-09" }, t)).toEqual({
      actualDepTime: "flights:form.errors.actualTimeMissing",
      actualArrTime: null,
    });
  });
});

describe("flightCreateSnapshot", () => {
  it("ignores the status the date derives, but not one the user chose", () => {
    const a = stableSnapshot(flightCreateSnapshot({ ...base, status: "flown" }));
    const b = stableSnapshot(flightCreateSnapshot({ ...base, status: "scheduled" }));
    const c = stableSnapshot(flightCreateSnapshot({ ...base, status: "cancelled" }));
    expect(a).toBe(b);
    expect(c).not.toBe(b);
  });
});

describe("negative amounts", () => {
  it("names a negative price or fee, never a zero", () => {
    expect(flightCreateGaps({ ...base, price: -1, fees: 0 }, t)).toEqual([
      { field: "flight-form-cost-price", label: "flights:form.missing.price" },
    ]);
  });
});
