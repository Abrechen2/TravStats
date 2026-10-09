import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../lib/api/rail", () => ({ railApi: { update: vi.fn() } }));
const listForEntry = vi.fn();
vi.mock("../../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
  documentFileUrl: (doc: { url: string }) => doc.url,
}));

import { RailConnectionView } from "../RailConnectionView";
import { FULDA_TO_BERLIN, makeRailBookingLeg } from "./railJourneyFixture";

/**
 * forgejo#235 — a whole connection readable on the platform: per train the
 * seat (or that none is recorded), its own reference, its originals as links,
 * and the change to the next train.
 */
const first = makeRailBookingLeg({
  id: "j1",
  arrivalTime: "2026-09-26T05:10:00.000Z",
  travelClass: "second",
  coach: "7",
  seat: "45",
  bookingReference: "AB12CD",
});
const second = makeRailBookingLeg({
  id: "j2",
  depStationName: "Fulda",
  arrStationName: "Berlin",
  ...FULDA_TO_BERLIN,
  departureTime: "2026-09-26T05:25:00.000Z",
  bookingReference: "ZZ99",
});

const ticket = {
  id: "d1",
  displayName: "Ticket-AB12CD.pdf",
  kind: "ticket",
  url: "/api/v1/documents/d1/file",
};

function renderView(currentId?: string): void {
  render(
    <MemoryRouter>
      <RailConnectionView legs={[first, second]} currentId={currentId} pnr="AB12CD" />
    </MemoryRouter>
  );
}

describe("RailConnectionView", () => {
  beforeEach(() => {
    listForEntry.mockReset();
    listForEntry.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(id === "j1" ? [ticket] : [])
    );
  });

  it("bundles class, coach and seat per train", async () => {
    renderView();
    expect(screen.getByTestId("rail-connection-leg-j1-seat")).toHaveTextContent(
      'rail:class.second · rail:connectionView.coach {"coach":"7"}, rail:connectionView.seat {"seat":"45"}'
    );
    await screen.findByTestId("rail-connection-leg-j1-documents");
  });

  it("says a train without coach and seat has no reservation recorded — no error, no seat", async () => {
    renderView();
    const line = screen.getByTestId("rail-connection-leg-j2-seat");
    expect(line).toHaveTextContent("rail:connectionView.noReservation");
    expect(line).not.toHaveTextContent("rail:connectionView.seat");
    expect(within(screen.getByTestId("rail-connection-leg-j2")).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(listForEntry).toHaveBeenCalledTimes(2));
  });

  it("repeats a reference only where it differs from the booking's", async () => {
    renderView();
    expect(screen.getByTestId("rail-connection-leg-j1-seat")).not.toHaveTextContent(
      "connectionView.reference"
    );
    expect(screen.getByTestId("rail-connection-leg-j2-seat")).toHaveTextContent(
      'rail:connectionView.reference {"reference":"ZZ99"}'
    );
    await waitFor(() => expect(listForEntry).toHaveBeenCalledTimes(2));
  });

  it("links each train's originals directly, and says when there are none", async () => {
    renderView();
    const link = await screen.findByRole("link", {
      name: 'documents:openLabel {"name":"Ticket-AB12CD.pdf"}',
    });
    expect(link).toHaveAttribute("href", "/api/v1/documents/d1/file");
    expect(link).toHaveAttribute("target", "_blank");
    expect(listForEntry).toHaveBeenCalledWith({ type: "railJourney", id: "j1" });
    expect(await screen.findByTestId("rail-connection-leg-j2-documents")).toHaveTextContent(
      "rail:connectionView.noDocuments"
    );
  });

  it("says a failed document list as itself, per train, and asks again on retry", async () => {
    listForEntry.mockImplementation(({ id }: { id: string }) =>
      id === "j2" ? Promise.reject(new Error("offline")) : Promise.resolve([ticket])
    );
    renderView();
    const failed = await screen.findByRole("alert");
    expect(failed).toHaveTextContent("rail:connectionView.documentsFailed");
    expect(screen.getByTestId("rail-connection-leg-j2-documents")).toBe(failed);
    // The other train's ticket is still there.
    expect(await screen.findByText(/Ticket-AB12CD\.pdf/)).toBeInTheDocument();

    listForEntry.mockImplementation(() => Promise.resolve([]));
    fireEvent.click(within(failed).getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() =>
      expect(screen.getByTestId("rail-connection-leg-j2-documents")).toHaveTextContent(
        "rail:connectionView.noDocuments"
      )
    );
  });

  it("draws the change between the trains and marks the train on screen", async () => {
    renderView("j2");
    expect(screen.getByTestId("rail-transfer-1")).toHaveTextContent("rail:transfer.wait");
    expect(screen.getByText("2. Fulda → Berlin")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1. Frankfurt → Fulda" })).toHaveAttribute(
      "href",
      "/rail/j1"
    );
    await waitFor(() => expect(listForEntry).toHaveBeenCalledTimes(1));
  });

  // Review minor 2: the page's own Documents section lists (and changes) the
  // train on screen; a second list here went stale after an upload there.
  it("points the train on screen to the page's Documents section instead of a second list", async () => {
    renderView("j1");
    expect(screen.getByTestId("rail-connection-leg-j1-documents")).toHaveTextContent(
      "rail:connectionView.documentsBelow"
    );
    await waitFor(() => expect(listForEntry).toHaveBeenCalledTimes(1));
    expect(listForEntry).toHaveBeenCalledWith({ type: "railJourney", id: "j2" });
    expect(listForEntry).not.toHaveBeenCalledWith({ type: "railJourney", id: "j1" });
  });
});
