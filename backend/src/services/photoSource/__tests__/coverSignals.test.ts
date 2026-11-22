/**
 * What the cover suggestions read from each source: the people list, the
 * "photos of this person" filter and the quality hints. The request shapes are
 * taken from the providers' API sources (see the 2026-11-22 spec); a test
 * never reaches a real instance.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { createImmichClient } from "../../immich/immichClient";
import { createPhotoprismPhotoSource, clearPhotoprismTokenCache } from "../photoprismSource";
import type { ImmichConnection } from "../../immich/types";

const CONN: ImmichConnection = {
  baseUrl: "https://x.example.com",
  apiKey: "k",
  source: "user",
  allowPrivate: true,
};
const RANGE = {
  takenAfter: new Date("2026-05-01T00:00:00Z"),
  takenBefore: new Date("2026-05-05T00:00:00Z"),
};

beforeEach(() => {
  jest.resetAllMocks();
  clearPhotoprismTokenCache();
});

describe("Immich cover signals", () => {
  it("lists only named, visible people", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        people: [
          { id: "p1", name: "Me", isHidden: false },
          { id: "p2", name: "", isHidden: false },
          { id: "p3", name: "Hidden", isHidden: true },
        ],
        hasNextPage: false,
      },
    });
    const people = await createImmichClient(CONN).listPeople();
    expect(people).toEqual([{ id: "p1", name: "Me" }]);
    expect(String(mockedAxios.get.mock.calls[0][0])).toContain("/api/people?page=1");
  });

  it("filters a time search to one person with personIds and reads favourite, size and camera", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        assets: {
          items: [
            {
              id: "a1",
              type: "IMAGE",
              fileCreatedAt: "2026-05-03T10:00:00.000Z",
              originalFileName: "a1.jpg",
              originalMimeType: "image/jpeg",
              isFavorite: true,
              exifInfo: { exifImageWidth: 4000, exifImageHeight: 3000, make: "Apple" },
            },
          ],
          nextPage: null,
        },
      },
    });
    const page = await createImmichClient(CONN).searchAssetsByDate(RANGE, { personId: "p1" });
    expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({ personIds: ["p1"], type: "IMAGE" });
    expect(page.assets[0]).toMatchObject({
      favorite: true,
      width: 4000,
      height: 3000,
      cameraMake: "Apple",
    });
  });

  it("sends no personIds on an ordinary time search", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assets: { items: [], nextPage: null } } });
    await createImmichClient(CONN).searchAssetsByDate(RANGE);
    expect(mockedAxios.post.mock.calls[0][1]).not.toHaveProperty("personIds");
  });
});

describe("PhotoPrism cover signals", () => {
  const HASH = "b".repeat(40);

  it("lists named, visible subjects of type person", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { UID: "sq1", Name: "Me", Hidden: false },
        { UID: "sq2", Name: "", Hidden: false },
        { UID: "sq3", Name: "Gone", Hidden: true },
      ],
    });
    const people = await createPhotoprismPhotoSource(CONN).listPeople();
    expect(people).toEqual([{ id: "sq1", name: "Me" }]);
    expect(String(mockedAxios.get.mock.calls[0][0])).toContain("/subjects?type=person&count=");
  });

  it("filters a time search with subject= and reads favourite, quality and size", async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          Hash: HASH,
          Type: "image",
          TakenAt: "2026-05-03T10:00:00Z",
          TakenSrc: "meta",
          FileName: "2026/05/IMG.jpg",
          Favorite: true,
          Quality: 6,
          Width: 4000,
          Height: 3000,
          CameraMake: "Apple",
          Lat: 38.7,
          Lng: -9.1,
        },
      ],
    });
    const found = await createPhotoprismPhotoSource(CONN).searchAssetsByTime(RANGE, {
      personId: "sq1",
    });
    expect(String(mockedAxios.get.mock.calls[0][0])).toContain("&subject=sq1");
    expect(found.assets[0]).toMatchObject({
      favorite: true,
      quality: 6,
      width: 4000,
      cameraMake: "Apple",
    });
  });
});
