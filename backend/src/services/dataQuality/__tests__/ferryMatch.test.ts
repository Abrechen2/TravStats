import { describe, expect, it } from "@jest/globals";

import { dataQualityFlagPayloadSchema } from "../../../schemas/dataQualityFlag";
import { serializeTime } from "../../../shared/time/wire";
import { findFerryMatches } from "../checks/ferryMatch";
import type { FerryRecord, TripRecord } from "../recordGather";

const trip = (over: Partial<TripRecord> & { id: string }): TripRecord => ({
  name: `Trip ${over.id}`,
  status: "completed",
  startDay: "2026-07-01",
  endDay: "2026-07-14",
  ...over,
});

const ride = (over: Partial<FerryRecord> & { id: string }): FerryRecord => ({
  status: "completed",
  tripId: null,
  onRoadtrip: false,
  depName: "Piraeus",
  arrName: "Naxos",
  departure: serializeTime(new Date("2026-07-05T07:00:00Z"), "Europe/Athens"),
  firstDay: "2026-07-05",
  lastDay: "2026-07-05",
  ...over,
});

const run = (ferryJourneys: FerryRecord[], trips: TripRecord[]) =>
  findFerryMatches({ ferryJourneys, trips });

describe("findFerryMatches — ferry_match (spec C3)", () => {
  it("offers a ride on no trip to the one trip whose days hold it", () => {
    const [finding] = run([ride({ id: "f1" })], [trip({ id: "t1", name: "Kykladen" })]);
    expect(finding).toEqual({
      entityType: "ferry_journey",
      entityId: "f1",
      kind: "ferry_match",
      details: {
        ferryId: "f1",
        candidateTripId: "t1",
        candidateTripName: "Kykladen",
        departurePort: "Piraeus",
        arrivalPort: "Naxos",
        departureTime: {
          utc: "2026-07-05T07:00:00.000Z",
          zone: "Europe/Athens",
          offset: "+03:00",
          local: "2026-07-05T10:00:00",
          precision: "minute",
          zoneSource: "stored",
        },
        reason: "insideTripWindow",
      },
    });
    expect(dataQualityFlagPayloadSchema.safeParse(finding).success).toBe(true);
  });

  it("counts the first and the last day of the trip as inside", () => {
    expect(
      run([ride({ id: "f1", firstDay: "2026-07-01", lastDay: "2026-07-14" })], [trip({ id: "t1" })])
    ).toHaveLength(1);
  });

  it("asks nothing for a crossing that leaves the trip's days", () => {
    expect(
      run([ride({ id: "f1", firstDay: "2026-07-14", lastDay: "2026-07-15" })], [trip({ id: "t1" })])
    ).toEqual([]);
    expect(
      run([ride({ id: "f2", firstDay: "2026-06-30", lastDay: "2026-06-30" })], [trip({ id: "t1" })])
    ).toEqual([]);
  });

  it("asks nothing when two trips hold the crossing — the choice is the user's", () => {
    expect(
      run([ride({ id: "f1" })], [trip({ id: "t1" }), trip({ id: "t2", startDay: "2026-07-04" })])
    ).toEqual([]);
  });

  it("asks nothing for a ride already on a trip, on a roadtrip, cancelled, or undated", () => {
    expect(
      run(
        [
          ride({ id: "a", tripId: "t9" }),
          ride({ id: "b", onRoadtrip: true }),
          ride({ id: "c", status: "cancelled" }),
          ride({ id: "d", firstDay: null, lastDay: null }),
        ],
        [trip({ id: "t1" })]
      )
    ).toEqual([]);
  });

  it("ignores a cancelled trip and a trip without both days", () => {
    expect(
      run(
        [ride({ id: "f1" })],
        [trip({ id: "t1", status: "cancelled" }), trip({ id: "t2", endDay: null })]
      )
    ).toEqual([]);
  });
});
