import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { mergeTrips } from "../tripCleanupService";

/**
 * Two merges of the same pair in opposite directions at once — A into B and
 * B into A, e.g. two tabs. Each used to lock only its own source trip and then
 * need the other's row: a deadlock, and Postgres aborted one of them with a
 * raw error. One must win; the other must be told the trip is gone.
 */
let arrived = 0;

jest.mock("../trip/mergeTripRelations", () => {
  const actual = jest.requireActual<typeof import("../trip/mergeTripRelations")>(
    "../trip/mergeTripRelations"
  );
  return {
    ...actual,
    // Hold each merge here until both have arrived (or a merge waits on the
    // other's lock and never will), so the two overlap inside their transactions.
    mergeImmichAlbums: async (...args: Parameters<typeof actual.mergeImmichAlbums>) => {
      arrived += 1;
      const until = Date.now() + 1000;
      while (arrived < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
      return actual.mergeImmichAlbums(...args);
    },
  };
});

const USERNAME = `merge-opposite-${Date.now()}`;

describe("trip merge — opposite merges at once", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("lets one win and tells the other its trip is gone", async () => {
    const a = await prisma.trip.create({ data: { userId, name: "A" } });
    const b = await prisma.trip.create({ data: { userId, name: "B" } });

    const results = await Promise.allSettled([
      mergeTrips(userId, { tripIds: [a.id, b.id], targetId: b.id }),
      mergeTrips(userId, { tripIds: [a.id, b.id], targetId: a.id }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(AppError);
    expect((lost[0].reason as AppError).statusCode).toBe(404);
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
  });
});
