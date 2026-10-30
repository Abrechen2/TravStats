/**
 * `?domain=cruise` on /stats/timeseries returned an all-zero series while
 * /stats/cruise counted the same voyages: the cruise loader filtered on the
 * FLIGHT predicate (flown/historical), which drops every `completed` cruise.
 */
import { countableCruiseWhere } from "../shared/cruiseCounting";

const findMany = jest.fn();
jest.mock("../db", () => ({ prisma: { cruise: { findMany: (a: unknown) => findMany(a) } } }));

import { fetchCruiseDatedRows } from "../services/stats/timeseriesRows";

describe("fetchCruiseDatedRows", () => {
  it("filters on the cruise predicate so a completed cruise is counted", async () => {
    findMany.mockResolvedValue([]);

    await fetchCruiseDatedRows("u1", new Date("2026-01-01"), new Date("2027-01-01"));

    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toEqual(countableCruiseWhere().status);
    expect(JSON.stringify(where.status)).toContain("completed");
  });
});
