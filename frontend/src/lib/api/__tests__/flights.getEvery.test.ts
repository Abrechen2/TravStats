import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../client", () => ({ api: { get: getMock } }));

import { flightsApi } from "../flights";

interface PageCfg {
  params: { limit: number; offset: number };
}

/**
 * SRV-EXPORT-002 (P1, beta audit 2026-09-20).
 *
 * An account with 501 flights exported an Excel file holding 500 flight rows.
 * The export asked for `limit: 5000` in one request; the server caps `limit`
 * at 500 and answers the true count in `total`, which the client discarded.
 * Nothing said a row was missing — the file simply stopped.
 *
 * The 501st flight is the whole point of the first test: an off-by-one past
 * the cap is exactly the case a "just ask for a big number" client gets
 * wrong, and it produces a file that looks complete.
 */
function pageServer(total: number): () => Promise<{ data: unknown }> {
  return (...args: unknown[]) => {
    const { limit, offset } = (args[1] as PageCfg).params;
    // The server's own cap, whatever the client asked for.
    const take = Math.min(limit, 500);
    const n = Math.max(0, Math.min(take, total - offset));
    const flights = Array.from({ length: n }, (_, i) => ({ id: `f${offset + i}` }));
    return Promise.resolve({ data: { flights, total } });
  };
}

describe("flightsApi.getEvery — the whole logbook, not the first page of it", () => {
  // A BLOCK body, deliberately. `mockReset()` returns the mock, and a
  // `beforeEach` that returns a function has handed vitest a teardown — so
  // the arrow-expression form runs the mock itself, with no arguments, after
  // every test. Any implementation that reads its request config throws
  // there, and the test is reported as failed for a reason nothing in it
  // names. (`flights.getAllGeoJSON.test.ts` has the same shape and only gets
  // away with it because its mock ignores the config.)
  beforeEach(() => {
    getMock.mockReset();
  });

  it("returns the 501st flight, which a single capped request loses", async () => {
    getMock.mockImplementation(pageServer(501));

    const flights = await flightsApi.getEvery();

    expect(flights).toHaveLength(501);
    expect(flights[500].id).toBe("f500");
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("never asks for more than the server will give, and walks the offsets", async () => {
    getMock.mockImplementation(pageServer(1200));

    await flightsApi.getEvery();

    const params = getMock.mock.calls.map((c) => (c[1] as PageCfg).params);
    expect(params.map((p) => p.offset)).toEqual([0, 500, 1000]);
    expect(params.every((p) => p.limit === 500)).toBe(true);
  });

  it("costs one request for an account that fits in a page", async () => {
    getMock.mockImplementation(pageServer(42));

    expect(await flightsApi.getEvery()).toHaveLength(42);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page even when the server's total disagrees", async () => {
    // A `total` that outruns the rows actually served would otherwise spin the
    // walk to its page cap on every export.
    getMock.mockImplementation((..._args: unknown[]) =>
      Promise.resolve({ data: { flights: [], total: 9999 } })
    );

    expect(await flightsApi.getEvery()).toEqual([]);
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});
