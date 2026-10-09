import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Flight } from "../../../types";
import type { TimeValue } from "../../../shared/time";
import type { FlightBookingState } from "../useFlightBooking";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import BookingItinerary from "../BookingItinerary";

const cest = (local: string, utc: string, precision: TimeValue["precision"] = "minute") =>
  ({ local, utc, zone: "Europe/Berlin", offset: "+02:00", precision }) as TimeValue;

function seg(id: string, from: string, to: string, dep: TimeValue, arr: TimeValue | null): Flight {
  return {
    id,
    airline: "Lufthansa",
    flightNumber: id.toUpperCase(),
    depIata: from,
    arrIata: to,
    departureTime: dep.utc,
    arrivalTime: arr?.utc ?? "",
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00Z",
    bookingId: "b1",
    times: { departure: dep, arrival: arr },
  } as unknown as Flight;
}

const BOOKING = {
  id: "b1",
  pnr: "ABC123",
  price: 480,
  currency: "EUR",
  otherEntries: 0,
  split: null,
};

const loaded = (segments: Flight[]): FlightBookingState => ({
  kind: "loaded",
  answer: { booking: BOOKING, segments },
});

function renderIt(state: FlightBookingState, flightId = "lh1", onRetry = vi.fn()) {
  return render(
    <MemoryRouter>
      <BookingItinerary flightId={flightId} state={state} onRetry={onRetry} />
    </MemoryRouter>
  );
}

const first = seg(
  "lh1",
  "MUC",
  "FRA",
  cest("2026-10-12T07:00:00", "2026-10-12T05:00:00Z"),
  cest("2026-10-12T08:05:00", "2026-10-12T06:05:00Z")
);

/** forgejo#218 — a booking read as one journey, without promising a connection. */
describe("BookingItinerary", () => {
  it("lists the segments in order, links the others and marks this one", () => {
    const second = seg(
      "lh400",
      "FRA",
      "JFK",
      cest("2026-10-12T09:00:00", "2026-10-12T07:00:00Z"),
      null
    );
    renderIt(loaded([first, second]));
    const list = screen.getByTestId("booking-itinerary");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1. MUC → FRA");
    expect(within(items[0]).queryByRole("link")).toBeNull();
    expect(items[0].querySelector('[aria-current="page"]')).not.toBeNull();
    expect(within(items[1]).getByRole("link", { name: "2. FRA → JFK" })).toHaveAttribute(
      "href",
      "/flights/lh400"
    );
    expect(screen.getByTestId("itinerary-transfer-1")).toHaveTextContent(
      'flights:itinerary.transfer {"airport":"FRA","duration":"flights:planActual.durationM {\\"m\\":55}"}'
    );
    expect(screen.getByText("flights:itinerary.noReachabilityClaim")).toBeInTheDocument();
  });

  it("names a change of airport and a conflict without calling either reachable", () => {
    const elsewhere = {
      ...seg("x2", "HHN", "JFK", cest("2026-10-12T07:55:00", "2026-10-12T05:55:00Z"), null),
    };
    renderIt(loaded([first, elsewhere]));
    const note = screen.getByTestId("itinerary-transfer-1");
    expect(note).toHaveTextContent('flights:itinerary.conflict {"duration"');
    expect(note).toHaveTextContent('flights:itinerary.airportChange {"from":"FRA","to":"HHN"}');
    expect(note).not.toHaveTextContent(/reach/i);
  });

  it("says unknown where a day-only flight shares the day, instead of guessing a wait", () => {
    const dayOnly = seg(
      "x3",
      "FRA",
      "JFK",
      cest("2026-10-12T00:00:00", "2026-10-11T22:00:00Z", "day"),
      null
    );
    renderIt(loaded([dayOnly, first]), "x3");
    expect(screen.getByTestId("itinerary-transfer-1")).toHaveTextContent(
      "flights:itinerary.orderUnknown"
    );
  });

  it("draws nothing for a booking of one flight, or none", () => {
    const { container, rerender } = renderIt(loaded([first]));
    expect(container).toBeEmptyDOMElement();
    rerender(
      <MemoryRouter>
        <BookingItinerary flightId="lh1" state={{ kind: "none" }} onRetry={vi.fn()} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says the segments could not be loaded and offers a retry", async () => {
    const onRetry = vi.fn();
    renderIt({ kind: "failed" }, "lh1", onRetry);
    expect(screen.getByRole("alert")).toHaveTextContent("flights:itinerary.loadFailed");
    await userEvent.setup().click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
