import { listAllAlbumAssets } from "..";
import type { PhotoSourceAsset, PhotoSourceProvider } from "../types";

const asset = (id: string): PhotoSourceAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2024-05-01T00:00:00Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat: null,
  lon: null,
});

function sourceWithPages(pages: PhotoSourceAsset[][], truncatedAtEnd = false): PhotoSourceProvider {
  const unused = (): never => {
    throw new Error("not used");
  };
  return {
    kind: "immich",
    test: unused,
    listAlbums: unused,
    streamThumbnail: unused,
    streamOriginal: unused,
    listAlbumAssets: async (_albumId, page) => ({
      assets: pages[page] ?? [],
      nextPage: page + 1 < pages.length ? page + 1 : null,
      truncated: truncatedAtEnd && page + 1 === pages.length,
    }),
  };
}

describe("listAllAlbumAssets", () => {
  it("follows nextPage until the last page and keeps the order", async () => {
    const all = await listAllAlbumAssets(
      sourceWithPages([[asset("a"), asset("b")], [asset("c")]]),
      "x"
    );
    expect(all.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(all.truncated).toBeUndefined();
  });

  it("carries truncated on the array when a page reports it", async () => {
    const all = await listAllAlbumAssets(sourceWithPages([[asset("a")]], true), "x");
    expect(all.truncated).toBe(true);
  });

  it("lets a failing page fail the whole listing instead of returning a prefix", async () => {
    const source = sourceWithPages([[asset("a")], [asset("b")]]);
    const failing: PhotoSourceProvider = {
      ...source,
      listAlbumAssets: async (id, page) => {
        if (page === 1) throw new Error("boom");
        return source.listAlbumAssets(id, page);
      },
    };
    await expect(listAllAlbumAssets(failing, "x")).rejects.toThrow("boom");
  });
});
