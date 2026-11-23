import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StayReviewCard from "../StayReviewCard";
import { dawarichStaysApi, type DawarichStay } from "../../../lib/api/dawarichStays";

/**
 * A finding with a calendar event (spec 2026-11-23-plugins-and-calendar.md, P2):
 * the card says which event and how it matched, starts the purpose with the
 * suggestion, and sends what the user chose.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../StayIdentityPanel", () => ({ default: () => null }));
vi.mock("../../inbox/track/TrackSectionPanel", () => ({ default: () => null }));
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { accept: vi.fn(), reject: vi.fn() },
}));

const row = {
  id: "finding",
  status: "pending",
  name: "Musterfirma",
  startAt: "2026-11-10T09:00:00Z",
  endAt: "2026-11-10T10:00:00Z",
  sourceStartAt: "2026-11-10T09:00:00Z",
  sourceEndAt: "2026-11-10T10:00:00Z",
  sourceLat: 48.69,
  sourceLon: 9.31,
  lat: 48.69,
  lon: 9.31,
  zone: "Europe/Berlin",
  pointCount: 0,
  placeId: null,
  tripId: null,
  visitId: null,
  visit: null,
  detectedAt: "2026-11-11T00:00:00Z",
  resolvedAt: null,
  evidence: {
    source: "travtrack",
    zone: "Europe/Berlin",
    maxGapMinutes: 0,
    uncertainties: [],
    suggestedPurpose: "business",
    calendar: {
      sourceId: "s1",
      uidHash: "h",
      sourceLabel: "Arbeit",
      title: "WAR Musterfirma",
      start: "2026-11-10T09:00:00Z",
      end: "2026-11-10T09:30:00Z",
      location: "Musterstraße 5",
      match: "geocoded",
      timeMatch: "overlap",
      overlapMinutes: 30,
      geocoded: { lat: 48.69, lon: 9.31, distanceM: 40 },
    },
  },
} as unknown as DawarichStay;

const mount = () =>
  render(
    <MemoryRouter>
      <StayReviewCard row={row} choices={{ places: [], trips: [] }} onDone={vi.fn()} />
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());

describe("a finding with a calendar event", () => {
  it("names the event, its calendar and how it matched", () => {
    mount();
    expect(screen.getByTestId("stay-calendar-evidence").textContent).toContain("WAR Musterfirma");
    expect(
      screen.getByText(/suggestionSources:inbox\.calendar\.match\.geocoded .*"meters":40/)
    ).toBeInTheDocument();
  });

  it("starts the purpose with the suggestion and sends what the user chose", async () => {
    vi.mocked(dawarichStaysApi.accept).mockResolvedValue(undefined as never);
    mount();
    const select = screen.getByTestId("stay-purpose") as HTMLSelectElement;
    expect(select.value).toBe("business");
    fireEvent.change(select, { target: { value: "private" } });
    fireEvent.click(screen.getByText("trips:dawarichStays.accept"));
    await waitFor(() =>
      expect(dawarichStaysApi.accept).toHaveBeenCalledWith(
        "finding",
        expect.objectContaining({ purpose: "private" })
      )
    );
  });
});
