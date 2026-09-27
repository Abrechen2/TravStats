import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TimeCell from "../TimeCell";
import type { Flight } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

/**
 * The flights table shows the server's `times.*.local` as it is (ADR 0002,
 * phase 4): the zone the flight was WRITTEN with, not today's catalogue zone
 * in the legacy `depTimezone`, and never the reader's own.
 *
 * The fixture makes the two disagree on purpose: the flight was stored at
 * Haneda (01:00 on 1 August) while the legacy field names Berlin, where the
 * same instant reads 18:00 on 31 July.
 */
const flight = {
  id: "1",
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 0,
  departureTime: "2026-07-31T16:00:00.000Z",
  arrivalTime: "2026-08-01T04:25:00.000Z",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Berlin",
  times: {
    departure: {
      utc: "2026-07-31T16:00:00.000Z",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      local: "2026-08-01T01:00:00",
      precision: "minute",
      zoneSource: "stored",
    },
    arrival: {
      utc: "2026-08-01T04:25:00.000Z",
      zone: "Europe/Berlin",
      offset: "+02:00",
      local: "2026-08-01T06:25:00",
      precision: "minute",
      zoneSource: "stored",
    },
  },
} as unknown as Flight;

it("shows the departure on the clock it was stored with", () => {
  render(<TimeCell flight={flight} />);
  expect(screen.getByText("01:00")).toBeInTheDocument();
  expect(screen.queryByText("18:00")).not.toBeInTheDocument();
  // Both ends on the airports' 1 August; the departure is not on 31 July.
  expect(screen.getAllByText(/01\.08\.26/)).toHaveLength(2);
  expect(screen.queryByText(/31\.07\.26/)).not.toBeInTheDocument();
});

it("counts the overnight marker on the airports' own days", () => {
  // Both ends on 1 August locally: no +1, although the UTC days differ.
  render(<TimeCell flight={flight} />);
  expect(screen.queryByText("+1")).not.toBeInTheDocument();
});

it("labels a time whose airport has no zone as UTC", () => {
  const noZone = {
    ...flight,
    times: {
      departure: {
        ...flight.times!.departure!,
        zone: null,
        offset: "+00:00",
        local: "2026-07-31T16:00:00",
        zoneSource: null,
      },
      arrival: null,
    },
  } as unknown as Flight;
  render(<TimeCell flight={noZone} />);
  expect(screen.getByText("16:00")).toBeInTheDocument();
  expect(screen.getByText("UTC")).toBeInTheDocument();
});
