import {
  resolveAirlineLogo,
  refreshLogo,
  __resetNegativeCacheForTests,
  __flushRefreshesForTests,
  __resetInFlightForTests,
  LOGO_MAX_AGE_MS,
} from "../airlineLogoService";
import * as cache from "../logoCache";
import { getCachedLogoEntry, putCachedLogo, isStale, logoCacheDir } from "../logoCache";
import * as resolver from "../../apiKeyResolver";
import logger from "../../../utils/logger";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
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
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue({
      body: Buffer.from("hit"),
      contentType: "image/png",
      // A FRESH entry: under stale-while-revalidate a STALE hit would kick a
      // background refresh (a fetch call), so the entry must be fresh to keep
      // this test's "no network call" assertion true.
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      source: "kiwi",
    });
    const fn = jest.fn();
    global.fetch = fn as unknown as typeof fetch;
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r!.body.toString()).toBe("hit");
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses logostream when a key resolves and caches the result", async () => {
    jest.spyOn(resolver, "getApiKey").mockResolvedValue("FREE-TEST-KEY-000000");
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = mockFetchOnce(200, Buffer.from("realpng"), "image/png");
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r!.contentType).toBe("image/png");
    const requestedUrl = String(fn.mock.calls[0][0]);
    expect(requestedUrl).toContain("airlines-api.logostream.dev");
    expect(requestedUrl).toContain("key=");
    expect(put).toHaveBeenCalledWith(
      "LH-icon",
      expect.objectContaining({ contentType: "image/png" }),
      "logostream"
    );
  });

  it("falls through to Daisycon when logostream returns the unknown-airline svg placeholder", async () => {
    jest.spyOn(resolver, "getApiKey").mockResolvedValue("FREE-TEST-KEY-000000");
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
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
    expect(put).toHaveBeenCalledWith(
      "Q9-icon",
      expect.objectContaining({ contentType: "image/png" }),
      "daisycon"
    );
  });

  /**
   * The keyless default. An instance with no API key must not reach out to
   * anyone for an airline the vendored snapshot holds — no logostream call
   * (there is no key), and no Daisycon call either. This is the whole point of
   * the tier: 86 % of flights resolve without leaving the machine.
   */
  it("serves a covered airline from the vendored snapshot without any network call", async () => {
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = jest.fn();
    global.fetch = fn as unknown as typeof fetch;

    const r = await resolveAirlineLogo("LH", "icon");

    expect(r).not.toBeNull();
    expect(r!.contentType).toBe("image/svg+xml");
    expect(fn).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith(
      "LH-icon",
      expect.objectContaining({ contentType: "image/svg+xml" }),
      "vendored"
    );
  });

  /**
   * ...but the snapshot is only 93 airlines. Anything it does not hold must
   * still fall through to the tail net rather than 404. American Airlines is a
   * real gap (12 flights in the production data) — and also a gap for this
   * test's kiwi mock (404), so the request keeps falling through to Daisycon.
   */
  it("falls through to Daisycon for an airline the snapshot does not hold", async () => {
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
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
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
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
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
    const fn = mockFetchOnce(404, Buffer.alloc(0), "text/plain");
    expect(await resolveAirlineLogo("ZZ", "icon")).toBeNull();
    const calls = fn.mock.calls.length;
    expect(await resolveAirlineLogo("ZZ", "icon")).toBeNull();
    expect(fn.mock.calls.length).toBe(calls); // no additional fetches
  });

  it("never logs the raw API key when a fetch fails", async () => {
    const FAKE_KEY = "FREE-TEST-KEY-000000";
    jest.spyOn(resolver, "getApiKey").mockResolvedValue(FAKE_KEY);
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
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
    jest.spyOn(cache, "getCachedLogoEntry").mockResolvedValue(null);
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

describe("stale-while-revalidate", () => {
  const OLD = Buffer.from("old-bytes");
  const NEW = Buffer.from("new-bytes");
  const DAY = 24 * 60 * 60 * 1000;

  // This block exercises the REAL disk cache (real putCachedLogo, real
  // getCachedLogoEntry) — mocking it would just re-test the mock. Only
  // `fetch` and `getApiKey` (stubbed null by the top-level beforeEach) are
  // faked.
  beforeEach(async () => {
    await fsp.rm(logoCacheDir(), { recursive: true, force: true });
    // A never-resolving mocked upstream (below) leaves a permanently-pending
    // entry in the module-level in-flight map; without this reset every
    // later flushRefreshes() in this file would hang on that stale promise.
    __resetInFlightForTests();
  });

  async function ageEntry(key: string, ms: number): Promise<void> {
    const file = path.join(logoCacheDir(), `${key}.meta.json`);
    const raw = JSON.parse(await fsp.readFile(file, "utf-8")) as Record<string, unknown>;
    const past = Date.now() - ms;
    await fsp.writeFile(file, JSON.stringify({ ...raw, fetchedAt: past, lastAttemptAt: past }));
  }

  async function flushRefreshes(): Promise<void> {
    await __flushRefreshesForTests();
  }

  function mockFetchOnce(opts: { url: RegExp; body: Buffer; contentType: string }): jest.Mock {
    const fn = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      if (opts.url.test(String(input))) {
        return Promise.resolve(
          new Response(new Uint8Array(opts.body), {
            status: 200,
            headers: { "content-type": opts.contentType },
          })
        );
      }
      return Promise.resolve(new Response(new Uint8Array(), { status: 404 }));
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  function mockFetchNeverResolves(urlRe: RegExp): jest.Mock {
    const fn = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      if (urlRe.test(String(input))) return new Promise<Response>(() => undefined);
      return Promise.resolve(new Response(new Uint8Array(), { status: 404 }));
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  function mockFetchAllFail(): jest.Mock {
    const fn = jest.fn().mockResolvedValue(new Response(new Uint8Array(), { status: 404 }));
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  // The background refresh is a fire-and-forget `void refreshLogo(...)`: it
  // is kicked off but not awaited, so resolveAirlineLogo's own promise can
  // settle (and hand control back to the test) via a SHORTER microtask chain
  // than the refresh needs to reach its actual fetch() call (getApiKey ->
  // fromLogostream -> fetchFromChain -> getVendoredLogo -> fromKiwi ->
  // fetchImage). Without a tick to let that chain finish unwinding, the
  // "was the network reached" assertion can run before it has been.
  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it("serves a stale entry immediately and does not block on the network", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY); // helper: rewrite fetchedAt
    const slow = mockFetchNeverResolves(/kiwi/); // upstream hangs

    const logo = await resolveAirlineLogo("LH", "logo");
    await flushMicrotasks();

    expect(logo?.body).toEqual(OLD); // served from cache, at once
    expect(slow).toHaveBeenCalled(); // refresh WAS kicked off
  });

  it("a fresh entry triggers no refresh at all", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    const spy = mockFetchOnce({ url: /kiwi/, body: NEW, contentType: "image/png" });
    await resolveAirlineLogo("LH", "logo");
    expect(spy).not.toHaveBeenCalled();
  });

  it("the next request gets the refreshed bytes", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);
    mockFetchOnce({ url: /kiwi/, body: NEW, contentType: "image/png" });

    await resolveAirlineLogo("LH", "logo"); // serves OLD, refreshes behind it
    await flushRefreshes(); // helper: await the in-flight refresh

    const second = await resolveAirlineLogo("LH", "logo");
    expect(second?.body).toEqual(NEW);
  });

  it("a failed refresh keeps the old bytes and leaves the entry stale", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);
    mockFetchAllFail();

    const logo = await resolveAirlineLogo("LH", "logo");
    await flushRefreshes();

    expect(logo?.body).toEqual(OLD);
    const entry = (await getCachedLogoEntry("LH-logo"))!;
    expect(entry.body).toEqual(OLD);
    expect(isStale(entry, LOGO_MAX_AGE_MS)).toBe(true); // still due for retry
  });

  it("coalesces concurrent refreshes of the same key into one", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);
    const spy = mockFetchOnce({ url: /kiwi/, body: NEW, contentType: "image/png" });

    await Promise.all([
      resolveAirlineLogo("LH", "logo"),
      resolveAirlineLogo("LH", "logo"),
      resolveAirlineLogo("LH", "logo"),
    ]);
    await flushRefreshes();

    expect(spy).toHaveBeenCalledTimes(1); // a table of 200 rows must not fan out
  });

  /**
   * refreshLogo re-derives {code, variant} from the cache key using the FIRST
   * hyphen. "logo-white" itself contains a hyphen, so a naive lastIndexOf
   * split would mis-parse "ZZ-logo-white" into code "ZZ-logo", variant
   * "white" — and then ask logostream/kiwi/Daisycon for an airline called
   * "ZZ-logo", which can never exist. ZZ (not a real airline) is used rather
   * than the brief's illustrative BA so the vendored tier — which DOES ship a
   * "logo-white" (icon-mono.svg) asset for British Airways — cannot answer
   * first and hide the bug this test targets; the request must fall through
   * to kiwi to prove the split.
   */
  it("round-trips a logo-white key through refreshLogo using the right code", async () => {
    await putCachedLogo("ZZ-logo-white", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("ZZ-logo-white", 40 * DAY);
    const spy = mockFetchOnce({ url: /images\.kiwi\.com/, body: NEW, contentType: "image/png" });

    await resolveAirlineLogo("ZZ", "logo-white");
    await flushRefreshes();

    expect(spy).toHaveBeenCalled();
    const requestedUrl = String(spy.mock.calls[0][0]);
    // kiwi's URL embeds the CODE only ("/airlines/128/ZZ.png") — if the split
    // had mis-parsed the key, this would read ".../ZZ-logo.png" instead.
    expect(requestedUrl).toContain("/ZZ.png");
    expect(requestedUrl).not.toContain("ZZ-logo");

    const entry = (await getCachedLogoEntry("ZZ-logo-white"))!;
    expect(entry.body).toEqual(NEW);
  });
});

describe("refreshLogo", () => {
  afterEach(async () => {
    await fsp.rm(logoCacheDir(), { recursive: true, force: true });
  });

  it("is exported directly and can be invoked standalone", async () => {
    await putCachedLogo("LH-logo", { body: Buffer.from("old"), contentType: "image/png" }, "kiwi");
    jest.spyOn(resolver, "getApiKey").mockResolvedValue(null);
    const fn = jest.fn().mockResolvedValue(
      new Response(new Uint8Array(Buffer.from("new")), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );
    global.fetch = fn as unknown as typeof fetch;

    const changed = await refreshLogo("LH-logo");

    expect(changed).toBe(true);
    const entry = (await getCachedLogoEntry("LH-logo"))!;
    expect(entry.body.toString()).toBe("new");
  });
});
