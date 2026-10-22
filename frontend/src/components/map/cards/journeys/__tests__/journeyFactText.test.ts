import { describe, expect, it } from "vitest";
import { journeyFromRail } from "../journeyNormalize";
import { journeyFactText } from "../journeyCardParts";

const t = ((key: string, opts?: { number?: string }) =>
  opts?.number !== undefined ? `${key}:${opts.number}` : key) as never;

const ENDS = {
  depStationName: "Augsburg Hbf",
  depLat: 48.37,
  depLon: 10.89,
  arrStationName: "München Hbf",
  arrLat: 48.14,
  arrLon: 11.56,
};

const ride = (trainCategory: string | null, trainNumber: string | null) =>
  journeyFromRail({
    id: "r",
    status: "completed",
    trainCategory,
    trainNumber,
    ...ENDS,
  } as Parameters<typeof journeyFromRail>[0]);

describe("journeyFactText for a train", () => {
  // Browser test of the bahn.de bookmarklet on 2.7.0-beta.24: a regional
  // train bahn.de names by number alone showed as a bare "57031".
  it("names a train known by its number alone as a train", () => {
    expect(journeyFactText(ride(null, "57031"), t)).toEqual(["rail:bareTrain:57031"]);
  });

  it("leaves a train with a category as it is", () => {
    expect(journeyFactText(ride("S", "1"), t)).toEqual(["S 1"]);
  });
});
