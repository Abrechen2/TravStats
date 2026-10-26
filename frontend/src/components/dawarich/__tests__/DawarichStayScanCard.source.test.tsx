import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import DawarichStayScanCard from "../../Settings/DawarichStayScanCard";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";
import de from "../../../i18n/resources/de/trips.json";
import en from "../../../i18n/resources/en/trips.json";

/**
 * The scan card names where the stays come from (TravTrack plan E3, owner
 * decision 2026-10-25): a TravTrack account reads "from your TravTrack
 * history" and is never told about a Dawarich connection it does not need.
 */
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: {
    state: vi.fn(),
    enable: vi.fn(),
    enableMarkets: vi.fn(),
    enableVenues: vi.fn(),
    scan: vi.fn(),
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../lib/profileInstant", () => ({ profileDateTime: (v: string) => v }));

const base = { enabled: false, connected: true, result: null, error: null };
const mount = () =>
  render(
    <MemoryRouter>
      <DawarichStayScanCard />
    </MemoryRouter>
  );
afterEach(() => vi.resetAllMocks());

describe("the scan card by source", () => {
  it("a TravTrack account sees the TravTrack copy and may consent", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({ ...base, source: "travtrack" } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.travtrack.source")).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.travtrack.title")).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.travtrack.description")).toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.title")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.description")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.ownConnection")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeEnabled();
  });

  it("with TravTrack off it says so instead of asking for a Dawarich connection", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...base,
      enabled: true,
      connected: false,
      source: "travtrack",
      pausedReason: "travTrackDisabled",
    } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.travtrack.off")).toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.ownConnection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trips:dawarichStays.scan" })).toBeDisabled();
    // Revoking stays possible.
    expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeEnabled();
  });

  it("a Dawarich account keeps the Dawarich copy", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...base,
      connected: false,
    } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.title")).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.ownConnection")).toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.travtrack.source")).not.toBeInTheDocument();
  });

  it("the TravTrack copy names no Dawarich, in German and English", () => {
    for (const copy of [de.dawarichStays.travtrack, en.dawarichStays.travtrack]) {
      expect(copy.source).toBeTruthy();
      expect(JSON.stringify(copy)).not.toMatch(/dawarich/i);
    }
    expect(de.dawarichStays.travtrack.source).toBe("Aus deinem TravTrack-Verlauf");
    expect(en.dawarichStays.travtrack.source).toBe("From your TravTrack history");
  });
});
