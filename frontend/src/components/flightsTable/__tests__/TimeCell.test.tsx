import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TimeCell from "../TimeCell";
import type { Flight } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("shows airport-local times and a +1 marker for an overnight flight", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T19:40:00Z", arrivalTime: "2026-05-03T02:45:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Asia/Dubai",
  } as unknown as Flight} />);
  expect(screen.getByText(/21:40/)).toBeInTheDocument();
  expect(screen.getByText(/06:45/)).toBeInTheDocument();
  expect(screen.getByText("+1")).toBeInTheDocument();
});

it("shows date-only rows without marker for DATE_ONLY flights", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T12:00:00Z", arrivalTime: "2026-05-02T12:00:00Z",
    depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "DATE_ONLY",
  } as unknown as Flight} />);
  expect(screen.queryByText(/12:00/)).not.toBeInTheDocument();
  expect(screen.queryByText("+1")).not.toBeInTheDocument();
});

it("renders an em dash when no departure time exists", () => {
  render(<TimeCell flight={base} />);
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});

it("suppresses only the arrival time when arr is DATE_ONLY but dep is precise", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T19:40:00Z", arrivalTime: "2026-05-03T02:45:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Asia/Dubai",
    depTimeSemantics: "UTC", arrTimeSemantics: "DATE_ONLY",
  } as unknown as Flight} />);
  expect(screen.getByText(/21:40/)).toBeInTheDocument();      // dep time still shown
  expect(screen.queryByText(/06:45/)).not.toBeInTheDocument(); // arr time suppressed
  expect(screen.queryByText("+1")).not.toBeInTheDocument();    // no marker from a fake arrival
});

it("marks a time as UTC when the airport's timezone is unknown", () => {
  // A missing timezone used to render the UTC clock with the exact styling of
  // a real local time, so "16:25" read as Barcelona local when it was UTC.
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-09-09T14:25:00Z", arrivalTime: "2026-09-09T18:00:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: null,
  } as unknown as Flight} />);
  expect(screen.getByText("16:25")).toBeInTheDocument();   // dep, Berlin-local (+2)
  expect(screen.getByText("18:00")).toBeInTheDocument();   // arr, raw UTC clock
  expect(screen.getByText("UTC")).toBeInTheDocument();     // ...and it says so
});

it("marks both sides as UTC when neither airport resolves a timezone", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-09-09T14:25:00Z", arrivalTime: "2026-09-09T16:25:00Z",
    depTimezone: null, arrTimezone: null,
  } as unknown as Flight} />);
  expect(screen.getAllByText("UTC")).toHaveLength(2);
});

it("shows no UTC marker when both timezones are known", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-09-09T14:25:00Z", arrivalTime: "2026-09-09T16:25:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Europe/Madrid",
  } as unknown as Flight} />);
  expect(screen.queryByText("UTC")).not.toBeInTheDocument();
});

it("does not mark a DATE_ONLY row as UTC — no clock is shown to mislabel", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T12:00:00Z", arrivalTime: "2026-05-02T12:00:00Z",
    depTimezone: null, arrTimezone: null,
    depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "DATE_ONLY",
  } as unknown as Flight} />);
  expect(screen.queryByText("UTC")).not.toBeInTheDocument();
});

/* ── Actual times (issue #200 follow-up) ─────────────────────────────────────
   The times could be entered and were stored, but no read view ever showed
   them, so a typed actual time vanished. Alex's approved shape: the actual
   time sits beside the scheduled one, red when later, green when earlier. */

const withActuals = {
  ...base,
  departureTime: "2026-08-13T05:25:00Z",
  arrivalTime: "2026-08-13T06:35:00Z",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/London",
} as unknown as Flight;

it("shows a late actual departure next to the scheduled one", () => {
  render(<TimeCell flight={{ ...withActuals, actualDeparture: "2026-08-13T05:31:00Z" } as unknown as Flight} />);
  expect(screen.getByText("07:25")).toBeInTheDocument(); // scheduled, Berlin-local
  expect(screen.getByText("07:31")).toBeInTheDocument(); // actual, same timezone
});

it("colours a late actual time as a delay and an early one as a gain", () => {
  const { unmount } = render(
    <TimeCell flight={{ ...withActuals, actualDeparture: "2026-08-13T05:31:00Z" } as unknown as Flight} />,
  );
  expect(screen.getByText("07:31")).toHaveAttribute("data-delay", "late");
  unmount();

  render(<TimeCell flight={{ ...withActuals, actualArrival: "2026-08-13T06:28:00Z" } as unknown as Flight} />);
  expect(screen.getByText("07:28")).toHaveAttribute("data-delay", "early");
});

it("renders an actual time that matches the schedule as neither late nor early", () => {
  // Both clocks read the same here, so the text is ambiguous on purpose —
  // assert on the state instead. It is still rendered rather than hidden: the
  // user typed it, and "on time" is an answer, not an absence.
  const { container } = render(
    <TimeCell flight={{ ...withActuals, actualDeparture: "2026-08-13T05:25:00Z" } as unknown as Flight} />,
  );
  const actual = container.querySelector("[data-delay]");
  expect(actual).toHaveAttribute("data-delay", "onTime");
  expect(actual).toHaveTextContent("07:25");
});

it("uses the ARRIVAL timezone for the actual arrival, not the departure one", () => {
  // Berlin is +2, London +1 in August. Formatting the arrival with the
  // departure zone would print 07:28 and read as an hour later than it was.
  render(<TimeCell flight={{ ...withActuals, actualArrival: "2026-08-13T06:28:00Z" } as unknown as Flight} />);
  expect(screen.getByText("07:28")).toBeInTheDocument();
  expect(screen.queryByText("08:28")).not.toBeInTheDocument();
});

it("shows nothing extra when no actual time was recorded", () => {
  const { container } = render(<TimeCell flight={withActuals} />);
  expect(container.querySelectorAll("[data-delay]")).toHaveLength(0);
});

it("does not show an actual time on a DATE_ONLY row, where no clock is shown at all", () => {
  render(
    <TimeCell
      flight={{
        ...withActuals,
        depTimeSemantics: "DATE_ONLY",
        actualDeparture: "2026-08-13T05:31:00Z",
      } as unknown as Flight}
    />,
  );
  expect(screen.queryByText("07:31")).not.toBeInTheDocument();
});

it("keeps the overnight marker on the SCHEDULED legs, so a delay cannot invent a +1", () => {
  render(
    <TimeCell
      flight={{
        ...base,
        // Scheduled: 12:00 -> 23:30 Berlin-local, same calendar day.
        departureTime: "2026-05-02T10:00:00Z",
        arrivalTime: "2026-05-02T21:30:00Z",
        depTimezone: "Europe/Berlin",
        arrTimezone: "Europe/Berlin",
        // Actual arrival slips past midnight (00:30). The marker describes the
        // schedule, so it must not react to that.
        actualArrival: "2026-05-02T22:30:00Z",
      } as unknown as Flight}
    />,
  );
  expect(screen.queryByText("+1")).not.toBeInTheDocument();
});

it("suppresses only the departure time when dep is DATE_ONLY but arr is precise", () => {
  render(<TimeCell flight={{
    ...base,
    departureTime: "2026-05-02T12:00:00Z", arrivalTime: "2026-05-02T15:00:00Z",
    depTimezone: "Europe/Berlin", arrTimezone: "Europe/Berlin",
    depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "UTC",
  } as unknown as Flight} />);
  expect(screen.queryByText(/14:00/)).not.toBeInTheDocument(); // dep local 14:00 suppressed
  expect(screen.getByText(/17:00/)).toBeInTheDocument();       // arr local 17:00 shown
  expect(screen.queryByText("+1")).not.toBeInTheDocument();    // marker needs BOTH legs precise
});
