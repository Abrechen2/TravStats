import { describe, expect, it, jest, beforeAll, afterAll } from "@jest/globals";
import { Readable } from "stream";

const created: string[] = [];
jest.mock("../../photoSource", () => {
  const actual = jest.requireActual("../../photoSource") as object;
  return {
    ...actual,
    createPhotoSource: (kind: string) => {
      created.push(kind);
      return {
        streamOriginal: async () => ({
          stream: Readable.from([Buffer.from("x")]),
          contentType: "image/jpeg",
          contentLength: 1,
        }),
      };
    },
  };
});
jest.mock("../../photoSource/connection", () => ({
  ...(jest.requireActual("../../photoSource/connection") as object),
  getPhotoSourceConnection: async () => ({ baseUrl: "http://x.test", apiKey: "k", source: "user" }),
}));

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { ownerAsset } from "../e2e/assets";

describe("federated visit photo bytes", () => {
  const stamp = Date.now();
  let userId: string;
  let photoId: string;
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `fvp-${stamp}`, passwordHash: await hashPassword("pw") },
    });
    userId = user.id;
    const place = await prisma.place.create({ data: { userId, name: "P", lat: 1, lon: 1 } });
    const visit = await prisma.placeVisit.create({ data: { userId, placeId: place.id } });
    photoId = (
      await prisma.placeVisitPhoto.create({
        data: {
          placeVisitId: visit.id,
          filename: null,
          mimetype: "image/jpeg",
          sizeBytes: 0,
          immichAssetId: "0123456789abcdef0123456789abcdef",
          provider: "photoprism",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: "fvp-" } } });
  });

  it("reads a PhotoPrism-linked visit photo from PhotoPrism, not from Immich", async () => {
    await ownerAsset(userId, "visit", photoId);
    expect(created).toEqual(["photoprism"]);
  });
});
