import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Flight } from "../../../types";
import type { FlightBookingAnswer, FlightBookingSummary } from "../../../types/flightBooking";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const split = vi.fn();
const removeSplit = vi.fn();
vi.mock("../../../lib/api/flightBooking", () => ({
  flightBookingApi: {
    split: (...a: unknown[]) => split(...a),
    removeSplit: (...a: unknown[]) => removeSplit(...a),
  },
}));

import BookingPrice from "../BookingPrice";

const seg = (id: string, from: string, to: string): Flight =>
  ({
    id,
    airline: "LH",
    flightNumber: id,
    depIata: from,
    arrIata: to,
    departureTime: "2026-11-02T06:00:00Z",
    arrivalTime: "2026-11-02T07:00:00Z",
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00Z",
    bookingId: "b1",
    tripId: "t1",
  }) as Flight;

const A = seg("a", "MUC", "FRA");
const B = seg("b", "FRA", "JFK");

function answer(
  over: Partial<FlightBookingSummary> = {},
  segments: Flight[] = [A, B]
): FlightBookingAnswer {
  return {
    booking: {
      id: "b1",
      pnr: "ABC123",
      price: 480,
      currency: "EUR",
      tripId: null,
      tripName: null,
      otherEntries: 0,
      split: null,
      ...over,
    },
    segments,
  };
}

function renderIt(a: FlightBookingAnswer, onAnswer = vi.fn()) {
  render(
    <MemoryRouter>
      <BookingPrice flight={A} answer={a} onAnswer={onAnswer} />
    </MemoryRouter>
  );
  return onAnswer;
}

/** forgejo#219 — where the booking total lives, how it counts, and a split that keeps every cent. */
describe("BookingPrice", () => {
  beforeEach(() => {
    split.mockReset();
    removeSplit.mockReset();
  });

  it("says the total lives on the booking and counts once, all-in", () => {
    renderIt(answer());
    const box = screen.getByTestId("booking-price");
    expect(box).toHaveTextContent("flights:bookingPrice.total");
    expect(box).toHaveTextContent("480 €");
    expect(box).toHaveTextContent("flights:bookingPrice.storedOnBooking");
    expect(box).toHaveTextContent("flights:bookingPrice.countedOnce");
    // No booking trip in this fixture: said, not linked to the flight's trip.
    expect(box).toHaveTextContent("flights:bookingPrice.noTrip");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("explains the fallback when the booking has no total, and offers no split", () => {
    renderIt(answer({ price: null }));
    expect(screen.getByTestId("booking-price")).toHaveTextContent("flights:bookingPrice.noTotal");
    expect(screen.queryByTestId("booking-split")).toBeNull();
  });

  it("reads 0 as free, not as missing", () => {
    renderIt(answer({ price: 0 }));
    expect(screen.getByTestId("booking-price")).toHaveTextContent(
      "flights:bookingPrice.zeroIsFree"
    );
  });

  it("offers no flights-only split when the booking also holds other entries", () => {
    renderIt(answer({ otherEntries: 1 }));
    expect(screen.getByTestId("booking-price")).toHaveTextContent(
      'flights:bookingPrice.otherEntries {"count":1}'
    );
    expect(screen.queryByTestId("booking-split")).toBeNull();
  });

  it("splits on request and hands the new answer up", async () => {
    const next = answer({
      split: {
        method: "equal",
        price: 480,
        currency: "EUR",
        shares: [
          { flightId: "a", amount: 240 },
          { flightId: "b", amount: 240 },
        ],
        staleReason: null,
      },
    });
    split.mockResolvedValue(next);
    const onAnswer = renderIt(answer());
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "flights:bookingPrice.splitEqual" }));
    expect(split).toHaveBeenCalledWith("a", "equal");
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(next));
  });

  it("lists the shares with their sum against the total, and marks a stale split", () => {
    renderIt(
      answer({
        price: 500,
        split: {
          method: "distance",
          price: 480,
          currency: "EUR",
          shares: [
            { flightId: "a", amount: 30.01 },
            { flightId: "b", amount: 449.99 },
          ],
          staleReason: "price",
        },
      })
    );
    const box = screen.getByTestId("booking-split");
    const rows = within(box).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("1. MUC → FRA");
    expect(rows[0]).toHaveTextContent("30,01");
    expect(rows[1]).toHaveTextContent("449,99");
    expect(screen.getByTestId("booking-split-sum")).toHaveTextContent(/"sum":"480 €"/);
    expect(screen.getByRole("status")).toHaveTextContent("flights:bookingPrice.stale.price");
  });

  it("names a refusal by its code and keeps the controls", async () => {
    split.mockRejectedValue(
      Object.assign(new Error("422"), {
        isAxiosError: true,
        response: { status: 422, data: { code: "BOOKING_SPLIT_DISTANCE_UNKNOWN" } },
      })
    );
    const onAnswer = renderIt(answer());
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "flights:bookingPrice.splitDistance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "flights:bookingPrice.errors.distanceUnknown"
    );
    expect(onAnswer).not.toHaveBeenCalled();
    // A refusal of the input is not retried; a dropped connection would be.
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).toBeNull();
  });

  it("offers a retry for a dropped connection, and the retry repeats the same split", async () => {
    split
      .mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true }))
      .mockResolvedValue(answer());
    const user = userEvent.setup();
    const onAnswer = renderIt(answer());
    await user.click(screen.getByRole("button", { name: "flights:bookingPrice.splitDistance" }));
    await user.click(await screen.findByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    expect(split).toHaveBeenLastCalledWith("a", "distance");
  });

  it("links to the trip the BOOKING hangs on, not the flight's (review I4)", () => {
    // The flight sits on t1 (moved there by a bulk edit); the booking stays on tA.
    renderIt(answer({ tripId: "tA", tripName: "Buchungsreise" }));
    expect(
      screen.getByRole("link", {
        name: 'flights:bookingPrice.editOnNamedTrip {"name":"Buchungsreise"}',
      })
    ).toHaveAttribute("href", "/trips/tA");
  });

  it("states the cost rule as the server applies it (review M1)", async () => {
    const de = (await import("../../../i18n/resources/de/flights.json")).default.bookingPrice;
    const en = (await import("../../../i18n/resources/en/flights.json")).default.bookingPrice;
    expect(de.countedOnce).toMatch(/annullierter Flug kostet nichts/);
    expect(de.countedOnce).toMatch(/zwei Reisen.*bei jeder dieser Reisen/);
    expect(de.noTotal).toMatch(/ohne Preis, Steuern und Gebühren/);
    expect(en.countedOnce).toMatch(/cancelled flight costs nothing/);
    expect(en.countedOnce).toMatch(/two trips.*each of those trips/);
    expect(en.noTotal).toMatch(/without price, taxes and fees/);
  });
});
