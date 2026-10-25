import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TravTrackStay } from "../../../lib/api/travtrackViews";

const views = vi.hoisted(() => ({ stays: vi.fn() }));
vi.mock("../../../lib/api/travtrackViews", () => ({ travTrackViewsApi: views }));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackStays, { stayInboxHref } from "../TrackStays";

/**
 * Aufenthalte (plan T5.3): open stays link to their inbox card, confirmed ones
 * to their place or trip, a stay in a privacy zone has no map link, the list
 * pages on, filters go to the server, and a failure reads as itself.
 */

const stay = (over: Partial<TravTrackStay>): TravTrackStay => ({
  id: "s1",
  status: "pending",
  provider: "travtrack",
  day: "2026-10-20",
  startAt: "2026-10-20T09:00:00.000Z",
  endAt: "2026-10-20T11:30:00.000Z",
  zone: "UTC",
  position: { lat: 37.5, lon: 127 },
  name: "Café Mokka",
  place: null,
  tripId: null,
  visitId: null,
  detectedAt: "2026-10-20T12:00:00.000Z",
  resolvedAt: null,
  ...over,
});

const show = () =>
  render(
    <MemoryRouter>
      <TrackStays />
    </MemoryRouter>
  );

describe("TrackStays", () => {
  beforeEach(() => {
    views.stays.mockReset();
  });

  it("links an open stay to the inbox, a confirmed one to its place and trip; a zone stay has no map", async () => {
    views.stays.mockResolvedValue({
      stays: [
        stay({}),
        stay({
          id: "s2",
          status: "accepted",
          place: { id: "pl1", name: "Gyeongbokgung" },
          tripId: "t1",
        }),
        stay({ id: "s3", status: "rejected", position: null, name: null }),
      ],
      nextCursor: null,
    });
    show();
    const open = await screen.findByTestId("track-stay-s1");
    expect(within(open).getByRole("link", { name: "track:stays.review" })).toHaveAttribute(
      "href",
      stayInboxHref("s1")
    );
    expect(within(open).getByRole("link", { name: "track:stays.onMap" })).toHaveAttribute(
      "href",
      "/track/2026-10-20"
    );
    const done = screen.getByTestId("track-stay-s2");
    expect(done).toHaveTextContent("Gyeongbokgung");
    expect(within(done).getByRole("link", { name: "track:stays.openPlace" })).toHaveAttribute(
      "href",
      "/places/pl1"
    );
    expect(within(done).getByRole("link", { name: "track:stays.openTrip" })).toHaveAttribute(
      "href",
      "/trips/t1"
    );
    const zone = screen.getByTestId("track-stay-s3");
    expect(within(zone).getByTestId("track-stay-zone")).toBeInTheDocument();
    expect(within(zone).queryByRole("link")).not.toBeInTheDocument();
    expect(zone).toHaveTextContent("track:stays.unnamed");
    expect(stayInboxHref("s1")).toBe("/pending-updates?view=list&item=dawarich%3As1");
  });

  it("asks for all three states first, then the filter as applied", async () => {
    views.stays.mockResolvedValue({ stays: [], nextCursor: null });
    show();
    expect(await screen.findByTestId("track-stays-empty")).toBeInTheDocument();
    expect(views.stays).toHaveBeenLastCalledWith({
      states: ["pending", "accepted", "rejected"],
      limit: 50,
    });
    fireEvent.click(screen.getByRole("button", { name: "track:stays.state.rejected" }));
    fireEvent.change(screen.getByLabelText("track:stays.filter.from"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("track:stays.filter.to"), {
      target: { value: "2026-10-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "track:stays.filter.apply" }));
    await waitFor(() =>
      expect(views.stays).toHaveBeenLastCalledWith({
        states: ["pending", "accepted"],
        fromDay: "2026-10-01",
        toDay: "2026-10-10",
        limit: 50,
      })
    );
  });

  it("pages on with the cursor and keeps the rows it has", async () => {
    views.stays
      .mockResolvedValueOnce({ stays: [stay({})], nextCursor: "c2" })
      .mockResolvedValueOnce({ stays: [stay({ id: "s9" })], nextCursor: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "track:stays.more" }));
    expect(await screen.findByTestId("track-stay-s9")).toBeInTheDocument();
    expect(screen.getByTestId("track-stay-s1")).toBeInTheDocument();
    expect(views.stays.mock.calls[1][0]).toMatchObject({ cursor: "c2" });
    expect(screen.queryByRole("button", { name: "track:stays.more" })).not.toBeInTheDocument();
  });

  it("a failure reads as itself, never as an empty list", async () => {
    views.stays.mockRejectedValue({ response: { status: 500, data: {} } });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.generic");
    expect(screen.queryByTestId("track-stays-empty")).not.toBeInTheDocument();
  });
});
