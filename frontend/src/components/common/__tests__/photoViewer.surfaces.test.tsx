import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import JournalPhotoRow from "../../Trips/JournalPhotoRow";
import PhotoJourneyPreviewStrip from "../../inbox/PhotoJourneyPreviewStrip";
import TripPhotoWindowStrip from "../TripPhotoWindowStrip";
import JourneyPhotosSection from "../../Trips/JourneyPhotosSection";
import { PlaceGallery } from "../../places/PlaceGallery";
import NoteCard from "../../notes/NoteCard";
import { noteFixture } from "../../notes/__tests__/noteFixture";
import { PhotoStrip } from "../PhotoStrip";
import { EntryPhotos } from "../EntryPhotos";
import TrackPhotoThumb from "../../../pages/Track/photos/TrackPhotoThumb";
import type { PhotoJourney } from "../../../types/photoJourney";
import type { Place, PlaceVisit } from "../../../types/place";
import type { TripPhoto } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/api/tripPhotoWindows", () => ({
  getTripPhotoWindow: async () => [
    { id: "w1", url: "/w1.jpg", caption: null, takenAt: null, lat: null, lon: null },
  ],
}));
vi.mock("../../../lib/api/photoJourneys", () => ({
  photoJourneyPreviewUrl: (id: string, i: number) =>
    `/api/v1/photo-journeys/${id}/preview/${i}/file`,
  photoJourneysApi: { forTrip: async () => [{ id: "j1", previewCount: 2 }] },
}));
vi.mock("../../../lib/api/entryPhotos", () => ({
  listEntryPhotos: async () => [
    {
      id: "l1",
      url: "/api/v1/entry-photos/stay/s1/photos/l1/file",
      provider: "immich",
      assetId: "a",
      provenance: "manual",
      takenAt: null,
      mimetype: "image/jpeg",
    },
  ],
  getEntryPhotoSuggestions: vi.fn(),
  linkEntryPhotos: vi.fn(),
  removeEntryPhoto: vi.fn(),
  removeAutoEntryPhotos: vi.fn(),
  clearEntryPhotoRefusals: vi.fn(),
}));
vi.mock("../../../lib/api/places", () => ({ setPlaceCover: vi.fn() }));
vi.mock("../../../lib/api/travtrackViews", () => ({
  travTrackViewsApi: {
    photoUrl: (p: { assetId: string }, _w: unknown, size = "thumbnail") =>
      `/api/v1/travtrack/photos/${p.assetId}/file?size=${size}`,
  },
}));

const enlarge = () => screen.findAllByRole("button", { name: "common:photoViewer.enlarge" });

/** Click the first "enlarge" button and expect the shared viewer on screen. */
async function opensLarge(): Promise<void> {
  const [first] = await enlarge();
  await userEvent.click(first);
  expect(await screen.findByTestId("photo-viewer")).toBeInTheDocument();
  expect(screen.getByTestId("lightbox-image")).toBeInTheDocument();
}

const TRIP_PHOTO = {
  id: "p1",
  url: "/p1.jpg",
  caption: "c",
  takenAt: null,
  sortIdx: 0,
  mimetype: "image/jpeg",
  sizeBytes: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
} as TripPhoto;

describe("every photo thumbnail opens the shared viewer", () => {
  it("journal entry photos (were: a new browser tab)", async () => {
    render(<JournalPhotoRow photos={[TRIP_PHOTO]} />);
    await opensLarge();
  });

  it("the photos taken during a stay or flight (were: a new browser tab)", async () => {
    render(
      <MemoryRouter>
        <TripPhotoWindowStrip entry="lodging" id="x" />
      </MemoryRouter>
    );
    await opensLarge();
  });

  it("the trip gallery's library findings (were: no click at all)", async () => {
    render(<JourneyPhotosSection tripId="t" />);
    await opensLarge();
    expect(screen.getByTestId("lightbox-image").getAttribute("src")).toContain("size=preview");
  });

  it("an inbox photo finding's preview strip (were: no click at all)", async () => {
    render(
      <PhotoJourneyPreviewStrip
        journey={{ id: "j1", previewAssetIds: ["a", "b"] } as unknown as PhotoJourney}
      />
    );
    await opensLarge();
  });

  it("a place's visit photos (lead and thumbnails)", async () => {
    const place = {
      id: "pl",
      name: "Trevi",
      coverPhotoId: null,
      visits: [
        {
          id: "v",
          visitedAt: "2024-05-01T10:00:00.000Z",
          photos: [{ id: "a", url: "/a.jpg", caption: null }],
        },
      ] as unknown as PlaceVisit[],
    } as unknown as Place;
    render(<PlaceGallery place={place} />);
    await opensLarge();
  });

  it("a note's photo (were: no click at all)", async () => {
    render(
      <NoteCard
        note={noteFixture({ photo: "n.jpg" } as never)}
        readerZone="UTC"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await opensLarge();
  });

  it("stay, visit and place photo strips", async () => {
    render(
      <PhotoStrip
        photos={[{ id: "s1", url: "/s1.jpg", caption: null }]}
        onUpload={async () => []}
        onDelete={async () => undefined}
        onCaption={async () => ({ id: "s1", url: "/s1.jpg", caption: null })}
        context="test"
      />
    );
    await opensLarge();
  });

  it("an entry's linked library photos (flight, stay, rail, station …)", async () => {
    render(<EntryPhotos kind="stay" entryId="s1" />);
    await waitFor(async () => expect((await enlarge()).length).toBeGreaterThan(0));
    await opensLarge();
    expect(screen.getByTestId("lightbox-image").getAttribute("src")).toContain("size=preview");
  });

  it("a TravTrack day photo, on the map popup and the flight panel", async () => {
    render(
      <TrackPhotoThumb
        photo={{
          assetId: "t1",
          type: "IMAGE",
          takenAt: "2026-07-16T10:00:00.000Z",
          lat: 1,
          lon: 2,
        }}
        window={{ from: "a", to: "b" } as never}
        zone="UTC"
      />
    );
    await opensLarge();
    expect(screen.getByTestId("lightbox-image").getAttribute("src")).toContain("size=preview");
  });
});
