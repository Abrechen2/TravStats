import { jest } from "@jest/globals";
import axios from "axios";

import {
  FETCH_DEADLINE_MS,
  MAX_TOTAL_POINTS,
  MAX_WINDOW_MS,
  fetchReceiverTrack,
  type Receiver,
} from "../receiverFetch";
import { DAY_START_S, cruiseRows, traceFile } from "./traceFixtures";

/** The bounds of one own-receiver fetch: window, bytes, points, deadline. axios is spied. */
const receiver: Receiver = { baseUrl: "https://tar.example.org", policy: { allowPrivate: false } };
const FROM = DAY_START_S * 1000;
const HOUR = 3_600_000;

describe("fetchReceiverTrack bounds", () => {
  let getSpy: jest.SpiedFunction<typeof axios.get>;
  beforeEach(() => {
    getSpy = jest.spyOn(axios, "get");
  });
  afterEach(() => {
    getSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("refuses a window longer than a flight before any request", async () => {
    for (const to of [FROM + MAX_WINDOW_MS + 1, FROM + 400 * 86_400_000, FROM - HOUR]) {
      expect(await fetchReceiverTrack(receiver, "3c6444", FROM, to)).toEqual({
        ok: false,
        reason: "window_too_long",
      });
    }
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("still fetches a window of exactly the limit, at most three days of files", async () => {
    getSpy.mockResolvedValue({ status: 404, data: "", headers: {} } as never);
    await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + MAX_WINDOW_MS);
    expect(getSpy.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it("reports an oversized file as too_large", async () => {
    getSpy.mockRejectedValue(new Error("maxContentLength size of 31457280 exceeded"));
    expect(await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + HOUR)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("stops when the fixes together exceed the point budget", async () => {
    const rows = Array.from({ length: MAX_TOTAL_POINTS + 1 }, (_, i) => [
      i,
      50,
      8,
      30_000,
      400,
      90,
      0,
    ]);
    getSpy.mockResolvedValue({ status: 200, data: traceFile(rows), headers: {} } as never);
    expect(await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + HOUR)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("gives up as a timeout once the overall deadline has passed, with no further request", async () => {
    const start = Date.now();
    let now = start;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    getSpy.mockImplementation((async () => {
      now += FETCH_DEADLINE_MS + 1; // the first file was slow
      return { status: 404, data: "", headers: {} };
    }) as never);
    const result = await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + 30 * HOUR);
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
