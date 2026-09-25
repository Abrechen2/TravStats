import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import JourneyPhotosSection from "../JourneyPhotosSection";
import { photoJourneysApi } from "../../../lib/api/photoJourneys";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));
// `importOriginal` keeps the URL builder real — the security property is in it.
vi.mock("../../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/photoJourneys")>();
  return { ...actual, photoJourneysApi: { forTrip: vi.fn() } };
});

/**
 * Package 9, item 1 (trip half): a trip made from a photo finding shows the
 * finding's photographs, drawn through the journey row by index.
 */
describe("JourneyPhotosSection", () => {
  it("draws every preview of the findings that made the trip, by row and index", async () => {
    vi.mocked(photoJourneysApi.forTrip).mockResolvedValue([
      { id: "j-1", previewCount: 2 },
      { id: "j-2", previewCount: 1 },
    ]);
    render(<JourneyPhotosSection tripId="trip-1" />);

    const images = await screen.findAllByRole("img");
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "/api/v1/photo-journeys/j-1/preview/0/file?size=thumbnail",
      "/api/v1/photo-journeys/j-1/preview/1/file?size=thumbnail",
      "/api/v1/photo-journeys/j-2/preview/0/file?size=thumbnail",
    ]);
    expect(photoJourneysApi.forTrip).toHaveBeenCalledWith("trip-1");
  });

  it("renders nothing when no finding made the trip", async () => {
    vi.mocked(photoJourneysApi.forTrip).mockResolvedValue([]);
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<JourneyPhotosSection tripId="trip-1" />));
    });
    expect(photoJourneysApi.forTrip).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
