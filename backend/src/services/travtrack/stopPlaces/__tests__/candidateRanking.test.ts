import type { PlaceResult } from "../../../geo/photon";
import { rankStopCandidates } from "../candidateRanking";

const ORIGIN = { lat: 48.8, lon: 9.2 };
const M = 111_195;

/** name(type, distance) lists as the geocoder returned them, 4 Nov 2026 (rc.22). */
const hit = (name: string, type: string, distanceM: number): PlaceResult => ({
  name,
  type,
  lat: ORIGIN.lat + distanceM / M,
  lon: ORIGIN.lon,
});

const rank = (hits: PlaceResult[]) => rankStopCandidates(hits, ORIGIN).map((p) => p.name);

describe("rankStopCandidates", () => {
  it("never offers a road as the stop, only the office behind it (Mercedes-Benz Bank case)", () => {
    const names = rank([
      hit("Siemensstraße", "primary", 28),
      hit("Stresemannstraße", "secondary", 35),
      hit("Pragsattel", "primary", 41),
      hit("Pragsattel", "secondary_link", 48),
      hit("Mercedes-Benz Bank", "office", 140),
    ]);
    expect(names).toEqual(["Mercedes-Benz Bank"]);
  });

  it("ranks the supermarket above a shop, a parcel locker and the DHL Packstation", () => {
    expect(
      rank([
        hit("Sailer", "shop", 12),
        hit("DHL Packstation 152", "parcel_locker", 21),
        hit("Lidl", "supermarket", 23),
      ])[0]
    ).toBe("Lidl");
  });

  it("ranks the restaurant above the street it stands in", () => {
    expect(
      rank([hit("Steinhaldenstraße", "tertiary", 9), hit("Restaurant Steinhalde", "restaurant", 9)])
    ).toEqual(["Restaurant Steinhalde"]);
  });

  it("ranks a charging station above a vending machine and a retail hit", () => {
    expect(
      rank([
        hit("Snacks Drinks 24/7", "vending_machine", 12),
        hit("H_Albzeit", "retail", 28),
        hit("Merklingen Supercharger", "charging_station", 31),
      ])
    ).toEqual(["Merklingen Supercharger", "H_Albzeit"]);
  });

  it("does not offer a shop beyond the near ring", () => {
    expect(rank([hit("Far shop", "shop", 180), hit("Near shop", "shop", 60)])).toEqual([
      "Near shop",
    ]);
  });
});
