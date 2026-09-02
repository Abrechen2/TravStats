/**
 * The record against itself — the one check with no third party in it.
 */
import { describe, it, expect } from "@jest/globals";

import { findReversedStayDates } from "../checks/stayDatesReversed";

describe("findReversedStayDates", () => {
  it("flags a stay whose check-out precedes its check-in", () => {
    const findings = findReversedStayDates([
      {
        id: "l1",
        stays: [{ id: "s1", checkIn: new Date("2024-09-03"), checkOut: new Date("2024-03-09") }],
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "lodging",
      entityId: "l1",
      kind: "stay_dates_reversed",
    });
    expect(findings[0].details).toEqual({
      stays: [
        {
          stayId: "s1",
          checkIn: "2024-09-03T00:00:00.000Z",
          checkOut: "2024-03-09T00:00:00.000Z",
        },
      ],
    });
  });

  it("raises one flag per lodging, listing every offending stay", () => {
    // The subject the user can act on is the house — that is the page with the
    // stay editor on it. Two bad stays are one question, not two.
    const findings = findReversedStayDates([
      {
        id: "l1",
        stays: [
          { id: "s1", checkIn: new Date("2024-09-03"), checkOut: new Date("2024-03-09") },
          { id: "s2", checkIn: new Date("2023-01-02"), checkOut: new Date("2023-01-05") },
          { id: "s3", checkIn: new Date("2022-07-10"), checkOut: new Date("2022-07-01") },
        ],
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(
      (findings[0].details as { stays: { stayId: string }[] }).stays.map((s) => s.stayId)
    ).toEqual(["s1", "s3"]);
  });

  it("does not flag a same-day stay", () => {
    // A day room, or a stay that fell through. Real, and not a contradiction.
    expect(
      findReversedStayDates([
        {
          id: "l1",
          stays: [{ id: "s1", checkIn: new Date("2024-05-01"), checkOut: new Date("2024-05-01") }],
        },
      ])
    ).toEqual([]);
  });

  it("does not flag a stay that carries no dates", () => {
    // "I remember the hotel, not the week" — a gap, not a disagreement.
    expect(
      findReversedStayDates([
        {
          id: "l1",
          stays: [
            { id: "s1", checkIn: null, checkOut: null },
            { id: "s2", checkIn: new Date("2024-05-01"), checkOut: null },
          ],
        },
      ])
    ).toEqual([]);
  });
});
