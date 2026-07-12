import { resolveAirlineLogo, __resetNegativeCacheForTests } from "../airlineLogoService";
import * as cache from "../logoCache";
import * as resolver from "../../apiKeyResolver";
import logger from "../../../utils/logger";
import crypto from "crypto";

// The Daisycon "unknown airline" placeholder defeats status-based detection
// (it is served with HTTP 200) — the service must recognise it by hash.
const DAISYCON_PLACEHOLDER_MD5 = "e868e45186e3f2e758f42dcd1029da2d";

const realFetch = global.fetch;
beforeEach(() => {
  // Default: no key resolves anywhere (admin_settings nor env)
  jest.spyOn(resolver, "getApiKey").mockResolvedValue(null);
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  __resetNegativeCacheForTests();
});

function mockFetchOnce(status: number, body: Buffer, contentType: string): jest.Mock {
  const fn = jest.fn().mockResolvedValue(
    new Response(new Uint8Array(body), { status, headers: { "content-type": contentType } })
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("resolveAirlineLogo", () => {
  it("returns the disk-cache hit without any network call", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue({
      body: Buffer.from("hit"), contentType: "image/png",
    });
    const fn = jest.fn();
    global.fetch = fn as unknown as typeof fetch;
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r!.body.toString()).toBe("hit");
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses logostream when a key resolves and caches the result", async () => {
    jest.spyOn(resolver, "getApiKey").mockResolvedValue("FREE-TEST-KEY-000000");
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = mockFetchOnce(200, Buffer.from("realpng"), "image/png");
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r!.contentType).toBe("image/png");
    const requestedUrl = String(fn.mock.calls[0][0]);
    expect(requestedUrl).toContain("airlines-api.logostream.dev");
    expect(requestedUrl).toContain("key=");
    expect(put).toHaveBeenCalledWith("LH-icon", expect.objectContaining({ contentType: "image/png" }));
  });

  it("falls through to Daisycon when logostream returns the unknown-airline svg placeholder", async () => {
    jest.spyOn(resolver, "getApiKey").mockResolvedValue("FREE-TEST-KEY-000000");
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array(Buffer.from("<svg><text>Q9</text></svg>")), {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(Buffer.from("realpng")), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      );
    global.fetch = fn as unknown as typeof fetch;
    const r = await resolveAirlineLogo("Q9", "icon");
    expect(r).not.toBeNull();
    expect(r!.contentType).toBe("image/png");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(String(fn.mock.calls[0][0])).toContain("airlines-api.logostream.dev");
    expect(String(fn.mock.calls[1][0])).toContain("daisycon");
    expect(put).toHaveBeenCalledWith("Q9-icon", expect.objectContaining({ contentType: "image/png" }));
  });

  it("falls back to Daisycon without a key", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = mockFetchOnce(200, Buffer.from("realpng"), "image/png");
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r).not.toBeNull();
    expect(String(fn.mock.calls[0][0])).toContain("daisycon");
  });

  it("treats the Daisycon placeholder body as a miss", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    // Craft a body whose md5 matches the known placeholder hash by mocking crypto:
    const body = Buffer.from("placeholder-bytes");
    jest.spyOn(crypto, "createHash").mockReturnValue({
      update: () => ({ digest: () => DAISYCON_PLACEHOLDER_MD5 }),
    } as unknown as crypto.Hash);
    mockFetchOnce(200, body, "image/png");
    const r = await resolveAirlineLogo("Q9", "icon");
    expect(r).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("negative-caches misses so a second call makes no network request", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const fn = mockFetchOnce(404, Buffer.alloc(0), "text/plain");
    expect(await resolveAirlineLogo("ZZ", "icon")).toBeNull();
    const calls = fn.mock.calls.length;
    expect(await resolveAirlineLogo("ZZ", "icon")).toBeNull();
    expect(fn.mock.calls.length).toBe(calls); // no additional fetches
  });

  it("never logs the raw API key when a fetch fails", async () => {
    const FAKE_KEY = "FREE-TEST-KEY-000000";
    jest.spyOn(resolver, "getApiKey").mockResolvedValue(FAKE_KEY);
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined as unknown as void);
    // Simulate an error message that embeds the key (simulating a future fetch implementation detail)
    global.fetch = jest.fn().mockRejectedValue(
      new Error(`request to https://airlines-api.logostream.dev/airlines/iata/LH?variant=icon&key=${FAKE_KEY} failed`)
    ) as unknown as typeof fetch;

    const r = await resolveAirlineLogo("LH", "icon");

    expect(r).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const loggedPayload = JSON.stringify(warnSpy.mock.calls);
    expect(loggedPayload).not.toContain(FAKE_KEY);
    expect(loggedPayload).toContain("key=***");
  });
});
