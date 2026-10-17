import { combineStayIdentity, type StayIdentityInput } from "./identityCombine";
import type { ImmichAsset } from "../../immich/types";
import type { PlaceResult } from "../../geo/photon";

/**
 * Which place a stay probably was (forgejo#305), from three sources that fail
 * independently. The acceptance asks for Dawarich alone, Immich alone and both;
 * each failure must stay visible as itself rather than read as "nothing here".
 */

// A café in Lisbon's Chiado; 1e-4° of latitude is ~11 m.
const point = { lat: 38.7105, lon: -9.1424 };
const at = (dLat: number, dLon = 0) => ({ lat: point.lat + dLat, lon: point.lon + dLon });

const place = (name: string, dLat: number, extra: Partial<PlaceResult> = {}): PlaceResult => ({
  name,
  ...at(dLat),
  type: "cafe",
  city: "Lisboa",
  ...extra,
});

const photo = (id: string, dLat: number, city?: string): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-10-10T15:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  ...at(dLat),
  ...(city ? { city } : {}),
});

const geocoded = {
  parts: { address: "Rua Garrett 120", city: "Lisboa", country: "Portugal" },
  degraded: false,
};
const nearby = {
  // Photon's importance order: the landmark first, the café second.
  results: [place("Teatro São Carlos", 0.0012, { type: "theatre" }), place("A Brasileira", 0.0002)],
  degraded: false,
};
const noPhotos = { state: "off" as const, assets: [], truncated: false };

const input = (over: Partial<StayIdentityInput>): StayIdentityInput => ({
  point,
  geocode: geocoded,
  places: nearby,
  photos: noPhotos,
  ...over,
});

describe("combineStayIdentity", () => {
  describe("Dawarich alone (no photo evidence)", () => {
    it("names Photon's first place while it lies inside the stay radius", () => {
      const view = combineStayIdentity(input({}));
      // The theatre ranks first and lies 133 m out — inside the 150 m stay radius.
      expect(view.candidates.map((c) => c.distanceM)).toEqual([133, 22]);
      expect(view.probable).toEqual({
        name: "Teatro São Carlos",
        source: "nearbyPlace",
        photoSupported: false,
      });
      expect(view.photos).toEqual({ state: "off", count: 0, cities: [], truncated: false });
      expect(view.candidates.every((c) => c.photoCount === null)).toBe(true);
    });

    it("skips a ranked place outside the stay radius", () => {
      const view = combineStayIdentity(
        input({
          places: {
            results: [place("Castelo", 0.002, { type: "castle" }), place("A Brasileira", 0.0002)],
            degraded: false,
          },
        })
      );
      expect(view.probable?.name).toBe("A Brasileira");
    });

    it("falls back to the address when no named place is near", () => {
      const view = combineStayIdentity(input({ places: { results: [], degraded: false } }));
      expect(view.probable).toEqual({
        name: "Rua Garrett 120",
        source: "address",
        photoSupported: false,
      });
      expect(view.candidatesState).toBe("empty");
      expect(view.address).toEqual({
        address: "Rua Garrett 120",
        city: "Lisboa",
        country: "Portugal",
      });
    });

    it("keeps a failed geocoder apart from a point with no address", () => {
      const failed = combineStayIdentity(
        input({ geocode: { parts: null, degraded: true }, places: { results: [], degraded: true } })
      );
      const empty = combineStayIdentity(
        input({
          geocode: { parts: null, degraded: false },
          places: { results: [], degraded: false },
        })
      );
      expect([failed.geocoder, failed.candidatesState]).toEqual(["degraded", "degraded"]);
      expect([empty.geocoder, empty.candidatesState]).toEqual(["empty", "empty"]);
      expect(failed.probable).toBeNull();
      expect(empty.probable).toBeNull();
    });
  });

  describe("Immich alone (both geocoders down)", () => {
    it("names the photos' most frequent city, marked as coming from the photos", () => {
      const view = combineStayIdentity(
        input({
          geocode: { parts: null, degraded: true },
          places: { results: [], degraded: true },
          photos: {
            state: "ok",
            assets: [
              photo("a", 0, "Lisboa"),
              photo("b", 0.0001, "Lisboa"),
              photo("c", 0.0001, "Almada"),
              photo("d", 0),
            ],
            truncated: false,
          },
        })
      );
      expect(view.probable).toEqual({ name: "Lisboa", source: "photos", photoSupported: true });
      expect(view.photos).toEqual({
        state: "ok",
        count: 4,
        cities: [
          { name: "Lisboa", count: 2 },
          { name: "Almada", count: 1 },
        ],
        truncated: false,
      });
    });
  });

  describe("both", () => {
    it("prefers the nearby place the stay's photos were taken at over Photon's order", () => {
      const view = combineStayIdentity(
        input({
          photos: {
            state: "ok",
            assets: [photo("a", 0.0002), photo("b", 0.0003)],
            truncated: false,
          },
        })
      );
      expect(view.probable).toEqual({
        name: "A Brasileira",
        source: "nearbyPlace",
        photoSupported: true,
      });
      expect(view.candidates.map((c) => [c.name, c.photoCount])).toEqual([
        ["Teatro São Carlos", 0],
        ["A Brasileira", 2],
      ]);
    });

    it("reports a failed Immich as its kind, and judges on Dawarich alone", () => {
      const view = combineStayIdentity(
        input({ photos: { state: "auth", assets: [photo("a", 0.0002)], truncated: false } })
      );
      expect(view.photos).toEqual({ state: "auth", count: 0, cities: [], truncated: false });
      expect(view.probable).toEqual({
        name: "Teatro São Carlos",
        source: "nearbyPlace",
        photoSupported: false,
      });
      expect(view.candidates.every((c) => c.photoCount === null)).toBe(true);
    });

    it("says when Immich stopped at its page cap", () => {
      const view = combineStayIdentity(
        input({ photos: { state: "ok", assets: [photo("a", 0)], truncated: true } })
      );
      expect(view.photos.truncated).toBe(true);
    });
  });
});
