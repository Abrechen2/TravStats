import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../client";
import { sharingRemoteApi } from "../sharingRemote";

/**
 * The browser must not give up before the server (rc.19 review). A call that reaches another
 * server costs this server up to 10 s per exchange: a claim pings and then redeems, an offer
 * pings and then sends on the stream, which may send once more after a gap. With the 10 s
 * default the UI reported a failure while the server succeeded, and a retry then said the code
 * was already used.
 */
const SERVER_EXCHANGES_MS = 3 * 10_000;

const timeoutOf = (config: unknown) => (config as { timeout?: number } | undefined)?.timeout ?? 0;

describe("cross-server sharing calls wait for the server's own exchanges", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["claim", () => sharingRemoteApi.claim("code")],
    ["offerTrip", () => sharingRemoteApi.offerTrip("t1", "r1")],
    ["acceptOffer", () => sharingRemoteApi.acceptOffer("o1")],
    ["declineOffer", () => sharingRemoteApi.declineOffer("o1")],
    [
      "requestAddition",
      () => sharingRemoteApi.requestAddition("t1", { displayName: "Dora" } as never),
    ],
  ])("%s", async (_name, call) => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { data: {} } } as never);
    await call();
    expect(timeoutOf(post.mock.calls[0][2])).toBeGreaterThan(SERVER_EXCHANGES_MS);
  });
});
