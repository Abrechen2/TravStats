import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.route ? `${k}:${String(o.route)}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const readShareLink = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: { readShareLink: (...a: unknown[]) => readShareLink(...a) },
}));

import { RailShareLinkRoute } from "../RailShareLinkRoute";
import { booking } from "./railImportFixture";

/** Invented link and stations — no real share id. */
const LINK = "https://www.bahn.de/buchung/start?vbid=0f0e0d0c-0b0a-4908-8706-050403020100";
const NO_FACTS = {
  departureStationName: null,
  arrivalStationName: null,
  departureLocal: null,
  travelClass: null,
};

function setup() {
  const context = { openReview: vi.fn(), openManual: vi.fn(), focusDocumentRoute: vi.fn() };
  render(<RailShareLinkRoute context={context} />);
  fireEvent.change(screen.getByLabelText("rail:shareLink.label"), { target: { value: LINK } });
  fireEvent.click(screen.getByRole("button", { name: "rail:shareLink.read" }));
  return context;
}

describe("RailShareLinkRoute (forgejo#204)", () => {
  beforeEach(() => readShareLink.mockReset());

  it("says up front that reading a link often fails", () => {
    render(<RailShareLinkRoute />);
    expect(screen.getByText("rail:shareLink.caveat")).toBeInTheDocument();
  });

  it("hands a read connection to the rail review", async () => {
    const b = booking();
    readShareLink.mockResolvedValue({ outcome: "read", facts: NO_FACTS, booking: b });
    const context = setup();
    await waitFor(() =>
      expect(context.openReview).toHaveBeenCalledWith({ domain: "rail", bookings: [b] })
    );
    expect(readShareLink).toHaveBeenCalledWith(LINK);
  });

  it("names a blocked fetch as blocked and offers the document and manual ways at once", async () => {
    readShareLink.mockResolvedValue({
      outcome: "failed",
      reason: "blocked",
      facts: { ...NO_FACTS, departureStationName: "Köln Hbf", travelClass: "first" },
    });
    const context = setup();
    expect(await screen.findByText("rail:shareLink.reason.blocked")).toBeInTheDocument();
    expect(screen.getByTestId("rail-share-link-facts")).toHaveTextContent("Köln Hbf → ?");

    fireEvent.click(screen.getByRole("button", { name: "rail:shareLink.useDocument" }));
    expect(context.focusDocumentRoute).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "rail:shareLink.typeWithFacts" }));
    expect(context.openManual).toHaveBeenCalledWith({
      kind: "railShareLink",
      draft: expect.objectContaining({
        departure: expect.objectContaining({ name: "Köln Hbf", lat: null }),
        travelClass: "first",
        departureLocal: "",
      }),
    });
  });

  it("tells our own rate limit apart from bahn.de's answer", async () => {
    readShareLink.mockRejectedValueOnce(
      Object.assign(new Error("429"), { response: { status: 429 } })
    );
    setup();
    expect(await screen.findByText("rail:shareLink.reason.requestRateLimited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "rail:shareLink.typeIt" })).toBeInTheDocument();
  });
});
