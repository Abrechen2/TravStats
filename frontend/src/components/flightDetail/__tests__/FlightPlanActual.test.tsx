import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Flight } from "../../../types";
import type { TimeValue } from "../../../shared/time";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import FlightPlanActual from "../FlightPlanActual";

const at = (local: string, utc: string, zone: string | null, offset: string): TimeValue => ({
  local,
  utc,
  zone,
  offset,
  precision: "minute",
});

function flight(times: Flight["times"]): Flight {
  return {
    id: "f1",
    airline: "Lufthansa",
    flightNumber: "LH400",
    departureTime: "",
    arrivalTime: "",
    status: "flown",
    createdAt: "2026-01-01T00:00:00Z",
    times,
  } as unknown as Flight;
}

/** forgejo#216 — what a reader sees for plan against record. */
describe("FlightPlanActual", () => {
  it("shows plan, record and the spelled-out deviation per end, with the airport's zone", () => {
    render(
      <FlightPlanActual
        flight={flight({
          departure: at("2026-10-09T18:05:00", "2026-10-09T16:05:00Z", "Europe/Berlin", "+02:00"),
          arrival: at("2026-10-09T20:40:00", "2026-10-10T00:40:00Z", "America/New_York", "-04:00"),
          actualDeparture: at(
            "2026-10-09T18:47:00",
            "2026-10-09T16:47:00Z",
            "Europe/Berlin",
            "+02:00"
          ),
          actualArrival: null,
        })}
      />
    );
    const dep = screen.getByTestId("plan-actual-departure");
    expect(within(dep).getByTestId("plan-actual-departure-planned")).toHaveTextContent("18:05");
    expect(within(dep).getByTestId("plan-actual-departure-planned")).toHaveTextContent(
      "Europe/Berlin · UTC+02:00"
    );
    expect(within(dep).getByTestId("plan-actual-departure-actual")).toHaveTextContent("18:47");
    // The deviation in words — sign and "later" — not only in a colour.
    expect(within(dep).getByTestId("plan-actual-departure-deviation")).toHaveTextContent(
      'flights:planActual.later {"duration":"flights:planActual.durationM {\\"m\\":42}"}'
    );

    const arr = screen.getByTestId("plan-actual-arrival");
    expect(within(arr).getByTestId("plan-actual-arrival-planned")).toHaveTextContent(
      "America/New_York · UTC-04:00"
    );
    // No landing recorded: "unbekannt" and the reason, never a zero.
    expect(within(arr).getByTestId("plan-actual-arrival-actual")).toHaveTextContent(
      "flights:planActual.unknown"
    );
    expect(within(arr).getByTestId("plan-actual-arrival-deviation")).toHaveTextContent(
      "flights:planActual.unknownReason.noActual"
    );
    expect(arr).not.toHaveTextContent("durationM");
  });

  it("names an arrival on the next day out loud", () => {
    render(
      <FlightPlanActual
        flight={flight({
          departure: at("2026-10-09T22:30:00", "2026-10-09T20:30:00Z", "Europe/Berlin", "+02:00"),
          arrival: at("2026-10-10T06:10:00", "2026-10-10T02:10:00Z", "Asia/Dubai", "+04:00"),
          actualDeparture: at(
            "2026-10-09T22:30:00",
            "2026-10-09T20:30:00Z",
            "Europe/Berlin",
            "+02:00"
          ),
          actualArrival: at("2026-10-10T06:00:00", "2026-10-10T02:00:00Z", "Asia/Dubai", "+04:00"),
        })}
      />
    );
    expect(screen.getByTestId("plan-actual-arrival-planned")).toHaveTextContent(
      'flights:planActual.arrivalLaterDay {"count":1}'
    );
    expect(screen.getByTestId("plan-actual-arrival-actual")).toHaveTextContent(
      'flights:planActual.arrivalLaterDay {"count":1}'
    );
    expect(screen.getByTestId("plan-actual-departure-deviation")).toHaveTextContent(
      "flights:planActual.onTime"
    );
    expect(screen.getByTestId("plan-actual-arrival-deviation")).toHaveTextContent(
      'flights:planActual.earlier {"duration":"flights:planActual.durationM {\\"m\\":10}"}'
    );
  });

  it("says where the airport's zone is unknown instead of passing UTC off as local", () => {
    render(
      <FlightPlanActual
        flight={flight({
          departure: at("2026-10-09T16:05:00", "2026-10-09T16:05:00Z", null, "+00:00"),
          arrival: null,
        })}
      />
    );
    expect(screen.getByTestId("plan-actual-departure-planned")).toHaveTextContent(
      "flights:planActual.zoneUnknown"
    );
    expect(screen.getByTestId("plan-actual-arrival-planned")).toHaveTextContent(
      "flights:planActual.plannedMissing"
    );
  });

  it("shows a day-only plan with its date, says the clock is unknown, and measures nothing", () => {
    render(
      <FlightPlanActual
        flight={flight({
          departure: {
            ...at("2026-10-09T00:00:00", "2026-10-08T22:00:00Z", "Europe/Berlin", "+02:00"),
            precision: "day",
          },
          arrival: null,
          actualDeparture: at(
            "2026-10-09T09:12:00",
            "2026-10-09T07:12:00Z",
            "Europe/Berlin",
            "+02:00"
          ),
        })}
      />
    );
    const planned = screen.getByTestId("plan-actual-departure-planned");
    expect(planned).toHaveTextContent("09.10.2026");
    expect(planned).toHaveTextContent("flights:planActual.clockUnknown");
    expect(planned).not.toHaveTextContent("UTC+02:00");
    expect(screen.getByTestId("plan-actual-departure-deviation")).toHaveTextContent(
      "flights:planActual.unknownReason.planNotToMinute"
    );
  });
});
