import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const railVisible = vi.fn(() => true);
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible() }));
const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
const previewRoadtripConversion = vi.fn();
const convertRoadtrip = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    previewRoadtripConversion: (...a: unknown[]) => previewRoadtripConversion(...a),
    convertRoadtrip: (...a: unknown[]) => convertRoadtrip(...a),
  },
}));

import { RoadtripRailConversion } from "../RoadtripRailConversion";
import type { RoadtripConversionPreview } from "../../../lib/api/rail";

const PREVIEW: RoadtripConversionPreview = {
  routeId: "r1",
  name: "Interrail 2025",
  rides: [
    {
      legId: "l1",
      departureStationName: "München Hbf",
      arrivalStationName: "Wien Hbf",
      departureDay: "2025-07-03",
      distanceKm: 355.2,
      journeyId: null,
    },
  ],
  skipped: [],
  canRemoveSection: true,
};

function renderOffer(vehicle: "rail" | "motorhome" = "rail", onConverted = vi.fn()) {
  render(
    <MemoryRouter>
      <RoadtripRailConversion routeId="r1" vehicle={vehicle} onConverted={onConverted} />
    </MemoryRouter>
  );
  return onConverted;
}

/**
 * The conversion offer of a roadtrip stored by rail (owner decision 1 of the
 * rail spec). It sits behind the rail beta gate, and the roadtrip goes only
 * when the user ticks the box that says so.
 */
describe("RoadtripRailConversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    railVisible.mockReturnValue(true);
    previewRoadtripConversion.mockResolvedValue(PREVIEW);
    convertRoadtrip.mockResolvedValue({
      created: 1,
      alreadyConverted: 0,
      journeyIds: ["j1"],
      skipped: [],
      sectionRemoved: false,
    });
  });

  it("is not offered while rail is hidden, even for a roadtrip by rail", () => {
    railVisible.mockReturnValue(false);
    renderOffer();
    expect(screen.queryByTestId("roadtrip-rail-conversion")).toBeNull();
  });

  it("is not offered for a roadtrip in anything but a train", () => {
    renderOffer("motorhome");
    expect(screen.queryByTestId("roadtrip-rail-conversion")).toBeNull();
  });

  it("shows the rides first and converts without deleting unless asked", async () => {
    const onConverted = renderOffer();
    fireEvent.click(screen.getByText("rail:roadtripConversion.action"));
    expect(await screen.findByText(/München Hbf → Wien Hbf/)).toBeTruthy();
    expect(convertRoadtrip).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("rail:roadtripConversion.confirm"));
    await waitFor(() => expect(convertRoadtrip).toHaveBeenCalledWith("r1", false));
    await waitFor(() => expect(onConverted).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("deletes the roadtrip only with the box ticked, then opens the rail logbook", async () => {
    convertRoadtrip.mockResolvedValue({
      created: 1,
      alreadyConverted: 0,
      journeyIds: ["j1"],
      skipped: [],
      sectionRemoved: true,
    });
    renderOffer();
    fireEvent.click(screen.getByText("rail:roadtripConversion.action"));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByText("rail:roadtripConversion.confirm"));
    await waitFor(() => expect(convertRoadtrip).toHaveBeenCalledWith("r1", true));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/rail"));
  });

  it("offers no deletion when a leg cannot be converted", async () => {
    previewRoadtripConversion.mockResolvedValue({
      ...PREVIEW,
      skipped: [{ legId: "l2", fromStopId: "b", toStopId: "c", reason: "noDate" }],
      canRemoveSection: false,
    });
    renderOffer();
    fireEvent.click(screen.getByText("rail:roadtripConversion.action"));
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/rail:roadtripConversion.reason.noDate/)).toBeTruthy();
  });
});
