/**
 * The encrypted share reads a linked album's originals through the photo-source
 * layer: a PhotoPrism link must go to PhotoPrism, never to Immich's client.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Readable } from "stream";

const findFirstAlbum = jest.fn<(args: unknown) => Promise<unknown>>();
jest.mock("../db", () => ({ prisma: { tripImmichAlbum: { findFirst: findFirstAlbum } } }));

const listAlbumAssets = jest.fn<(id: string, page: number) => Promise<unknown>>();
const streamOriginal = jest.fn<(id: string) => Promise<unknown>>();
const createPhotoSource = jest.fn((_kind: string, _conn: unknown) => ({
  kind: _kind,
  listAlbumAssets,
  streamOriginal,
}));
jest.mock("../services/photoSource", () => ({
  ...jest.requireActual<object>("../services/photoSource"),
  createPhotoSource,
}));
const getPhotoSourceConnection = jest.fn<(kind: string, userId: string) => Promise<unknown>>();
jest.mock("../services/photoSource/connection", () => ({
  ...jest.requireActual<object>("../services/photoSource/connection"),
  getPhotoSourceConnection,
}));

import { ownerAsset, rowAssets } from "../services/federation/e2e/assets";

const HASH = "d".repeat(40);
const asset = { id: HASH, originalFileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  getPhotoSourceConnection.mockResolvedValue({ baseUrl: "https://p.example.com" });
  listAlbumAssets.mockResolvedValue({ assets: [asset], nextPage: null, truncated: false });
  streamOriginal.mockResolvedValue({ stream: Readable.from(["x"]), contentLength: 1 });
});

describe("federation album assets", () => {
  it("lists a PhotoPrism link's assets through PhotoPrism", async () => {
    const refs = await rowAssets("u1", "TripImmichAlbum", {
      id: "l1",
      mode: "link",
      provider: "photoprism",
      immichAlbumId: "pp1",
    });
    expect(getPhotoSourceConnection).toHaveBeenCalledWith("photoprism", "u1");
    expect(refs.map((r) => r.assetId)).toEqual([HASH]);
  });

  it("streams a member original of a PhotoPrism link and refuses a non-member", async () => {
    findFirstAlbum.mockResolvedValue({ provider: "photoprism", immichAlbumId: "pp1" });
    await ownerAsset("u1", "album", "l1", HASH);
    expect(streamOriginal).toHaveBeenCalledWith(HASH);
    expect(createPhotoSource).toHaveBeenCalledWith("photoprism", expect.anything());
    await expect(ownerAsset("u1", "album", "l1", "e".repeat(40))).rejects.toBeDefined();
  });
});
