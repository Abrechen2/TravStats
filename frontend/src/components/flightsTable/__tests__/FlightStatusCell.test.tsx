/**
 * "Dupliziert" is a statement about the RECORD, not about where the flight is
 * in time. It used to occupy the status pill, which meant a duplicate row had
 * no travel state on screen at all — it could not tell you whether the flight
 * it duplicates had already happened.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FlightStatusCell from "../FlightStatusCell";
import type { Flight } from "../../../types";

const DAY = 24 * 60 * 60 * 1000;

function makeFlight(over: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    status: "flown",
    departureTime: new Date(Date.now() - 30 * DAY).toISOString(),
    arrivalTime: new Date(Date.now() - 30 * DAY + 3600_000).toISOString(),
    ...over,
  } as Flight;
}

describe("FlightStatusCell", () => {
  it("shows a normal status as the pill and nothing else", () => {
    render(<FlightStatusCell flight={makeFlight({ status: "flown" })} />);
    expect(screen.getByText("flights:status.flown")).toBeInTheDocument();
    expect(screen.queryByTestId("flight-duplicate-f1")).not.toBeInTheDocument();
  });

  it("leaves the other passthrough statuses alone", () => {
    render(<FlightStatusCell flight={makeFlight({ status: "historical" })} />);
    expect(screen.getByText("flights:status.historical")).toBeInTheDocument();
    expect(screen.queryByTestId("flight-duplicate-f1")).not.toBeInTheDocument();
  });

  it("gives a duplicate its travel status back — the dates decide", () => {
    // Stored as "duplicated", but the flight is 30 days past: the pill must
    // say what happened, not what kind of row this is.
    render(<FlightStatusCell flight={makeFlight({ status: "duplicated" })} />);
    expect(screen.getByText("flights:status.flown")).toBeInTheDocument();
  });

  it("reads a future duplicate as scheduled", () => {
    render(
      <FlightStatusCell
        flight={makeFlight({
          status: "duplicated",
          departureTime: new Date(Date.now() + 10 * DAY).toISOString(),
          arrivalTime: new Date(Date.now() + 10 * DAY + 3600_000).toISOString(),
        })}
      />
    );
    expect(screen.getByText("flights:status.scheduled")).toBeInTheDocument();
  });

  it("carries the duplicate as a separate, explained tag", () => {
    render(<FlightStatusCell flight={makeFlight({ status: "duplicated" })} />);
    const tag = screen.getByTestId("flight-duplicate-f1");
    expect(tag.textContent).toContain("flights:status.duplicated");
    // A tag nobody can interpret is worse than none — it says why it is there.
    expect(tag).toHaveAttribute("title", "flights:status.duplicatedHint");
  });

  it("keeps the tag neutral — a duplicate is not an alarm", () => {
    render(<FlightStatusCell flight={makeFlight({ status: "duplicated" })} />);
    const cls = screen.getByTestId("flight-duplicate-f1").className;
    expect(cls).toContain("text-(--text-muted)");
    expect(cls).not.toMatch(/danger|red/);
  });

  it("still shows a status for a duplicate with no dates at all", () => {
    render(
      <FlightStatusCell
        flight={makeFlight({ status: "duplicated", departureTime: null, arrivalTime: null })}
      />
    );
    expect(screen.getByText("flights:status.scheduled")).toBeInTheDocument();
    expect(screen.getByTestId("flight-duplicate-f1")).toBeInTheDocument();
  });
});
