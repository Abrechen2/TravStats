import { describe, it, expect, vi } from "vitest";
import type { MutableRefObject } from "react";
import { prepareNextLegForm } from "../flightFormReturn";
import type { FlightFormState } from "../useFlightFormState";

/**
 * "Weiteren Flug anlegen": the next flight of a multi-leg day keeps what a
 * traveller repeats (airline, trip, class, companions), starts where the last
 * one ended and suggests the previous arrival date — and starts empty on
 * everything that belonged to the saved booking or leg.
 */
function fakeState(): { s: FlightFormState; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string) =>
    vi.fn((v: unknown) => {
      (calls[name] ??= []).push(v);
    });
  const names = [
    "setDeparture",
    "setArrival",
    "setFlightNumber",
    "setAircraft",
    "setTerminal",
    "setGate",
    "setSeatNumber",
    "setBoardingGroup",
    "setNotes",
    "setReceiptUrl",
    "setOperatingAirline",
    "setBookingReference",
    "setTicketNumber",
    "setBookingClassLetter",
    "setPrice",
    "setTaxes",
    "setFees",
    "setDepartureDate",
    "setArrivalDate",
    "setDepartureTime",
    "setArrivalTime",
    "setStep",
    "setError",
    "setTimeEstimationWarning",
    // The kept fields' setters: a regression that clears them shows up here.
    "setAirline",
    "setSeatClass",
    "setCategory",
    "setCompanions",
    "setTripId",
  ];
  const s: Record<string, unknown> = {
    departure: { iata: "FRA" },
    arrival: { iata: "LHR" },
    arrivalDate: "2026-05-04",
    meta: Object.fromEntries(
      [
        "setLookupCallsign",
        "setLookupAircraftRegistration",
        "setLookupAircraftModeS",
        "setLookupAirlineIata",
        "setLookupAirlineIcao",
        "setLookupIsCodeshare",
      ].map((n) => [n, vi.fn()])
    ),
  };
  for (const n of names) s[n] = rec(n);
  return { s: s as unknown as FlightFormState, calls };
}

describe("prepareNextLegForm", () => {
  it("starts at the last destination with the destination left open", () => {
    const { s, calls } = fakeState();
    prepareNextLegForm(s, { current: true } as MutableRefObject<boolean>);
    expect(calls.setDeparture).toEqual([{ iata: "LHR" }]);
    expect(calls.setArrival).toEqual([null]);
  });

  it("suggests the previous arrival date, not today", () => {
    const { s, calls } = fakeState();
    prepareNextLegForm(s, { current: true } as MutableRefObject<boolean>);
    expect(calls.setDepartureDate).toEqual(["2026-05-04"]);
  });

  it("keeps airline, trip, class and companions untouched", () => {
    const { s, calls } = fakeState();
    prepareNextLegForm(s, { current: true } as MutableRefObject<boolean>);
    for (const kept of [
      "setAirline",
      "setSeatClass",
      "setCategory",
      "setCompanions",
      "setTripId",
    ]) {
      expect(calls[kept]).toBeUndefined();
    }
  });

  it("clears the booking and the leg", () => {
    const { s, calls } = fakeState();
    prepareNextLegForm(s, { current: true } as MutableRefObject<boolean>);
    for (const cleared of [
      "setFlightNumber",
      "setSeatNumber",
      "setBookingReference",
      "setTicketNumber",
      "setPrice",
      "setReceiptUrl",
    ]) {
      expect(calls[cleared]).toHaveLength(1);
    }
  });
});
