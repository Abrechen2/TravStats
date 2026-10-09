import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Flight } from "../../../types";
import type { TravelDocument } from "../../../lib/api/documents";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const listForEntry = vi.fn();
vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) } };
});
const copyToClipboard = vi.fn();
vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));

import FlightDayCard, { DAY_CARD_TOUCH } from "../FlightDayCard";

function flight(over: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    airline: "Lufthansa",
    flightNumber: "LH2462",
    departureTime: "2026-12-21T18:06:00.000Z",
    arrivalTime: "2026-12-21T19:36:00.000Z",
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Flight;
}

function doc(over: Partial<TravelDocument> = {}): TravelDocument {
  return {
    id: "d1",
    format: "pdf",
    kind: "boardingPass",
    mimetype: "application/pdf",
    sizeBytes: 1000,
    sha256: "x",
    originalName: "BP.pdf",
    displayName: "BP.pdf",
    issuedOn: null,
    source: "upload",
    parsedDomain: null,
    entry: { type: "flight", id: "f1" },
    createdAt: "2026-12-01T00:00:00.000Z",
    linkedAt: null,
    url: "/api/v1/documents/d1/file",
    ...over,
  };
}

/** forgejo#220 — the compact card for the day of travel. */
describe("FlightDayCard", () => {
  beforeEach(() => {
    listForEntry.mockReset().mockResolvedValue([]);
    copyToClipboard.mockReset().mockResolvedValue(undefined);
  });

  it("offers reference, seat, baggage and the boarding pass, which opens with one action", async () => {
    listForEntry.mockResolvedValue([doc(), doc({ id: "d2", kind: "invoice", displayName: "R" })]);
    render(
      <FlightDayCard
        flight={flight({ bookingReference: "XY7Z9Q", seatNumber: "34D", baggageAllowance: "23" })}
      />
    );
    expect(screen.getByTestId("day-card-booking-reference")).toHaveTextContent("XY7Z9Q");
    expect(screen.getByTestId("day-card-seat")).toHaveTextContent("34D");
    expect(screen.getByTestId("day-card-baggage")).toHaveTextContent("23 kg");
    const link = await screen.findByRole("link", {
      name: 'flights:dayCard.openPass {"name":"BP.pdf"}',
    });
    expect(link).toHaveAttribute("href", "/api/v1/documents/d1/file");
    expect(link).toHaveAttribute("target", "_blank");
    // The invoice is not offered as a boarding pass.
    expect(screen.queryByRole("link", { name: /"name":"R"/ })).toBeNull();
  });

  it("marks every missing value as missing instead of leaving it out", async () => {
    render(<FlightDayCard flight={flight()} />);
    for (const id of ["booking-reference", "seat", "baggage"]) {
      expect(screen.getByTestId(`day-card-${id}`)).toHaveTextContent("flights:dayCard.missing");
    }
    await waitFor(() =>
      expect(screen.getByTestId("day-card-boarding-pass")).toHaveTextContent(
        "flights:dayCard.passesHint"
      )
    );
    expect(screen.getByTestId("day-card-boarding-pass")).toHaveTextContent(
      "flights:dayCard.missing"
    );
    // Nothing to copy, so no copy button pretending otherwise.
    expect(screen.queryByRole("button", { name: /copyLabel/ })).toBeNull();
  });

  it("copies the reference and says so visibly", async () => {
    const user = userEvent.setup();
    render(<FlightDayCard flight={flight({ bookingReference: "XY7Z9Q" })} />);
    const button = screen.getByRole("button", {
      name: 'flights:dayCard.copyLabel {"field":"flights:form.bookingReference"}',
    });
    await user.click(button);
    expect(copyToClipboard).toHaveBeenCalledWith("XY7Z9Q");
    expect(
      within(screen.getByTestId("day-card-booking-reference")).getByText("flights:dayCard.copied")
    ).toBeInTheDocument();
  });

  it("says when the clipboard is not available instead of failing silently", async () => {
    copyToClipboard.mockRejectedValue(new Error("clipboard: execCommand copy returned false"));
    const user = userEvent.setup();
    render(<FlightDayCard flight={flight({ bookingReference: "XY7Z9Q" })} />);
    await user.click(screen.getByRole("button", { name: /copyLabel/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("flights:dayCard.copyFailed");
    expect(screen.queryByText("flights:dayCard.copied")).toBeNull();
  });

  it("says the documents could not be listed and retries on request", async () => {
    listForEntry.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue([doc()]);
    const user = userEvent.setup();
    render(<FlightDayCard flight={flight()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("flights:dayCard.passesFailed");
    await user.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByRole("link", { name: /openPass/ })).toBeInTheDocument();
  });

  it("re-reads when the page's documents section changed a file", async () => {
    const { rerender } = render(<FlightDayCard flight={flight()} documentsVersion={0} />);
    await waitFor(() => expect(listForEntry).toHaveBeenCalledTimes(1));
    listForEntry.mockResolvedValue([doc({ format: "pkpass", kind: null })]);
    rerender(<FlightDayCard flight={flight()} documentsVersion={1} />);
    // A wallet pass is a boarding pass even without a kind.
    expect(await screen.findByRole("link", { name: /openPass/ })).toBeInTheDocument();
    expect(listForEntry).toHaveBeenCalledTimes(2);
  });

  it("names other documents when none is filed as a boarding pass", async () => {
    listForEntry.mockResolvedValue([doc({ kind: "invoice" }), doc({ id: "d2", kind: null })]);
    render(<FlightDayCard flight={flight()} />);
    expect(await screen.findByText('flights:dayCard.passesOthers {"count":2}')).toBeInTheDocument();
  });

  it("is drawn for an upcoming flight and for a past one with values, not for a bare past one", async () => {
    const { rerender, container } = render(<FlightDayCard flight={flight({ status: "flown" })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FlightDayCard flight={flight({ status: "flown", seatNumber: "1A" })} />);
    expect(screen.getByTestId("day-card-seat")).toHaveTextContent("1A");
    await screen.findByText("flights:dayCard.passesHint");
  });

  it("gives its controls touch size on a coarse pointer", async () => {
    render(<FlightDayCard flight={flight({ bookingReference: "XY7Z9Q" })} />);
    const button = screen.getByRole("button", { name: /copyLabel/ });
    for (const cls of DAY_CARD_TOUCH.split(" ")) expect(button.className).toContain(cls);
    await screen.findByText("flights:dayCard.passesHint");
  });
});
