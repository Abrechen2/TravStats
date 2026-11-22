import { describe, it, expect } from "@jest/globals";

import {
  BURST_SECONDS,
  MAX_SUGGESTIONS,
  MIN_SCORE,
  looksLikeNonPhoto,
  rankCoverCandidates,
  scoreCandidate,
  type CoverCandidate,
} from "../score";

const HOTEL = { lat: 38.7, lon: -9.14 };
const T0 = Date.parse("2026-05-03T10:00:00Z");

const photo = (key: string, over: Partial<CoverCandidate> = {}): CoverCandidate => ({
  key,
  takenAt: new Date(T0),
  lat: null,
  lon: null,
  isVideo: false,
  mimeType: "image/jpeg",
  fileName: `${key}.jpg`,
  me: false,
  cameraMake: "Apple",
  ...over,
});

describe("cover ranking", () => {
  it("ranks a photo with me, the place and a favourite above the others", () => {
    const best = photo("best", {
      me: true,
      favorite: true,
      lat: HOTEL.lat + 0.001,
      lon: HOTEL.lon,
      takenAt: new Date(T0),
    });
    const placeOnly = photo("placeOnly", {
      lat: HOTEL.lat,
      lon: HOTEL.lon,
      width: 4000,
      height: 3000,
      takenAt: new Date(T0 + 3_600_000),
    });
    const meOnly = photo("meOnly", { me: true, takenAt: new Date(T0 + 7_200_000) });
    const ranked = rankCoverCandidates([placeOnly, meOnly, best], [HOTEL]);
    expect(ranked.map((r) => r.candidate.key)).toEqual(["best", "meOnly", "placeOnly"]);
    expect(ranked[0].reasons.map((r) => r.code)).toEqual(["me", "placeClose", "favorite"]);
    expect(ranked[0].score).toBe(ranked[0].reasons.reduce((s, r) => s + r.points, 0));
  });

  it("keeps only the best frame of a burst", () => {
    const a = photo("a", { me: true, favorite: true });
    const b = photo("b", { me: true, takenAt: new Date(T0 + (BURST_SECONDS - 1) * 1000) });
    const later = photo("later", { me: true, takenAt: new Date(T0 + 60_000) });
    const ranked = rankCoverCandidates([b, a, later], []);
    expect(ranked.map((r) => r.candidate.key)).toEqual(["a", "later"]);
  });

  it("abstains when only quality signals exist, rather than offering the least bad photo", () => {
    const sharp = photo("sharp", { width: 6000, height: 4000, quality: 7 });
    expect(scoreCandidate(sharp, []).score).toBeLessThan(MIN_SCORE);
    expect(rankCoverCandidates([sharp], [HOTEL])).toEqual([]);
    expect(rankCoverCandidates([], [HOTEL])).toEqual([]);
  });

  it("never suggests a screenshot, a scan, a video or a camera-less PNG", () => {
    const flags = { me: true, favorite: true } as const;
    expect(looksLikeNonPhoto(photo("a", { ...flags, fileName: "Screenshot_2026.jpg" }))).toBe(true);
    expect(
      looksLikeNonPhoto(photo("b", { ...flags, mimeType: "image/png", cameraMake: null }))
    ).toBe(true);
    expect(looksLikeNonPhoto(photo("c", { ...flags, isVideo: true }))).toBe(true);
    expect(looksLikeNonPhoto(photo("d", { ...flags, mimeType: "application/pdf" }))).toBe(true);
    expect(rankCoverCandidates([photo("e", { ...flags, fileName: "scan0001.jpg" })], [])).toEqual(
      []
    );
  });

  it("gives a photo with unknown dimensions and position neither points nor a penalty", () => {
    const c = photo("c", { me: true, width: null, height: null });
    expect(scoreCandidate(c, [HOTEL]).reasons.map((r) => r.code)).toEqual(["me"]);
  });

  it("returns at most three", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      photo(`p${i}`, { me: true, takenAt: new Date(T0 + i * 600_000) })
    );
    expect(rankCoverCandidates(many, [])).toHaveLength(MAX_SUGGESTIONS);
  });
});
