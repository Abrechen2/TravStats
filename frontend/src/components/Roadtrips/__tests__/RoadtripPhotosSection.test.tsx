import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import RoadtripPhotosSection from "../RoadtripPhotosSection";
import type { RoadtripPhoto, RoadtripPhotos } from "../../../types/roadtrip";

const photos = vi.fn();
const fileUploadAtStation = vi.fn();
const getEntryPhotoSuggestions = vi.fn();
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: {
    photos: (...a: unknown[]) => photos(...a),
    fileUploadAtStation: (...a: unknown[]) => fileUploadAtStation(...a),
  },
}));
vi.mock("../../../lib/api/entryPhotos", () => ({
  getEntryPhotoSuggestions: (...a: unknown[]) => getEntryPhotoSuggestions(...a),
  linkEntryPhotos: vi.fn(),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o?.station ? `${key}:${o.station}` : key),
    i18n: { language: "de" },
    ready: true,
  }),
}));

const photo = (key: string, day: string, over: Partial<RoadtripPhoto> = {}): RoadtripPhoto => ({
  key,
  kind: "linked",
  source: "upload",
  via: "station",
  url: `/img/${key}.jpg`,
  caption: null,
  takenAt: `${day}T10:00:00.000Z`,
  lat: null,
  lon: null,
  day,
  stationId: "s1",
  stationTitle: "Stavanger",
  tripId: "t1",
  tripPhotoId: key,
  ...over,
});

const DATA: RoadtripPhotos = {
  photos: [
    photo("a", "2026-07-15"),
    photo("b", "2026-07-16"),
    photo("c", "2026-07-16", { kind: "window" }),
  ],
  span: { from: "2026-07-15", to: "2026-07-16" },
  stations: [
    { id: "s1", title: "Stavanger", day: "2026-07-16" },
    { id: "s0", title: "Oslo", day: "2026-07-15" },
  ],
  truncated: false,
};

const renderIt = () =>
  render(
    <MemoryRouter>
      <RoadtripPhotosSection roadtripId="r1" />
    </MemoryRouter>
  );

describe("RoadtripPhotosSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    photos.mockResolvedValue(DATA);
  });

  it("draws only the chosen day's pictures, and another day on choosing it", async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByTestId("roadtrip-photos");
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(1));
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/img/a.jpg");
    const dayButtons = screen.getAllByRole("button", { pressed: false });
    await user.click(dayButtons[0]);
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(2));
  });

  it("frames a linked photo solid and a merely fitting one dashed, with a link button only on the latter", async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByTestId("roadtrip-photos");
    await user.click(screen.getAllByRole("button", { pressed: false })[0]);
    const imgs = await waitFor(() => {
      const found = [...document.querySelectorAll("img")];
      expect(found).toHaveLength(2);
      return found;
    });
    expect(imgs[0].style.border).toContain("solid");
    expect(imgs[1].style.border).toContain("dashed");
    expect(screen.getAllByRole("button", { name: /roadtrips:photos.linkTo/ })).toHaveLength(1);
  });

  it("links a fitting upload to its station with one click, then reloads", async () => {
    const user = userEvent.setup();
    fileUploadAtStation.mockResolvedValue(undefined);
    renderIt();
    await screen.findByTestId("roadtrip-photos");
    await user.click(screen.getAllByRole("button", { pressed: false })[0]);
    await user.click(await screen.findByRole("button", { name: /roadtrips:photos.linkTo/ }));
    expect(fileUploadAtStation).toHaveBeenCalledWith("t1", "c", "s1");
    await waitFor(() => expect(photos).toHaveBeenCalledTimes(2));
  });

  it("says so when the photos cannot be loaded, and retries", async () => {
    const user = userEvent.setup();
    photos.mockRejectedValueOnce(new Error("down"));
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("roadtrips:photos.loadFailed");
    await user.click(screen.getByRole("button", { name: "roadtrips:photos.retry" }));
    await screen.findByText(/roadtrips:photos.title/);
  });

  it("says so when a link fails, and leaves the photo as it was", async () => {
    const user = userEvent.setup();
    fileUploadAtStation.mockRejectedValue(new Error("403"));
    renderIt();
    await screen.findByTestId("roadtrip-photos");
    await user.click(screen.getAllByRole("button", { pressed: false })[0]);
    await user.click(await screen.findByRole("button", { name: /roadtrips:photos.linkTo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("roadtrips:photos.linkFailed");
    expect(photos).toHaveBeenCalledTimes(1);
  });

  it("opens a photo large from the roadtrip page", async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByTestId("roadtrip-photos");
    await user.click(await screen.findByRole("button", { name: "common:photoViewer.enlarge" }));
    const viewer = await screen.findByTestId("photo-viewer");
    expect(within(viewer).getByTestId("lightbox-image")).toHaveAttribute("src", "/img/a.jpg");
  });

  it("tells the user when the library search failed instead of showing an empty list", async () => {
    const user = userEvent.setup();
    getEntryPhotoSuggestions.mockRejectedValue(new Error("immich down"));
    renderIt();
    await screen.findByTestId("roadtrip-photos");
    await user.click(await screen.findByRole("button", { name: "roadtrips:photos.searchLibrary" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("roadtrips:photos.libraryProblem");
  });
});
