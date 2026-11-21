/**
 * PhotoPrism import mode (phase B3): the Immich import job over the real
 * PhotoPrism adapter, with only the HTTP layer faked. What the user sees on a
 * failure is the job row's `error` kind, so every failure path asserts it.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";
import { Readable } from "stream";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const jobUpsert = jest.fn<(args: unknown) => Promise<unknown>>();
const jobUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
const jobUpdateMany = jest.fn<(args: unknown) => Promise<unknown>>();
const jobFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
const linkFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
const linkUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
const photoFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
const photoCreate = jest.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>();

jest.mock("../db", () => ({
  prisma: {
    immichImportJob: {
      upsert: jobUpsert,
      update: jobUpdate,
      updateMany: jobUpdateMany,
      findUnique: jobFindUnique,
    },
    tripImmichAlbum: { findUnique: linkFindUnique, update: linkUpdate },
    tripPhoto: { findMany: photoFindMany, create: photoCreate },
  },
}));

const getPhotoprismConnection = jest.fn<(userId?: string) => Promise<unknown>>();
jest.mock("../services/photoprism/photoprismResolver", () => ({ getPhotoprismConnection }));
const getImmichConnection = jest.fn<(userId?: string) => Promise<unknown>>();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

jest.mock("fs", () => ({
  // Plain functions: `resetAllMocks` below would blank a jest.fn implementation.
  existsSync: () => true,
  createWriteStream: () => {
    const { PassThrough } = jest.requireActual<typeof import("stream")>("stream");
    const sink = new PassThrough();
    sink.on("data", () => {});
    return sink;
  },
  unlinkSync: () => undefined,
}));
jest.mock("../middleware/upload", () => ({
  getTripPhotoDir: () => "/data/uploads/trip-photos",
  deleteTripPhotoFile: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { startAlbumImport, clearImportGuards } from "../services/immich/immichImport";
import { clearPhotoprismTokenCache } from "../services/photoSource/photoprismSource";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const BASE = "https://photos.example.com";
const CONN = { baseUrl: BASE, apiKey: "app-pw", source: "user", allowPrivate: true };

const photo = (hash: string, over: Record<string, unknown> = {}) => ({
  Hash: hash,
  Type: "image",
  TakenAt: "2026-05-01T10:00:00Z",
  TakenSrc: "meta",
  FileName: `2026/05/${hash.slice(0, 6)}.jpg`,
  Lat: 38.7,
  Lng: -9.1,
  ...over,
});

const axiosError = (status?: number) => ({
  isAxiosError: true,
  ...(status === undefined ? { code: "ECONNREFUSED" } : { response: { status, data: "" } }),
});

const media = (contentType = "image/jpeg") => ({
  data: Readable.from([Buffer.from("bytes")]),
  headers: { "content-type": contentType, "content-length": "5" },
  request: undefined,
});

interface Route {
  photos?: unknown;
  /** One entry per /dl call, consumed in order; the last one repeats. */
  downloads?: Array<() => unknown>;
  config?: () => unknown;
}

const isFault = (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as { isAxiosError?: boolean }).isAxiosError === true;

let configCalls = 0;
function routeAxios(route: Route): void {
  let dl = 0;
  mockedAxios.get.mockImplementation((async (url: unknown) => {
    const u = String(url);
    if (u.includes("/config")) {
      configCalls += 1;
      if (route.config) return route.config();
      return {
        data: { version: "261029-x", previewToken: "pt", downloadToken: `dt${configCalls}` },
      };
    }
    if (u.includes("/photos?")) {
      if (isFault(route.photos)) throw route.photos;
      return { data: route.photos ?? [] };
    }
    if (u.includes("/dl/")) {
      const list = route.downloads ?? [() => media()];
      const step = list[Math.min(dl, list.length - 1)];
      dl += 1;
      const out = step();
      if (isFault(out)) throw out;
      return out;
    }
    throw new Error(`unexpected url ${u}`);
  }) as never);
}

const jobStates = () =>
  jobUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
const lastJob = () =>
  jobStates()
    .filter((d) => d.status !== undefined)
    .pop();

beforeEach(() => {
  jest.resetAllMocks();
  clearImportGuards();
  clearPhotoprismTokenCache();
  configCalls = 0;
  getPhotoprismConnection.mockResolvedValue(CONN);
  getImmichConnection.mockResolvedValue(null);
  linkFindUnique.mockResolvedValue({
    id: "link-1",
    tripId: "trip-1",
    provider: "photoprism",
    immichAlbumId: "aq1",
    mode: "import",
  });
  jobFindUnique.mockResolvedValue(null);
  jobUpsert.mockResolvedValue({});
  jobUpdate.mockResolvedValue({});
  linkUpdate.mockResolvedValue({});
  photoFindMany.mockResolvedValue([]);
  photoCreate.mockResolvedValue({ id: "p" });
});

describe("PhotoPrism import", () => {
  it("downloads the originals through the download token and stores provenance with the provider", async () => {
    routeAxios({ photos: [photo(H1), photo(H2)] });

    await startAlbumImport("u1", "link-1");

    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`${BASE}/api/v1/dl/${H1}?t=dt1`);
    expect(urls).toContain(`${BASE}/api/v1/dl/${H2}?t=dt1`);
    expect(photoCreate).toHaveBeenCalledTimes(2);
    expect(photoCreate.mock.calls[0][0].data).toMatchObject({
      tripId: "trip-1",
      provider: "photoprism",
      immichAssetId: H1,
      immichAlbumLinkId: "link-1",
      mimetype: "image/jpeg",
      takenAt: new Date("2026-05-01T10:00:00Z"),
      lat: 38.7,
      lon: -9.1,
    });
    expect(lastJob()).toMatchObject({ status: "completed", failedAssets: 0, processedAssets: 2 });
  });

  it("refreshes the download token after a 401 and still imports the photo", async () => {
    routeAxios({ photos: [photo(H1)], downloads: [() => axiosError(401), () => media()] });

    await startAlbumImport("u1", "link-1");

    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`${BASE}/api/v1/dl/${H1}?t=dt1`);
    expect(urls).toContain(`${BASE}/api/v1/dl/${H1}?t=dt2`);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(lastJob()).toMatchObject({ status: "completed", failedAssets: 0 });
  });

  it("is idempotent per (trip, provider, asset id): known hashes are not downloaded again", async () => {
    routeAxios({ photos: [photo(H1), photo(H2)] });
    photoFindMany.mockResolvedValue([{ immichAssetId: H1 }]);

    await startAlbumImport("u1", "link-1");

    // The lookup is scoped to the PhotoPrism rows: an Immich id never hides a hash.
    expect(photoFindMany.mock.calls[0][0]).toMatchObject({
      where: { tripId: "trip-1", provider: "photoprism" },
    });
    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`/dl/${H1}`))).toBe(false);
    expect(urls.some((u) => u.includes(`/dl/${H2}`))).toBe(true);
  });

  it("stores an undated photo with takenAt null, never 1970", async () => {
    routeAxios({ photos: [photo(H1, { TakenSrc: "", TakenAt: "2026-05-01T10:00:00Z" })] });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate.mock.calls[0][0].data.takenAt).toBeNull();
  });

  it("skips documents, RAW originals and unknown extensions without failing the job", async () => {
    routeAxios({
      photos: [
        photo(H1, { Type: "raw", FileName: "a/b.dng" }),
        photo(H2, { FileName: "a/c.heic" }),
        photo("c".repeat(40)),
      ],
    });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(lastJob()).toMatchObject({ status: "completed", failedAssets: 0 });
  });

  it("counts an original served as a non-image (the SVG placeholder) as a failed photo, not a stored file", async () => {
    routeAxios({
      photos: [photo(H1), photo(H2)],
      downloads: [() => media("image/svg+xml"), () => media()],
    });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(lastJob()).toMatchObject({ status: "completed", failedAssets: 1, processedAssets: 1 });
  });

  it("counts a refused content type of a plain 200 (HTML login page) as a failed photo", async () => {
    routeAxios({ photos: [photo(H1)], downloads: [() => media("text/html")] });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate).not.toHaveBeenCalled();
    expect(lastJob()).toMatchObject({ status: "completed", failedAssets: 1 });
  });

  it("fails the job with kind auth when the original is refused again after the token refresh", async () => {
    routeAxios({ photos: [photo(H1), photo(H2)], downloads: [() => axiosError(401)] });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate).not.toHaveBeenCalled();
    expect(lastJob()).toMatchObject({ status: "failed", error: "auth" });
  });

  it.each([
    ["unreachable", axiosError(), "unreachable"],
    ["a 502", axiosError(502), "unreachable"],
    ["notFound", axiosError(404), "notFound"],
    ["an unexpected 400", axiosError(400), "protocol"],
    ["a rejected app password", axiosError(401), "auth"],
  ])(
    "fails the job with the fixed kind when listing the album fails: %s",
    async (_n, error, kind) => {
      routeAxios({ photos: error as unknown as Error });

      await startAlbumImport("u1", "link-1");

      expect(lastJob()).toMatchObject({ status: "failed", error: kind });
      expect(photoCreate).not.toHaveBeenCalled();
    }
  );

  it("fails the job with protocol when the photo list is not a list", async () => {
    routeAxios({ photos: { error: "nope" } });

    await startAlbumImport("u1", "link-1");

    expect(lastJob()).toMatchObject({ status: "failed", error: "protocol" });
  });

  it("fails the job with invalidUrl when an ordinary account's PhotoPrism is a private address", async () => {
    getPhotoprismConnection.mockResolvedValue({
      ...CONN,
      baseUrl: "http://10.0.0.5:2342",
      allowPrivate: false,
    });
    routeAxios({ photos: [photo(H1)] });

    await startAlbumImport("u1", "link-1");

    expect(lastJob()).toMatchObject({ status: "failed", error: "invalidUrl" });
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("fails the job with notConfigured when the connection is gone, using the PhotoPrism resolver", async () => {
    getPhotoprismConnection.mockResolvedValue(null);
    getImmichConnection.mockResolvedValue(CONN);

    await startAlbumImport("u1", "link-1");

    expect(jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "notConfigured" }),
      })
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("does not start a second run while one is in flight (same guard as Immich)", async () => {
    routeAxios({ photos: [photo(H1)] });
    jobFindUnique.mockResolvedValue({ status: "running", updatedAt: new Date() });

    await startAlbumImport("u1", "link-1");

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(jobUpsert).not.toHaveBeenCalled();
  });
});
