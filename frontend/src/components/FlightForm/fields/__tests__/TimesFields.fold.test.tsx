import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import TimesFields from "../TimesFields";
import { buildFlightPayload, type FlightPayloadFields } from "../../flightPayload";
import { storedFlightFolds, type FlightFolds } from "../../../../lib/flightFolds";
import type { Airport } from "../../../../lib/api";

/**
 * "Die spätere meinen" in the flight form (ADR 0002 Q5).
 *
 * On 31 October 2027 Berlin's clocks go back at 03:00, so 02:30 happens
 * twice. The server takes the earlier one unless the body says
 * `departureFold: "later"`; the flight forms had no way to say it, so a
 * flight in the second 02:30 was stored an hour early. What the user sees:
 * the notice and the checkbox beside the time — and what the save sends.
 */
const BERLIN_FOLD = {
  depDate: "2027-10-31",
  depTime: "02:30",
  arrDate: "2027-10-31",
  arrTime: "05:00",
};

function Harness({ onFolds }: { onFolds: (f: FlightFolds) => void }) {
  const [folds, setFolds] = useState<FlightFolds>({});
  return (
    <TimesFields
      value={BERLIN_FOLD}
      onChange={() => {}}
      clockChange={{
        depZone: "Europe/Berlin",
        arrZone: "Atlantic/Canary",
        folds,
        onFoldsChange: (next) => {
          setFolds(next);
          onFolds(next);
        },
      }}
    />
  );
}

describe("flight form — the repeated hour", () => {
  it("says the time exists twice and lets the user mean the later one", async () => {
    const onFolds = vi.fn();
    render(<Harness onFolds={onFolds} />);
    const later = screen.getByRole("checkbox", { name: /spätere|later/i });
    await userEvent.click(later);
    expect(onFolds).toHaveBeenLastCalledWith({ dep: "later" });
    // Only the departure is in the repeated hour; the arrival shows nothing.
    expect(screen.getAllByRole("checkbox", { name: /spätere|later/i })).toHaveLength(1);
  });

  it("shows nothing for an ordinary time", () => {
    render(
      <TimesFields
        value={{ ...BERLIN_FOLD, depTime: "09:00" }}
        onChange={() => {}}
        clockChange={{ depZone: "Europe/Berlin", arrZone: null, folds: {}, onFoldsChange: vi.fn() }}
      />
    );
    expect(screen.queryByRole("checkbox", { name: /spätere|later/i })).toBeNull();
  });
});

const airport = (iata: string, timezone: string): Airport =>
  ({ iata, icao: "", name: iata, lat: 0, lon: 0, timezone }) as Airport;

const fields = (over: Partial<FlightPayloadFields>): FlightPayloadFields =>
  ({
    status: "scheduled",
    departureDate: "2027-10-31",
    departureTime: "02:30",
    arrivalDate: "2027-10-31",
    arrivalTime: "05:00",
    departure: airport("BER", "Europe/Berlin"),
    arrival: airport("LPA", "Atlantic/Canary"),
    depTz: "Europe/Berlin",
    arrTz: "Atlantic/Canary",
    actualDepartureDate: "",
    actualDepartureTime: "",
    actualArrivalDate: "",
    actualArrivalTime: "",
    tags: [],
    companions: [],
    coPassengers: [],
    ...over,
  }) as FlightPayloadFields;

describe("flight payload — the fold the server accepts", () => {
  it("sends departureFold: later when the user chose it", () => {
    expect(buildFlightPayload(fields({ folds: { dep: "later" } })).departureFold).toBe("later");
  });

  it("sends no fold by default — the server's earlier occurrence", () => {
    expect(buildFlightPayload(fields({})).departureFold).toBeUndefined();
  });

  it("drops a fold once the time is no longer repeated", () => {
    const body = buildFlightPayload(fields({ departureTime: "09:00", folds: { dep: "later" } }));
    expect(body.departureFold).toBeUndefined();
  });
});

describe("flight edit — the stored occurrence is kept", () => {
  it("reads a stored second 02:30 back as the later one", () => {
    const later = {
      utc: "2027-10-31T01:30:00.000Z",
      zone: "Europe/Berlin",
      offset: "+01:00",
      local: "2027-10-31T02:30:00",
      precision: "minute" as const,
    };
    expect(storedFlightFolds(later, null)).toEqual({ dep: "later" });
    expect(storedFlightFolds({ ...later, utc: "2027-10-31T00:30:00.000Z" }, null)).toEqual({});
  });
});
