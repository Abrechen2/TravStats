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
vi.mock("../../../lib/api/suggestionPlugins", () => ({
  suggestionPluginsApi: { reask: vi.fn(async () => 1) },
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

const withPlugin = {
  ...row,
  evidence: {
    ...row.evidence,
    plugins: [
      {
        pluginId: "11111111-1111-4111-8111-111111111111",
        pluginName: "Projektarchiv",
        name: "Projekt 4711",
        lat: 48.6901,
        lon: 9.3102,
        purpose: "business",
        externalRef: "4711",
        url: "https://archive.example.com/p/4711",
        confidence: 0.95,
        distanceM: 30,
      },
    ],
  },
} as unknown as DawarichStay;

describe("a finding with a plugin suggestion", () => {
  it("names the plugin as source and links without a referrer", () => {
    render(
      <MemoryRouter>
        <StayReviewCard row={withPlugin} choices={{ places: [], trips: [] }} onDone={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByText(/inbox\.plugins\.source .*Projektarchiv/)).toBeInTheDocument();
    const link = screen.getByText("suggestionSources:inbox.plugins.link").closest("a")!;
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("taking the suggestion over sends its reference with the accept", async () => {
    vi.mocked(dawarichStaysApi.accept).mockResolvedValue(undefined as never);
    render(
      <MemoryRouter>
        <StayReviewCard row={withPlugin} choices={{ places: [], trips: [] }} onDone={vi.fn()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("suggestionSources:inbox.plugins.pick"));
    fireEvent.click(screen.getByText("trips:dawarichStays.accept"));
    await waitFor(() =>
      expect(dawarichStaysApi.accept).toHaveBeenCalledWith(
        "finding",
        expect.objectContaining({
          name: "Projekt 4711",
          lat: 48.6901,
          pluginRef: { pluginId: "11111111-1111-4111-8111-111111111111", externalRef: "4711" },
        })
      )
    );
  });
});
