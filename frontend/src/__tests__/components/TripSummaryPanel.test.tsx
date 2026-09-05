import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TripSummaryPanel } from "../../components/Trips/TripSummaryPanel";
import { useSettingsStore } from "../../store/settingsStore";
import type { Trip } from "../../types";

// Real store so we can flip the instance-level beta flag.
vi.unmock("../../store/settingsStore");

vi.mock("../../lib/api", () => ({
  tripsApi: { summarize: vi.fn() },
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const t = ((key: string) => key) as unknown as Parameters<typeof TripSummaryPanel>[0]["t"];

const makeTrip = (summary: string | null): Trip =>
  ({ id: "trip-1", name: "Test trip", summary }) as unknown as Trip;

describe("TripSummaryPanel (beta gate: tripAiSummary)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null });
  });

  it("renders nothing when the flag is OFF and no summary exists", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    const { container } = render(
      <TripSummaryPanel trip={makeTrip(null)} t={t} language="de" onChanged={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("trips:summary.generateButton")).toBeNull();
  });

  it("renders the generate CTA when the flag is ON", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    render(<TripSummaryPanel trip={makeTrip(null)} t={t} language="de" onChanged={() => {}} />);
    expect(screen.getByText("trips:summary.title")).toBeTruthy();
    expect(screen.getByText("trips:summary.cta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "trips:summary.generateButton" })).toBeTruthy();
  });

  it("still shows an already-generated summary when the flag is OFF, but not the regenerate button", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    render(
      <TripSummaryPanel
        trip={makeTrip("A lovely trip.")}
        t={t}
        language="de"
        onChanged={() => {}}
      />
    );
    expect(screen.getByText("A lovely trip.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "trips:summary.regenerate" })).toBeNull();
  });

  it("offers regenerate on an existing summary when the flag is ON", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    render(
      <TripSummaryPanel
        trip={makeTrip("A lovely trip.")}
        t={t}
        language="de"
        onChanged={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "trips:summary.regenerate" })).toBeTruthy();
  });
});
