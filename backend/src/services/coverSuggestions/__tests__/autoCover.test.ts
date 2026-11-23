import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { immichCoverUrl } from "../../../routes/immich/tripCover";
import type { CoverSuggestion, CoverSuggestions } from "../suggest";

const suggestCover = jest.fn<(userId: string, tripId: string) => Promise<CoverSuggestions>>();
jest.mock("../suggest", () => ({ suggestCover }));

import {
  applyAutoCover,
  autoCoverCandidates,
  coverUrlOf,
  pickAutoCover,
  removeAutoCovers,
  runAutoCoverForUser,
} from "../autoCover";
import { fillEmptyCover, manualCoverData } from "../../trip/tripCover";

const sug = (score: number, id = `p${score}`): CoverSuggestion => ({
  key: id,
  thumbUrl: `/api/v1/trips/T/photos/${id}/file`,
  takenAt: null,
  score,
  reasons: [],
  apply: { type: "photo", photoId: id },
});
const okSources: CoverSuggestions["sources"] = [{ provider: "immich", photos: "ok", people: "ok" }];
const answer = (suggestions: CoverSuggestion[], sources = okSources): CoverSuggestions => ({
  suggestions,
  abstained: null,
  sources,
});

describe("pickAutoCover: the threshold and lead rule", () => {
  it("picks a photo at 60 that leads by 15", () => {
    expect(pickAutoCover([sug(75, "b"), sug(60, "a")])?.key).toBe("b");
    expect(pickAutoCover([sug(60, "a"), sug(45, "c")])?.key).toBe("a");
  });
  it("leaves it a suggestion when the lead is 14", () => {
    expect(pickAutoCover([sug(80), sug(66)])).toBeNull();
  });
  it("leaves it a suggestion when the best is below 60", () => {
    expect(pickAutoCover([sug(59), sug(10)])).toBeNull();
  });
  it("picks a lone photo that scores 60", () => {
    expect(pickAutoCover([sug(60)])?.score).toBe(60);
  });
  it("turns a thumbnail into the cover size the manual routes use", () => {
    const album: CoverSuggestion = {
      ...sug(70),
      thumbUrl: "/api/v1/trips/t1/immich/albums/l1/assets/a1/file?size=thumbnail",
    };
    expect(coverUrlOf(album)).toBe(immichCoverUrl("t1", "l1", "a1"));
  });
});

describe("applyAutoCover and the job", () => {
  const stamp = Date.now();
  let userId: string;
  let otherId: string;
  const start = new Date("2026-05-01T00:00:00Z");

  const trip = (data: Record<string, unknown> = {}, owner = userId) =>
    prisma.trip.create({
      data: { userId: owner, name: "T", startDate: start, endDate: start, ...data },
    });
  const cover = async (id: string) =>
    prisma.trip.findUniqueOrThrow({
      where: { id },
      select: { coverImageUrl: true, coverSource: true },
    });

  beforeAll(async () => {
    const pw = await hashPassword("pw-12345678");
    userId = (await prisma.user.create({ data: { username: `ac-a-${stamp}`, passwordHash: pw } }))
      .id;
    otherId = (await prisma.user.create({ data: { username: `ac-b-${stamp}`, passwordHash: pw } }))
      .id;
  });
  beforeEach(async () => {
    suggestCover.mockReset();
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });
  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("sets a sure pick as an auto cover", async () => {
    const t = await trip();
    suggestCover.mockResolvedValue(answer([sug(80, "x"), sug(50, "y")]));
    expect(await applyAutoCover(userId, t.id)).toBe("applied");
    expect(await cover(t.id)).toEqual({
      coverImageUrl: "/api/v1/trips/T/photos/x/file",
      coverSource: "auto",
    });
  });

  it("never overwrites a manual cover", async () => {
    const t = await trip();
    await prisma.trip.update({ where: { id: t.id }, data: manualCoverData("/mine.jpg") });
    suggestCover.mockResolvedValue(answer([sug(90)]));
    expect(await applyAutoCover(userId, t.id)).toBe("hasCover");
    expect(suggestCover).not.toHaveBeenCalled();
    expect(await cover(t.id)).toEqual({ coverImageUrl: "/mine.jpg", coverSource: "manual" });
  });

  it("does not overwrite a cover a person sets while the sources are being read", async () => {
    const t = await trip();
    suggestCover.mockImplementation(async () => {
      await prisma.trip.update({ where: { id: t.id }, data: manualCoverData("/raced.jpg") });
      return answer([sug(90)]);
    });
    expect(await applyAutoCover(userId, t.id)).toBe("hasCover");
    expect((await cover(t.id)).coverSource).toBe("manual");
  });

  it("gives no pick when a photo source failed, and says why", async () => {
    const t = await trip();
    suggestCover.mockResolvedValue(
      answer([sug(90)], [{ provider: "immich", photos: "unreachable", people: "notSet" }])
    );
    expect(await applyAutoCover(userId, t.id)).toBe("sourceFailed");
    expect((await cover(t.id)).coverImageUrl).toBeNull();
  });

  it("makes no pick when the setting is off", async () => {
    const t = await trip();
    await prisma.userSettings.create({ data: { userId, data: {}, autoCoverEnabled: false } });
    suggestCover.mockResolvedValue(answer([sug(90)]));
    expect(await applyAutoCover(userId, t.id)).toBe("disabled");
    expect(suggestCover).not.toHaveBeenCalled();
    expect((await runAutoCoverForUser(userId, 0)).disabled).toBe(1);
    expect((await cover(t.id)).coverImageUrl).toBeNull();
  });

  it("the job looks only at trips without a cover that have photos", async () => {
    const withPhoto = await trip();
    await prisma.tripPhoto.create({
      data: { tripId: withPhoto.id, filename: "a.jpg", mimetype: "image/jpeg", sizeBytes: 1 },
    });
    const noPhotos = await trip();
    const covered = await trip({ coverImageUrl: "/c.jpg", coverSource: "manual" });
    await prisma.tripPhoto.create({
      data: { tripId: covered.id, filename: "b.jpg", mimetype: "image/jpeg", sizeBytes: 1 },
    });
    const foreign = await trip({}, otherId);
    await prisma.tripPhoto.create({
      data: { tripId: foreign.id, filename: "c.jpg", mimetype: "image/jpeg", sizeBytes: 1 },
    });
    expect(await autoCoverCandidates(userId)).toEqual([withPhoto.id]);
    suggestCover.mockResolvedValue(answer([sug(90, "w")]));
    const counts = await runAutoCoverForUser(userId, 0);
    expect(counts.applied).toBe(1);
    expect(suggestCover).toHaveBeenCalledTimes(1);
    expect((await cover(noPhotos.id)).coverImageUrl).toBeNull();
    expect((await cover(foreign.id)).coverImageUrl).toBeNull();
  });

  it("undo removes only auto covers", async () => {
    const auto = await trip();
    await fillEmptyCover(auto.id, "/auto.jpg");
    const manual = await trip();
    await prisma.trip.update({ where: { id: manual.id }, data: manualCoverData("/mine.jpg") });
    const foreignAuto = await trip({}, otherId);
    await fillEmptyCover(foreignAuto.id, "/theirs.jpg");

    expect(await removeAutoCovers(userId)).toBe(1);
    expect(await cover(auto.id)).toEqual({ coverImageUrl: null, coverSource: null });
    expect(await cover(manual.id)).toEqual({ coverImageUrl: "/mine.jpg", coverSource: "manual" });
    expect((await cover(foreignAuto.id)).coverSource).toBe("auto");
  });

  it("a later manual crop on an auto cover marks it manual, so undo spares it", async () => {
    const t = await trip();
    await fillEmptyCover(t.id, "/auto.jpg");
    await prisma.trip.update({
      where: { id: t.id },
      data: { coverCrop: { x: 0.5, y: 0.5, zoom: 1 }, coverSource: "manual" },
    });
    expect(await removeAutoCovers(userId)).toBe(0);
  });
});
