import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { Readable } from "stream";

const findAssetIdByChecksum = jest.fn<(checksum: string) => Promise<string | null>>();
const fetchAssetStream = jest.fn<(assetId: string, size: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichClient", () => ({
  createImmichClient: () => ({ findAssetIdByChecksum, fetchAssetStream }),
}));
const getImmichConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichResolver", () => ({
  getImmichConnection: (userId: string) => getImmichConnection(userId),
}));

import fs from "fs";
import path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { getPlacePhotoDir } from "../../middleware/upload";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * forgejo#21: a place-visit photo copy becomes a link into its owner's Immich.
 *
 * Owner decision 2026-09-17 — the row is the grant. What these pin: a copy is
 * linked only by an exact checksum match and then loses its file; the file
 * route streams the asset stored on the row; and a stranger's visit is a 404
 * before Immich is ever asked.
 */
const ASSET = "22222222-2222-4222-8222-222222222222";
const CONNECTION = { baseUrl: "http://immich.test", apiKey: "k", source: "user" };

describe("place-visit photos as Immich links", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerCookie: string;
  let cookie: string;
  let visitId: string;

  const photo = async (checksum: string | null) => {
    const filename = `link-${stamp}-${Math.random().toString(36).slice(2)}.jpg`;
    fs.writeFileSync(path.join(getPlacePhotoDir(), filename), "jpeg-bytes");
    return prisma.placeVisitPhoto.create({
      data: { placeVisitId: visitId, filename, mimetype: "image/jpeg", sizeBytes: 10, checksum },
    });
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `vp-link-${stamp}`, passwordHash } }))
      .id;
    const stranger = await prisma.user.create({
      data: { username: `vp-link-other-${stamp}`, passwordHash },
    });
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    const place = await prisma.place.create({
      data: { userId, name: "Trevi", lat: 41.9, lon: 12.48 },
    });
    visitId = (await prisma.placeVisit.create({ data: { userId, placeId: place.id } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `vp-link-` } } });
  });

  beforeEach(() => {
    findAssetIdByChecksum.mockReset();
    fetchAssetStream.mockReset();
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue(CONNECTION);
  });

  it("links a copy whose checksum Immich knows, removes the copy, and leaves an unmatched one alone", async () => {
    const matched = await photo("matched-sha1");
    const unmatched = await photo("unknown-sha1");
    const unhashed = await photo(null);
    findAssetIdByChecksum.mockImplementation(async (checksum) =>
      checksum === "matched-sha1" ? ASSET : null
    );

    const res = await request(app)
      .post("/api/v1/places/visits/photos/immich-link")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ checked: 2, linked: 1 });
    const linked = await prisma.placeVisitPhoto.findUniqueOrThrow({ where: { id: matched.id } });
    expect(linked).toMatchObject({ immichAssetId: ASSET, filename: null });
    expect(fs.existsSync(path.join(getPlacePhotoDir(), matched.filename!))).toBe(false);
    expect(
      (await prisma.placeVisitPhoto.findUniqueOrThrow({ where: { id: unmatched.id } })).filename
    ).toBe(unmatched.filename);
    // Never asked about: a photo without a checksum could only be matched by guessing.
    expect(findAssetIdByChecksum).not.toHaveBeenCalledWith(null);
    expect(
      (await prisma.placeVisitPhoto.findUniqueOrThrow({ where: { id: unhashed.id } })).filename
    ).toBe(unhashed.filename);
  });

  it("answers 409 when the user has no Immich to link into", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/places/visits/photos/immich-link")
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
  });

  it("streams a linked photo from Immich by the asset on its row", async () => {
    const row = await prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: visitId,
        filename: null,
        mimetype: "image/jpeg",
        sizeBytes: 10,
        immichAssetId: ASSET,
      },
    });
    fetchAssetStream.mockResolvedValue({
      stream: Readable.from([Buffer.from("immich-bytes")]),
      contentType: "image/jpeg",
      contentLength: 12,
    });

    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos/${row.id}/file?size=thumbnail`)
      .set("Cookie", cookie)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(fetchAssetStream).toHaveBeenCalledWith(ASSET, "thumbnail");
    expect(res.headers["cache-control"]).toContain("private");

    const foreign = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos/${row.id}/file`)
      .set("Cookie", strangerCookie);
    expect(foreign.status).toBe(404);
    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
  });
});
