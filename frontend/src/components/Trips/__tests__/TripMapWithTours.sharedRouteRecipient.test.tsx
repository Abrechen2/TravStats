import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";

/**
 * A recipient reads another member's shared route through the instance's
 * TravTrack, not their own (Codex review of T7): the server's `on` tier asks
 * only whether TravTrack is on here, so a reader who never recorded anything
 * (`active: false`, `hasData: false`) still sees the route shared with them.
 * The real visibility hooks run here; only the network is stood in.
 */

vi.mock("../TripMap", () => ({
  default: ({ extraLayers = [] }: { extraLayers?: readonly Layer[] }) => (
    <ul data-testid="map">
      {extraLayers.map((layer) => (
        <li key={layer.id} data-testid={layer.id} />
      ))}
    </ul>
  ),
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(async () => []), tracks: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { geometryBatch: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: vi.fn(() => false) }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/tripRecording", () => ({
  tripRecordingApi: {
    get: vi.fn(async () => ({
      summary: {
        pointCount: 0,
        jitterDropped: 0,
        firstAt: null,
        lastAt: null,
        devices: [],
        days: [],
      },
      segments: [],
    })),
    downloadGpx: vi.fn(),
    remove: vi.fn(),
  },
}));
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), sharedRoutes: vi.fn() }));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: { capabilities: mocks.capabilities, sharedRoutes: mocks.sharedRoutes },
}));
const authState = { user: { id: "recipient", isAdmin: false } };
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));
vi.unmock("../../../store/settingsStore");

import TripMapWithTours from "../TripMapWithTours";
import { useSettingsStore } from "../../../store/settingsStore";

const trip = { id: "copy-1", flights: [], cruises: [], lodgingStays: [], stops: [] } as never;
const caps = (over: object) => ({
  version: 1,
  offered: true,
  enabled: true,
  active: false,
  hasData: false,
  ...over,
});

describe("TripMapWithTours — a recipient without TravTrack of their own", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    mocks.capabilities.mockReset();
    mocks.sharedRoutes.mockReset();
    mocks.sharedRoutes.mockResolvedValue([
      {
        version: 1,
        sharedBy: "Alex Muster",
        geometry: [
          [
            [127, 37.5],
            [127.1, 37.5],
          ],
        ],
      },
    ]);
  });

  it("sees the route shared with them although they record nothing and hold nothing", async () => {
    mocks.capabilities.mockResolvedValue(caps({}));
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByTestId("trip-shared-route-0")).toBeInTheDocument();
    expect(mocks.sharedRoutes).toHaveBeenCalledWith("copy-1");
  });

  it("does not ask while TravTrack is off on this server", async () => {
    mocks.capabilities.mockResolvedValue(caps({ enabled: false, active: true, hasData: true }));
    render(<TripMapWithTours trip={trip} />);
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
    await screen.findByTestId("map");
    expect(mocks.sharedRoutes).not.toHaveBeenCalled();
  });

  it("does not ask while the beta key is closed", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    mocks.capabilities.mockResolvedValue(caps({}));
    render(<TripMapWithTours trip={trip} />);
    await screen.findByTestId("map");
    expect(mocks.sharedRoutes).not.toHaveBeenCalled();
  });
});
