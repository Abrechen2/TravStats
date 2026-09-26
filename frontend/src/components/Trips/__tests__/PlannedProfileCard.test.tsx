import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import PlannedProfileCard from "../PlannedProfileCard";
import { openDataApi, OpenDataUnavailableError } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../ElevationProfileChart", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("../../../lib/api/openData", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/api/openData")>();
  return { ...original, openDataApi: { ...original.openDataApi, plannedProfile: vi.fn() } };
});

/**
 * An Open-Meteo outage used to make the planned profile vanish without a
 * word — indistinguishable from a tour too short to have one.
 */
describe("PlannedProfileCard", () => {
  beforeEach(() => {
    useSettingsStore.setState({ openDataEnabled: true });
    vi.mocked(openDataApi.plannedProfile).mockReset();
  });

  it("draws the profile when the service answers", async () => {
    vi.mocked(openDataApi.plannedProfile).mockResolvedValue({
      distanceKm: 3.2,
      ascentM: 330,
      descentM: 0,
      profile: [
        [0, 270],
        [3.2, 600],
      ],
    });
    render(<PlannedProfileCard routeId="r1" lineKey="a" accent="#fff" />);
    expect(await screen.findByTestId("chart")).toBeInTheDocument();
  });

  it("says the elevation service is unreachable instead of vanishing", async () => {
    vi.mocked(openDataApi.plannedProfile).mockRejectedValue(new OpenDataUnavailableError());
    render(<PlannedProfileCard routeId="r1" lineKey="a" accent="#fff" />);
    expect(await screen.findByText("openData:planned.unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("draws nothing for a line that has no profile", async () => {
    vi.mocked(openDataApi.plannedProfile).mockResolvedValue(null);
    const { container } = render(<PlannedProfileCard routeId="r1" lineKey="a" accent="#fff" />);
    await vi.waitFor(() => expect(openDataApi.plannedProfile).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
