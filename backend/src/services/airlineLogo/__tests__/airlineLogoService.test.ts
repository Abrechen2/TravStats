import { resolveAirlineLogo, __resetNegativeCacheForTests } from "../airlineLogoService";
import * as cache from "../logoCache";
import * as resolver from "../../apiKeyResolver";
import logger from "../../../utils/logger";
import crypto from "crypto";
import fs from "fs";
import path from "path";

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
      // kiwi tier: Q9 is not an airline kiwi knows, so this is a miss too.
      .mockResolvedValueOnce(new Response(new Uint8Array(), { status: 404 }))
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
    expect(fn).toHaveBeenCalledTimes(3);
    expect(String(fn.mock.calls[0][0])).toContain("airlines-api.logostream.dev");
    expect(String(fn.mock.calls[1][0])).toContain("images.kiwi.com");
    expect(String(fn.mock.calls[2][0])).toContain("daisycon");
    expect(put).toHaveBeenCalledWith("Q9-icon", expect.objectContaining({ contentType: "image/png" }));
  });

  /**
   * The keyless default. An instance with no API key must not reach out to
   * anyone for an airline the vendored snapshot holds — no logostream call
   * (there is no key), and no Daisycon call either. This is the whole point of
   * the tier: 86 % of flights resolve without leaving the machine.
   */
  it("serves a covered airline from the vendored snapshot without any network call", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = jest.fn();
    global.fetch = fn as unknown as typeof fetch;

    const r = await resolveAirlineLogo("LH", "icon");

    expect(r).not.toBeNull();
    expect(r!.contentType).toBe("image/svg+xml");
    expect(fn).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith("LH-icon", expect.objectContaining({ contentType: "image/svg+xml" }));
  });

  /**
   * ...but the snapshot is only 93 airlines. Anything it does not hold must
   * still fall through to the tail net rather than 404. American Airlines is a
   * real gap (12 flights in the production data) — and also a gap for this
   * test's kiwi mock (404), so the request keeps falling through to Daisycon.
   */
  it("falls through to Daisycon for an airline the snapshot does not hold", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = jest
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(), { status: 404 })) // kiwi miss
      .mockResolvedValueOnce(
        new Response(new Uint8Array(Buffer.from("realpng")), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      );
    global.fetch = fn as unknown as typeof fetch;
    const r = await resolveAirlineLogo("AA", "icon");
    expect(r).not.toBeNull();
    expect(String(fn.mock.calls[0][0])).toContain("images.kiwi.com");
    expect(String(fn.mock.calls[1][0])).toContain("daisycon");
  });

  it("treats the Daisycon placeholder body as a miss", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    // Craft a body whose md5 matches the known placeholder hash by mocking crypto:
    const body = Buffer.from("placeholder-bytes");
    jest.spyOn(crypto, "createHash").mockReturnValue({
      update: () => ({ digest: () => DAISYCON_PLACEHOLDER_MD5 }),
    } as unknown as crypto.Hash);
    const fn = jest
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(), { status: 404 })) // kiwi miss
      .mockResolvedValueOnce(
        new Response(new Uint8Array(body), { status: 200, headers: { "content-type": "image/png" } })
      );
    global.fetch = fn as unknown as typeof fetch;
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
      new Error(`request to https://airlines-api.logostream.dev/airlines/iata/AA?variant=icon&key=${FAKE_KEY} failed`)
    ) as unknown as typeof fetch;

    // Deliberately an airline the vendored snapshot does NOT hold, so the whole
    // chain still ends in a miss and the assertion below is about the log, not
    // about a tier accidentally rescuing the request.
    const r = await resolveAirlineLogo("AA", "icon");

    expect(r).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const logObj = warnSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logObj).not.toHaveProperty("error");
    expect(String(logObj.message)).toContain("key=***");
    expect(String(logObj.message)).not.toContain(FAKE_KEY);
    expect(String(logObj.url)).not.toContain(FAKE_KEY);
  });
});

describe("kiwi tier", () => {
  const REAL_PNG = Buffer.from("89504e470d0a1a0a-real-logo-bytes", "utf-8");

  // The actual bytes kiwi returns for an unknown code (fetched from
  // images.kiwi.com/airlines/128/ZZ.png on 2026-07-14). Using the real image —
  // rather than a stub whose hash we inject into the guard set — means this
  // test also proves the KIWI_PLACEHOLDER_MD5S constant itself is correct. If
  // kiwi ever changes the placeholder, this test fails and tells us to
  // re-vendor it, which is exactly the signal we want.
  function placeholderBytes(): Buffer {
    return fs.readFileSync(path.join(__dirname, "fixtures", "kiwi-placeholder-128.png"));
  }

  function mockSequentialFetch(
    ...responses: Array<{ status: number; body: Buffer; contentType: string }>
  ): jest.Mock {
    const fn = jest.fn();
    for (const response of responses) {
      fn.mockResolvedValueOnce(
        new Response(new Uint8Array(response.body), {
          status: response.status,
          headers: { "content-type": response.contentType },
        })
      );
    }
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  beforeEach(() => {
    __resetNegativeCacheForTests();
    // The top-level beforeEach (above) already stubs getApiKey to resolve
    // null and the top-level afterEach already restores all mocks after
    // every test, so re-declaring those here would only reorder them ahead
    // of that stub within a single test's setup — re-mock the cache only.
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
  });

  it("returns the bytes for an airline kiwi knows", async () => {
    // Delta is one of the 10 vendored airlines whose snapshot has no
    // logo.svg (only icon.svg) — see backend/data/airline-logos/assets/
    // delta-air-lines/. That makes the vendored tier miss for the "logo"
    // variant and the request falls through to kiwi, which is what this
    // test exercises. Lufthansa (the brief's illustrative example) is NOT
    // usable here: its vendored logo.svg exists, so the vendored tier would
    // answer first and kiwi would never be reached.
    mockFetchOnce(200, REAL_PNG, "image/png");
    const logo = await resolveAirlineLogo("DL", "logo");
    expect(logo?.body).toEqual(REAL_PNG);
  });

  it("treats the placeholder as a miss and falls through to Daisycon", async () => {
    const fn = mockSequentialFetch(
      { status: 200, body: placeholderBytes(), contentType: "image/png" },
      { status: 200, body: REAL_PNG, contentType: "image/png" }
    );
    const logo = await resolveAirlineLogo("ZZ", "logo");
    expect(logo?.body).toEqual(REAL_PNG); // Daisycon answered, not kiwi
    expect(String(fn.mock.calls[0][0])).toContain("images.kiwi.com");
    expect(String(fn.mock.calls[1][0])).toContain("daisycon");
  });

  it("never returns a placeholder as if it were a logo", async () => {
    mockSequentialFetch(
      { status: 200, body: placeholderBytes(), contentType: "image/png" },
      { status: 404, body: Buffer.alloc(0), contentType: "text/plain" }
    );
    const logo = await resolveAirlineLogo("ZZ", "logo");
    expect(logo).toBeNull();
  });

  it("runs after logostream — a premium key wins", async () => {
    jest.spyOn(resolver, "getApiKey").mockResolvedValue("secret");
    const fn = mockFetchOnce(200, REAL_PNG, "image/png");
    await resolveAirlineLogo("LH", "logo");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0][0])).toContain("logostream");
  });
});
