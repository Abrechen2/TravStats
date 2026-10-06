import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.reference ? `${k}:${String(o.reference)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
const addToast = vi.fn();
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../rail/RailImportPreviewModal", () => ({
  RailImportPreviewModal: ({ booking }: { booking: { legs: unknown[] } }) => (
    <div data-testid="rail-review">{booking.legs.length}</div>
  ),
}));
vi.mock("../../../rail/RailReservationReviewModal", () => ({
  RailReservationReviewModal: ({ booking }: { booking: { legs: unknown[] } }) => (
    <div data-testid="rail-reservation-review">{booking.legs.length}</div>
  ),
}));
vi.mock("../../../rail/RailFormModal", () => ({ RailFormModal: () => null }));

import { useRailImportAdapter } from "../railAdapter";
import { booking } from "../../../rail/__tests__/railImportFixture";
import { reservationBooking, reservationLeg } from "../../../rail/__tests__/railReservationFixture";

function renderReview(parseResult: unknown, onCancel = vi.fn()) {
  const { result } = renderHook(() => useRailImportAdapter());
  render(
    <>
      {result.current.renderReviewModal({
        parseResult,
        onCommit: vi.fn(),
        onCancel,
      })}
    </>
  );
  return { adapter: result.current, onCancel };
}

describe("rail import adapter", () => {
  beforeEach(() => addToast.mockReset());

  it("is a parseable rail adapter", () => {
    const { adapter } = renderReview({ domain: "rail", bookings: [booking()] });
    expect(adapter.domain).toBe("rail");
    expect(screen.getByTestId("rail-review")).toHaveTextContent("2");
    expect(addToast).not.toHaveBeenCalled();
  });

  // forgejo#203: a later seat reservation opens the reservation review, which
  // writes seats onto existing journeys — never the review that creates rides.
  it("opens the reservation review for a reservation document", () => {
    renderReview({
      domain: "rail",
      bookings: [reservationBooking([reservationLeg({ kind: "none", reason: "noJourney" })])],
    });
    expect(screen.getByTestId("rail-reservation-review")).toHaveTextContent("1");
    expect(screen.queryByTestId("rail-review")).toBeNull();
  });

  it("says in the reader's words why nothing was read, naming the order, and closes the slot", () => {
    const { onCancel } = renderReview({
      domain: "rail",
      bookings: [],
      parserUsed: "none",
      fallbackCode: "noItinerary",
      fallbackReason: "The order mail names no ride; its itinerary is in the attached ticket",
      orderReference: "Q7X2KT",
    });
    expect(addToast).toHaveBeenCalledWith("error", "rail:import.empty.noItinerary:Q7X2KT");
    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByTestId("rail-review")).toBeNull();
  });

  it("never shows the server's English reason", () => {
    renderReview({
      domain: "rail",
      bookings: [],
      fallbackCode: "llmUnreachable",
      fallbackReason: "Ollama is not reachable at http://127.0.0.1:11434",
    });
    expect(addToast).toHaveBeenCalledWith("error", "rail:import.empty.llmUnreachable");
  });
});
