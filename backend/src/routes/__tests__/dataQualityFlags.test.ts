/**
 * Who may read the inbox, and who may answer it.
 *
 * The equivalent of `__tests__/pendingUpdates.scope.test.ts` for the second
 * inbox, plus the leak test that one implies. The stakes are higher here than
 * for a row id: a flag names somebody's hotel and the country they were in, so
 * a missing `userId` in a WHERE clause leaks a place a stranger has been —
 * which is the whole reason `resolveFlag`/`dismissFlag` scope with
 * `updateMany` instead of reading the row first and trusting it.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  securityLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/jwtSecret", () => ({ JWT_SECRET: "test-secret" }));

const flagFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>(async () => []);
const flagUpdateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({
  count: 0,
}));
const lodgingFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>(async () => []);
const placeFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>(async () => []);

jest.mock("../../db", () => ({
  prisma: {
    dataQualityFlag: {
      findMany: (args: unknown) => flagFindMany(args),
      updateMany: (args: unknown) => flagUpdateMany(args),
    },
    lodging: { findMany: (args: unknown) => lodgingFindMany(args) },
    place: { findMany: (args: unknown) => placeFindMany(args) },
  },
}));

// The run endpoint's own behaviour is pinned in services/dataQuality; here it
// exists only to be refused a read-scoped token.
jest.mock("../../services/dataQuality/runner", () => ({
  runDataQualityChecks: jest.fn(async () => ({
    opened: 0,
    reopened: 0,
    updated: 0,
    autoResolved: 0,
    open: 0,
  })),
}));

// authenticate is mocked to inject the PAT under test; requireWriteScope stays
// REAL — that is the guard this suite pins.
let mockScope: "read" | "write" = "read";
jest.mock("../../middleware/auth", () => {
  const actual =
    jest.requireActual<typeof import("../../middleware/auth")>("../../middleware/auth");
  return {
    ...actual,
    authenticate: (req: unknown, _res: unknown, next: () => void) => {
      const r = req as express.Request & {
        userId?: string;
        apiToken?: { id: string; scope: string };
      };
      r.userId = "u1";
      r.apiToken = { id: "tok-1", scope: mockScope };
      next();
    },
  };
});

import dataQualityFlagsRouter from "../dataQualityFlags";
import { errorHandler } from "../../middleware/errorHandler";

const FLAG_ID = "11111111-1111-4111-8111-111111111111";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/data-quality-flags", dataQualityFlagsRouter);
  app.use(errorHandler);
  return app;
}

const storedFlag = (over: Record<string, unknown> = {}) => ({
  id: FLAG_ID,
  userId: "u1",
  entityType: "lodging",
  entityId: "l1",
  kind: "address_country_mismatch",
  status: "open",
  details: {
    claimedCountryCode: "RO",
    claimedCountryText: "Romania",
    addressCountryCode: "SI",
    addressCountryText: "Slovenia",
    address: "Grajska cesta 2, 8222 Otočec, Slovenia",
  },
  createdAt: new Date("2026-09-02T10:00:00.000Z"),
  resolvedAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  flagFindMany.mockResolvedValue([]);
  flagUpdateMany.mockResolvedValue({ count: 0 });
  lodgingFindMany.mockResolvedValue([]);
  placeFindMany.mockResolvedValue([]);
});

describe("data-quality-flags write scope", () => {
  it("rejects resolve and dismiss for a read-scoped PAT with 403", async () => {
    mockScope = "read";
    const app = makeApp();
    expect((await request(app).post(`/api/v1/data-quality-flags/${FLAG_ID}/resolve`)).status).toBe(
      403
    );
    expect((await request(app).post(`/api/v1/data-quality-flags/${FLAG_ID}/dismiss`)).status).toBe(
      403
    );
  });

  it("rejects a re-run for a read-scoped PAT", async () => {
    // The run WRITES rows, so it is not a read even though it changes no
    // record of the user's own.
    mockScope = "read";
    expect((await request(makeApp()).post("/api/v1/data-quality-flags/run")).status).toBe(403);
  });

  it("keeps read access for a read-scoped PAT", async () => {
    mockScope = "read";
    const res = await request(makeApp()).get("/api/v1/data-quality-flags");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: [], count: 0 });
  });
});

describe("data-quality-flags ownership", () => {
  beforeEach(() => {
    mockScope = "write";
  });

  it("scopes the list to the calling user", async () => {
    flagFindMany.mockResolvedValue([storedFlag()]);
    lodgingFindMany.mockResolvedValue([{ id: "l1", name: "Hotel Sport" }]);

    const res = await request(makeApp()).get("/api/v1/data-quality-flags");

    expect(res.status).toBe(200);
    expect(flagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1", status: "open" }) })
    );
    // The subject travels with the flag, so the inbox can name and link the
    // record without a second request (design §3.4).
    expect(res.body.flags[0].subject).toEqual({
      entityType: "lodging",
      entityId: "l1",
      label: "Hotel Sport",
    });
  });

  it("looks the subject up under the calling user too", async () => {
    // A flag row carries an entityId with no foreign key behind it. Reading the
    // lodging without `userId` would turn a forged flag row into a way of
    // reading another account's hotel names.
    flagFindMany.mockResolvedValue([storedFlag()]);
    lodgingFindMany.mockResolvedValue([{ id: "l1", name: "Hotel Sport" }]);

    await request(makeApp()).get("/api/v1/data-quality-flags");

    expect(lodgingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) })
    );
  });

  it("drops a flag whose record has been deleted", async () => {
    flagFindMany.mockResolvedValue([storedFlag()]);
    lodgingFindMany.mockResolvedValue([]);

    const res = await request(makeApp()).get("/api/v1/data-quality-flags");

    expect(res.body).toEqual({ flags: [], count: 0 });
  });

  it("returns a country flag without needing a row behind it", async () => {
    flagFindMany.mockResolvedValue([
      storedFlag({
        entityType: "country",
        entityId: "SI",
        kind: "undated_country_evidence",
        details: { countryCode: "SI", records: [] },
      }),
    ]);

    const res = await request(makeApp()).get("/api/v1/data-quality-flags");

    expect(res.body.count).toBe(1);
    // The code, and no `label`. A label is display text the user wrote; a
    // country's name is localised in the browser, so the server has none to
    // send and does not pretend otherwise by putting the code there.
    expect(res.body.flags[0].subject).toEqual({ entityType: "country", countryCode: "SI" });
  });

  it("drops a flag whose details do not match its kind", async () => {
    // `kind` and `details` are two columns and this is where they are checked
    // against EACH OTHER. Before that check the row was served as-is and every
    // consumer had to re-derive the pairing at runtime to stay safe.
    flagFindMany.mockResolvedValue([
      storedFlag({ kind: "stay_dates_reversed", details: { countryCode: "SI", records: [] } }),
    ]);
    lodgingFindMany.mockResolvedValue([{ id: "l1", name: "Hotel Sport" }]);

    const res = await request(makeApp()).get("/api/v1/data-quality-flags");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: [], count: 0 });
  });

  it("resolves only a flag that belongs to the caller", async () => {
    flagUpdateMany.mockResolvedValue({ count: 1 });

    const res = await request(makeApp()).post(`/api/v1/data-quality-flags/${FLAG_ID}/resolve`);

    expect(res.status).toBe(200);
    expect(flagUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FLAG_ID, userId: "u1" } })
    );
  });

  it("answers 404 for another user's flag, indistinguishably from a missing one", async () => {
    // count 0 is what a foreign id produces, because `userId` is in the WHERE.
    flagUpdateMany.mockResolvedValue({ count: 0 });

    const res = await request(makeApp()).post(`/api/v1/data-quality-flags/${FLAG_ID}/dismiss`);

    expect(res.status).toBe(404);
    expect(flagUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FLAG_ID, userId: "u1" } })
    );
  });

  it("rejects an id that is not a uuid with 400", async () => {
    const res = await request(makeApp()).post("/api/v1/data-quality-flags/not-a-uuid/resolve");

    expect(res.status).toBe(400);
    expect(flagUpdateMany).not.toHaveBeenCalled();
  });
});
