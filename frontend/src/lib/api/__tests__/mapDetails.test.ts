import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../client", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));

import { __clearMapDetailsCaches, getSubjectImage } from "../mapDetails";

/**
 * The map-details client caches per page load — but only answers. "Could not
 * ask" (Wikimedia down, our own request failed) must reach the card as itself
 * and be asked again on the next view, never remembered as "no picture".
 */

const MISS = { available: false, pending: false, unavailable: false, credit: null };
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
