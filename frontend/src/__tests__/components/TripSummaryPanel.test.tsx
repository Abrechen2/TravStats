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

// The card asks the instance whether it has a text model at all; these cases
// are about an instance that does.
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const t = ((key: string) => key) as unknown as Parameters<typeof TripSummaryPanel>[0]["t"];

const makeTrip = (summary: string | null): Trip =>
  ({ id: "trip-1", name: "Test trip", summary }) as unknown as Trip;

// The AI summary left the beta registry on 2026-09-18 (owner: everything out
// but the phone app), so the card no longer asks the instance flag anything.
// What survives is the part that was never about the gate: an existing summary
// is shown, and the buttons are offered.
describe("TripSummaryPanel", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null });
  });

  it("offers the generate CTA whatever the instance beta flag says", () => {
    for (const flag of [null, false, true]) {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      const { unmount } = render(
        <TripSummaryPanel trip={makeTrip(null)} t={t} language="de" onChanged={() => {}} />
      );
      expect(screen.getByText("trips:summary.title")).toBeTruthy();
      expect(screen.getByRole("button", { name: "trips:summary.generateButton" })).toBeTruthy();
      unmount();
    }
  });

  it("shows an already-generated summary, and its regenerate button", () => {
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
    expect(screen.getByRole("button", { name: "trips:summary.regenerate" })).toBeTruthy();
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
