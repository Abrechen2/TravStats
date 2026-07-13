import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "../client";
import { failureKey, immichApi, immichFailureKind } from "../immich";

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockPut = vi.mocked(api.put);
const mockDel = vi.mocked(api.delete);

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: {} });
  mockPost.mockResolvedValue({ data: {} });
  mockPut.mockResolvedValue({ data: {} });
  mockDel.mockResolvedValue({ data: {} });
});

describe("immichApi settings", () => {
  it("reads the connection status", async () => {
    mockGet.mockResolvedValue({ data: { baseUrl: "https://immich.lan", hasKey: true } });
    await expect(immichApi.getSettings()).resolves.toMatchObject({ hasKey: true });
    expect(mockGet).toHaveBeenCalledWith("/settings/immich");
  });

  it("sends a null apiKey to clear the stored key", async () => {
    await immichApi.updateSettings({ apiKey: null });
    expect(mockPut).toHaveBeenCalledWith("/settings/immich", { apiKey: null });
  });

  it("tests an ad-hoc pair", async () => {
    await immichApi.testConnection({ baseUrl: "https://x.lan", apiKey: "k" });
    expect(mockPost).toHaveBeenCalledWith("/settings/immich/test", {
      baseUrl: "https://x.lan",
      apiKey: "k",
    });
  });
});

describe("immichApi trip albums", () => {
  it("lists albums for the picker", async () => {
    await immichApi.listAlbums("trip-1");
    expect(mockGet).toHaveBeenCalledWith("/trips/trip-1/immich/albums");
  });

  it("links albums with their per-album mode", async () => {
    await immichApi.linkAlbums("trip-1", [{ immichAlbumId: "a1", mode: "import" }]);
    expect(mockPost).toHaveBeenCalledWith("/trips/trip-1/immich/albums", {
      albums: [{ immichAlbumId: "a1", mode: "import" }],
    });
  });

  it("passes deleteCopies through as a query param", async () => {
    await immichApi.unlinkAlbum("trip-1", "link-1", true);
    expect(mockDel).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1?deleteCopies=true");

    await immichApi.unlinkAlbum("trip-1", "link-1", false);
    expect(mockDel).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1?deleteCopies=false");
  });

  it("requests an import estimate for one album", async () => {
    await immichApi.estimateImport("trip-1", "a1");
    expect(mockGet).toHaveBeenCalledWith("/trips/trip-1/immich/estimate?albumId=a1");
  });

  it("kicks a resync and polls the job", async () => {
    await immichApi.resyncAlbum("trip-1", "link-1");
    expect(mockPost).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1/resync");

    await immichApi.getImportJob("trip-1", "link-1");
    expect(mockGet).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1/import-job");
  });

  it("sets a cover from a live asset and from a local photo", async () => {
    await immichApi.setImmichCover("trip-1", "link-1", "asset-1");
    expect(mockPost).toHaveBeenCalledWith("/trips/trip-1/immich/cover", {
      linkId: "link-1",
      assetId: "asset-1",
    });

    await immichApi.setPhotoCover("trip-1", "photo-1");
    expect(mockPost).toHaveBeenCalledWith("/trips/trip-1/photos/photo-1/cover");
  });
});

describe("immichFailureKind", () => {
  it("extracts the kind from a 409 notConfigured", () => {
    expect(immichFailureKind({ response: { status: 409, data: { error: "notConfigured" } } })).toBe(
      "notConfigured"
    );
  });

  it("extracts the kind from a 502 upstream failure", () => {
    expect(immichFailureKind({ response: { status: 502, data: { error: "auth" } } })).toBe("auth");
  });

  it("extracts the invalidUrl kind from a 400 bad-URL failure", () => {
    expect(immichFailureKind({ response: { status: 400, data: { error: "invalidUrl" } } })).toBe(
      "invalidUrl"
    );
  });

  it("returns null for an unrelated error", () => {
    expect(immichFailureKind(new Error("boom"))).toBeNull();
    expect(immichFailureKind({ response: { status: 500, data: {} } })).toBeNull();
  });
});

describe("failureKey", () => {
  it("maps every known kind to its errors.* key", () => {
    expect(failureKey("auth")).toBe("errors.auth");
    expect(failureKey("notConfigured")).toBe("errors.notConfigured");
    expect(failureKey("invalidUrl")).toBe("errors.invalidUrl");
  });

  it("falls back to errors.unknown for anything else", () => {
    // Never assert a network claim (`unreachable`) the app has not established,
    // and never leak raw backend prose into the UI.
    expect(failureKey("somethingNewFromTheBackend")).toBe("errors.unknown");
    expect(failureKey(undefined)).toBe("errors.unknown");
    expect(failureKey(null)).toBe("errors.unknown");
    expect(failureKey(42)).toBe("errors.unknown");
  });
});
