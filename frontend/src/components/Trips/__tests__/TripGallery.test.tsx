import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import TripGallery from "../TripGallery";
import type { TripPhoto } from "../../../types";
import type { LinkedAlbum } from "../../../types/immich";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

vi.mock("../../../lib/api", () => ({
  tripsApi: {
    uploadPhotos: vi.fn(),
    deletePhoto: vi.fn(),
  },
}));

vi.mock("../PhotoLightbox", () => ({ default: () => <div data-testid="lightbox" /> }));
vi.mock("../ImmichAlbumPicker", () => ({ default: () => <div data-testid="picker" /> }));
vi.mock("../ImmichAlbumSection", () => ({
  default: ({ album }: { album: LinkedAlbum }) => (
    <div data-testid="immich-album-section">{album.albumName}</div>
  ),
}));

const PHOTO: TripPhoto = {
  id: "photo-1",
  url: "/photo-1.jpg",
  caption: null,
  takenAt: null,
  sortIdx: 0,
  mimetype: "image/jpeg",
  sizeBytes: 1234,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const ALBUM: LinkedAlbum = {
  id: "link-1",
  immichAlbumId: "a1",
  albumName: "Rome",
  assetCount: 2,
  thumbnailAssetId: null,
  mode: "link",
  sortIdx: 0,
  lastSyncedAt: null,
};

describe("TripGallery — uploaded-photos section visibility (#179)", () => {
  it("shows the empty-state box when there are no uploads and no linked Immich albums", () => {
    render(
      <TripGallery tripId="trip-1" photos={[]} immichAlbums={[]} onChange={vi.fn()} />
    );

    expect(screen.getByText("trips:gallery.empty")).toBeInTheDocument();
    expect(screen.getByText("immich:gallery.uploaded")).toBeInTheDocument();
  });

  it("hides the uploaded-photos section entirely when there are no uploads but at least one linked album", () => {
    render(
      <TripGallery tripId="trip-1" photos={[]} immichAlbums={[ALBUM]} onChange={vi.fn()} />
    );

    expect(screen.queryByText("trips:gallery.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("immich:gallery.uploaded")).not.toBeInTheDocument();
    expect(screen.getByTestId("immich-album-section")).toBeInTheDocument();
  });

  it("shows the photo grid (not the empty box) when uploads exist and there are no linked albums", () => {
    render(
      <TripGallery tripId="trip-1" photos={[PHOTO]} immichAlbums={[]} onChange={vi.fn()} />
    );

    expect(screen.getByText("immich:gallery.uploaded")).toBeInTheDocument();
    expect(screen.queryByText("trips:gallery.empty")).not.toBeInTheDocument();
    expect(screen.getByRole("presentation")).toBeInTheDocument();
  });

  it("shows both the photo grid and the Immich album sections when both exist", () => {
    render(
      <TripGallery tripId="trip-1" photos={[PHOTO]} immichAlbums={[ALBUM]} onChange={vi.fn()} />
    );

    expect(screen.getByText("immich:gallery.uploaded")).toBeInTheDocument();
    expect(screen.getByRole("presentation")).toBeInTheDocument();
    expect(screen.getByTestId("immich-album-section")).toBeInTheDocument();
  });

  it.each<[string, TripPhoto[], LinkedAlbum[]]>([
    ["no photos, no albums", [], []],
    ["no photos, one linked album", [], [ALBUM]],
    ["photos, no linked albums", [PHOTO], []],
    ["photos and a linked album", [PHOTO], [ALBUM]],
  ])(
    "keeps the upload button and the link-album button visible when %s",
    (_label, photos, immichAlbums) => {
      render(
        <TripGallery
          tripId="trip-1"
          photos={photos}
          immichAlbums={immichAlbums}
          onChange={vi.fn()}
        />
      );

      expect(screen.getByText("trips:gallery.uploadButton")).toBeInTheDocument();
      expect(screen.getByText("immich:albums.link")).toBeInTheDocument();
    }
  );
});
