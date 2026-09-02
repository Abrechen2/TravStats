/**
 * The import seam: an import runs the checks, and an import survives them.
 *
 * The second half is the one worth the machinery. `runDataQualityChecks` reads
 * the account's whole lodging, place, flight and port-call set — plenty of
 * surface to throw on — and it is fired from a route that has already written
 * the user's rows. A plausibility check must never be able to turn a completed
 * import into a 500.
 */
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A deferred the test can await, so a DETACHED trigger can still be asserted
 * on. Polling for it would either be flaky or slow; this resolves the moment
 * the route's fire-and-forget actually reaches the runner.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let called = deferred<string>();
let behaviour: "ok" | "throw" = "ok";

jest.mock("../../services/dataQuality", () => ({
  runDataQualityChecks: jest.fn(async (userId: string) => {
    called.resolve(userId);
    if (behaviour === "throw") throw new Error("snapshot blew up");
    return { opened: 0, reopened: 0, updated: 0, autoResolved: 0, open: 0 };
  }),
}));

// The commit route fires this too, and the data-quality trigger is chained
// onto it — a real geocoder in a route test would be a network call per row.
jest.mock("../../services/lodging/geocodeBackfill", () => ({
  backfillLodgingLocations: async () => ({
    coordinates: { attempted: 0, filled: 0 },
    addresses: { attempted: 0, filled: 0 },
  }),
}));

jest.mock("../../services/fx/resolver", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
    source: "ecb" as const,
  })),
  resolveRate: jest.fn(async () => ({ rate: 1, source: "ecb" as const })),
}));

describe("data-quality checks after an import", () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-import-trigger-${Date.now()}`,
        passwordHash: await hashPassword("pw123456"),
      },
    });
    userId = user.id;
    token = generateToken(user.id);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    called = deferred<string>();
    behaviour = "ok";
  });

  it("runs the checks for the importing user after a POI import", async () => {
    const res = await request(app)
      .post("/api/v1/place-import/commit")
      .set("Cookie", [`auth_token=${token}`])
      .send({
        source: "csv",
        fileName: "poi.csv",
        rows: [
          {
            sourceRowIndex: 0,
            name: "Hotel Sport",
            lat: 44.43,
            lon: 26.1,
            address: "Grajska cesta 2, Otočec, Slovenia",
            country: "Romania",
            externalRef: `csv:dq-trigger-${Date.now()}`,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    await expect(called.promise).resolves.toBe(userId);
  });

  /**
   * The whole reason `triggerDataQualityChecks` swallows. Without it this
   * request is a 201 whose detached promise rejects — which in production is an
   * unhandled rejection, not a quiet log line.
   */
  it("still completes the import when the checks throw", async () => {
    behaviour = "throw";

    const res = await request(app)
      .post("/api/v1/place-import/commit")
      .set("Cookie", [`auth_token=${token}`])
      .send({
        source: "csv",
        fileName: "poi.csv",
        rows: [
          {
            sourceRowIndex: 0,
            name: "Trattoria da Enzo",
            lat: 41.89,
            lon: 12.47,
            externalRef: `csv:dq-trigger-throw-${Date.now()}`,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    await expect(called.promise).resolves.toBe(userId);
    // The row is there, and it is there despite the check having thrown.
    expect(await prisma.place.count({ where: { userId, name: "Trattoria da Enzo" } })).toBe(1);
  });

  it("runs the checks after a lodging import, once the geocode backfill is done", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", [`auth_token=${token}`])
      .send({
        source: "csv",
        fileName: "hotels.csv",
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            lodging: {
              name: "Hotel Otočec",
              address: "Grajska cesta 2, Otočec, Slovenia",
              country: "Romania",
            },
            stay: null,
          },
        ],
      });

    expect(res.status).toBe(201);
    await expect(called.promise).resolves.toBe(userId);
  });

  it("does not run the checks for an import that wrote nothing", async () => {
    const res = await request(app)
      .post("/api/v1/place-import/commit")
      .set("Cookie", [`auth_token=${token}`])
      .send({ source: "csv", fileName: "empty.csv", rows: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(0);
    // Nothing resolves the deferred, so a short race against a timer is the
    // only way to assert an absence here.
    const settled = await Promise.race([
      called.promise,
      new Promise((resolve) => setTimeout(() => resolve("not called"), 150)),
    ]);
    expect(settled).toBe("not called");
  });
});
