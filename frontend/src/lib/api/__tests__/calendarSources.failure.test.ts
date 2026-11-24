import { describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("../client", () => ({ api: { post } }));

import { calendarRequestFailureKey, calendarSourcesApi } from "../calendarSources";

/**
 * UAT rc.45: a calendar test that failed read "Das hat nicht geklappt" whatever the cause. The
 * client gave up after 10 s while the server allows a calendar 20 s, so its specific reason never
 * arrived; and a request without an answer had no reason of its own.
 */
describe("calendar test failures name their cause", () => {
  it("waits longer than the server's own calendar timeout", async () => {
    post.mockResolvedValue({ data: { ok: true } });
    await calendarSourcesApi.test("s1");
    expect(post.mock.calls[0][2].timeout).toBeGreaterThan(20_000);
  });

  it.each([
    [{ isAxiosError: true, code: "ECONNABORTED" }, "calendar.failure.code.CALENDAR_TIMEOUT"],
    [{ isAxiosError: true, code: "ERR_NETWORK" }, "calendar.failure.network"],
    [{ response: { status: 429, data: {} } }, "calendar.failure.rateLimited"],
    [
      { response: { status: 400, data: { error: "unreachable" } } },
      "calendar.failure.kind.unreachable",
    ],
    [
      { response: { status: 400, data: { error: "invalidUrl", code: "PRIVATE_TARGET" } } },
      "calendar.failure.code.PRIVATE_TARGET",
    ],
  ])("%o → %s", (error, key) => {
    expect(calendarRequestFailureKey(error)).toBe(key);
  });
});
