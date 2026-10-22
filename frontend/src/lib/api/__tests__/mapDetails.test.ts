import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../client", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));

import { __clearMapDetailsCaches, getStopInfo, getSubjectImage } from "../mapDetails";

/**
 * The map-details client caches per page load — but only answers. "Could not
 * ask" (Wikimedia down, our own request failed) must reach the card as itself
 * and be asked again on the next view, never remembered as "no picture".
 */

const MISS = { available: false, pending: false, unavailable: false, credit: null };
const OFF = { available: false, pending: false, unavailable: false, disabled: true, credit: null };
const DOWN = { available: false, pending: false, unavailable: true, credit: null };

beforeEach(() => {
  get.mockReset();
  __clearMapDetailsCaches();
});

describe("getSubjectImage", () => {
  it("reports a Wikimedia outage as unavailable and asks again on the next view", async () => {
    get.mockResolvedValueOnce({ data: { success: true, data: DOWN } });
    get.mockResolvedValueOnce({ data: { success: true, data: MISS } });
    expect(await getSubjectImage("vessel", "Color Fantasy")).toMatchObject({ unavailable: true });
    expect(await getSubjectImage("vessel", "Color Fantasy")).toMatchObject({
      available: false,
      unavailable: false,
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reports a failed request as unavailable, not as no picture, and does not cache it", async () => {
    get.mockRejectedValueOnce(new Error("timeout of 10000ms exceeded"));
    get.mockResolvedValueOnce({ data: { success: true, data: MISS } });
    expect(await getSubjectImage("vessel", "Color Fantasy")).toMatchObject({
      available: false,
      unavailable: true,
    });
    await getSubjectImage("vessel", "Color Fantasy");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("remembers a genuine miss for the page load", async () => {
    get.mockResolvedValue({ data: { success: true, data: MISS } });
    await getSubjectImage("vessel", "Color Fantasy");
    await getSubjectImage("vessel", "Color Fantasy");
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("switch-dependent answers", () => {
  it("does not remember a picture answer given while the open-data switch was off", async () => {
    get.mockResolvedValueOnce({ data: { success: true, data: OFF } });
    get.mockResolvedValueOnce({
      data: { success: true, data: { available: true, pending: false, credit: null } },
    });
    expect(await getSubjectImage("vessel", "Color Fantasy")).toMatchObject({ disabled: true });
    // The admin switched it on: the same page load asks again.
    expect(await getSubjectImage("vessel", "Color Fantasy")).toMatchObject({ available: true });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not remember a station answered 409 while the switch was off", async () => {
    const stop = { name: "Kiel", lat: 54.3, lon: 10.1 };
    get.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 409"), {
        isAxiosError: true,
        response: { status: 409, data: { success: false, error: "openDataDisabled" } },
      })
    );
    get.mockResolvedValueOnce({
      data: { success: true, data: { summary: null, unavailable: false, reason: null } },
    });
    expect(await getStopInfo("ferry", stop, "de")).toEqual({ state: "disabled" });
    expect(await getStopInfo("ferry", stop, "de")).toEqual({ state: "none" });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
