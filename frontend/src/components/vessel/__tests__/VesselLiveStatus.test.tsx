import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VesselLiveStatus } from "../VesselLiveStatus";
import type { VesselStatus } from "../../../lib/api/vessel";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/vessel", () => ({ vesselApi: { status: mocks.status } }));

const base: VesselStatus = {
  vesselName: "Stena Germanica",
  mmsi: "265177000",
  source: "wikidata",
  confidence: "high",
  reason: null,
  aisConfigured: true,
  inProgress: true,
  signal: "outOfRange",
  lastFix: null,
  track: null,
};

beforeEach(() => vi.clearAllMocks());

it("says the ship is out of AIS range instead of showing an empty panel", async () => {
  mocks.status.mockResolvedValue(base);
  render(<VesselLiveStatus kind="ferry" id="f1" />);
  expect(await screen.findByTestId("vessel-signal")).toHaveTextContent(
    "ferry:vessel.signal.outOfRange"
  );
  expect(screen.getByText(/ferry:vessel.source.wikidata/)).toBeInTheDocument();
});

it("keeps the last known position and its time beside the out-of-range note", async () => {
  mocks.status.mockResolvedValue({
    ...base,
    lastFix: {
      lat: 55.1,
      lon: 10.9,
      observedAt: "2030-06-01T10:00:00Z",
      receivedAt: "2030-06-01T10:00:05Z",
      speedKnots: 17,
      courseDegrees: 12,
    },
  });
  render(<VesselLiveStatus kind="cruise" id="c1" />);
  expect(await screen.findByText(/ferry:vessel.lastFix /)).toBeInTheDocument();
  expect(screen.getByText(/ferry:vessel.lastFixAt/)).toBeInTheDocument();
  expect(screen.getByTestId("vessel-signal")).toHaveTextContent("outOfRange");
});

it("names why no ship was bound, never guessing one", async () => {
  mocks.status.mockResolvedValue({
    ...base,
    mmsi: null,
    source: null,
    reason: "ambiguous",
    signal: "unresolved",
  });
  render(<VesselLiveStatus kind="ferry" id="f1" />);
  expect(await screen.findByText("ferry:vessel.reason.ambiguous")).toBeInTheDocument();
  expect(screen.queryByTestId("vessel-signal")).toBeNull();
});

it("shows a visible error when the status cannot be loaded", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.status.mockRejectedValue(new Error("down"));
  render(<VesselLiveStatus kind="ferry" id="f1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("ferry:vessel.loadFailed");
});
