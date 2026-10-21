import { describe, it, expect } from "@jest/globals";
import { createMemoryTemplateCache } from "../cache";
import { validateEnvelope, type TemplateEnvelope } from "../envelope";
import { V2TemplateStore, type FetchJson } from "../loader";
import { matchOnlyRunner, type RunnerRegistry } from "../runners";
import { validTemplate } from "./fixtures";

/**
 * The v2 loader activates a template only when it validates, the app is new
 * enough, and its OWN test cases pass. Every other outcome is a named reason
 * in the status — never a silent skip, never a throw into boot.
 */
const BASE = "https://templates.example.test/main";

type Routes = Record<string, unknown>;

/** No network: each URL answers from the table, an Error value rejects, a missing URL is a 404. */
function fakeFetch(routes: Routes): FetchJson & { calls: string[] } {
  const calls: string[] = [];
  const fn = (url: string): Promise<unknown> => {
    calls.push(url);
    if (!(url in routes)) return Promise.reject(new Error(`HTTP 404 from ${url}`));
    const value = routes[url];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  return Object.assign(fn, { calls });
}

function indexFor(...templates: TemplateEnvelope[]): unknown {
  return {
    version: 2,
    templates: templates.map((t) => ({
      id: t.id,
      domain: t.domain,
      version: t.version,
      path: `${t.domain}/${t.id.split(":")[1]}.json`,
    })),
  };
}

function routesFor(...templates: TemplateEnvelope[]): Routes {
  return {
    [`${BASE}/index.json`]: indexFor(...templates),
    ...Object.fromEntries(
      templates.map((t) => [`${BASE}/${t.domain}/${t.id.split(":")[1]}.json`, t])
    ),
  };
}

function makeStore(
  routes: Routes,
  opts: { appVersion?: string; runners?: RunnerRegistry; cached?: unknown[] } = {}
) {
  const fetchJson = fakeFetch(routes);
  const cache = createMemoryTemplateCache(opts.cached ?? [], BASE);
  const store = new V2TemplateStore({
    fetchJson,
    baseUrl: BASE,
    appVersion: opts.appVersion ?? "2.7.0",
    cache,
    runners: opts.runners,
  });
  return { store, cache, fetchJson };
}

describe("v2 envelope schema", () => {
  it("accepts the fixture", () => {
    expect(validateEnvelope(validTemplate()).ok).toBe(true);
  });

  it("refuses a template without a must-decline case", () => {
    const t = validTemplate();
    const result = validateEnvelope({
      ...t,
      testCases: t.testCases.filter((c) => c.expect === "match"),
    });
    expect(result).toEqual({ ok: false, errors: ["testCases: needs a decline case"] });
  });

  it("refuses an id whose prefix is not its domain", () => {
    const result = validateEnvelope(validTemplate({ id: "rail:examplechain" }));
    expect(result.ok).toBe(false);
  });

  it("refuses a market that is not ISO alpha-2", () => {
    expect(validateEnvelope(validTemplate({ markets: ["GER"] })).ok).toBe(false);
  });
});

describe("V2TemplateStore.sync", () => {
  it("activates a valid template whose test cases pass, and caches it", async () => {
    const t = validTemplate();
    const { store, cache } = makeStore(routesFor(t));

    await expect(store.sync()).resolves.toBe(true);

    expect(store.getActive().map((x) => x.id)).toEqual(["lodging:examplechain"]);
    expect(store.getStatus()).toEqual({
      index: "available",
      ranAt: expect.any(String),
      templates: [
        {
          id: "lodging:examplechain",
          domain: "lodging",
          version: "2026.10.01",
          state: "active",
          source: "remote",
        },
      ],
    });
    expect(cache.entries.has("lodging:examplechain")).toBe(true);
  });

  it("never activates a template whose own test case fails", async () => {
    const t = validTemplate();
    // The "match" case no longer contains the anchor, so the matcher declines it.
    const broken = validTemplate({
      testCases: [
        { name: "a confirmation is read", input: "Example Hotels, booking 42", expect: "match" },
        t.testCases[1],
      ],
    });
    const { store, cache } = makeStore(routesFor(broken));

    await store.sync();

    expect(store.getActive()).toEqual([]);
    expect(store.getStatus().templates).toEqual([
      expect.objectContaining({
        id: "lodging:examplechain",
        state: "rejected",
        reason: "tests_failed",
        detail: '"a confirmation is read": expected match, got decline',
      }),
    ]);
    expect(cache.entries.size).toBe(0);
  });

  it("rejects a template of the wrong shape as invalid", async () => {
    const t = validTemplate();
    const routes = routesFor(t);
    routes[`${BASE}/lodging/examplechain.json`] = { ...t, match: { markers: [], anchors: [] } };
    const { store } = makeStore(routes);

    await store.sync();

    expect(store.getActive()).toEqual([]);
    const [entry] = store.getStatus().templates;
    expect(entry).toMatchObject({ state: "rejected", reason: "invalid" });
    expect(entry.detail).toContain("needs at least one anchor");
  });

  it("rejects a template that needs a newer app, without running it", async () => {
    const t = validTemplate({ minAppVersion: "2.8.0" });
    const { store } = makeStore(routesFor(t), { appVersion: "2.7.0" });

    await store.sync();

    expect(store.getActive()).toEqual([]);
    expect(store.getStatus().templates[0]).toMatchObject({
      state: "rejected",
      reason: "needs_newer_app",
      detail: "needs 2.8.0, this instance runs 2.7.0",
    });
  });

  it("accepts minAppVersion equal to the running version", async () => {
    const t = validTemplate({ minAppVersion: "2.7.0" });
    const { store } = makeStore(routesFor(t), { appVersion: "2.7.0" });
    await store.sync();
    expect(store.getActive()).toHaveLength(1);
  });

  it("treats a domain without a runner as invalid, never as loaded-untested", async () => {
    const t = validTemplate();
    const { store } = makeStore(routesFor(t), {
      runners: new Map([["rail", matchOnlyRunner]]),
    });

    await store.sync();

    expect(store.getActive()).toEqual([]);
    expect(store.getStatus().templates[0]).toMatchObject({
      reason: "invalid",
      detail: 'no runner for domain "lodging"',
    });
  });

  it("reports a template file that cannot be fetched as fetch_failed", async () => {
    const t = validTemplate();
    const routes = routesFor(t);
    delete routes[`${BASE}/lodging/examplechain.json`];
    const { store } = makeStore(routes);

    await store.sync();

    expect(store.getStatus().templates[0]).toMatchObject({
      state: "rejected",
      reason: "fetch_failed",
    });
  });

  it("rejects a file whose version disagrees with the index", async () => {
    const t = validTemplate();
    const routes = routesFor(t);
    routes[`${BASE}/lodging/examplechain.json`] = { ...t, version: "2026.09.01" };
    const { store } = makeStore(routes);

    await store.sync();

    expect(store.getStatus().templates[0]).toMatchObject({ reason: "invalid" });
  });

  it("keeps the active version when a newer one fails its tests", async () => {
    const good = validTemplate();
    const first = makeStore(routesFor(good));
    await first.store.sync();

    const newer = validTemplate({
      version: "2026.10.02",
      testCases: [{ name: "reads", input: "nothing relevant", expect: "match" }, good.testCases[1]],
    });
    const second = makeStore(routesFor(newer), { cached: [good] });
    second.store.loadFromCache();
    await second.store.sync();

    expect(second.store.getActive().map((x) => x.version)).toEqual(["2026.10.01"]);
    const [entry] = second.store.getStatus().templates;
    expect(entry).toMatchObject({ state: "active", version: "2026.10.01", source: "cached" });
    expect(entry.detail).toContain("version 2026.10.02 refused (tests_failed");
  });

  it("does not re-fetch a template whose cached version is current", async () => {
    const t = validTemplate();
    const { store, fetchJson } = makeStore(routesFor(t), { cached: [t] });
    store.loadFromCache();

    await store.sync();

    expect(fetchJson.calls).toEqual([`${BASE}/index.json`]);
    expect(store.getActive()).toHaveLength(1);
  });

  it("discards a sync of the previous repository that finishes after the new one's", async () => {
    const OTHER = "https://other.example.test/main";
    const a = validTemplate();
    const b = validTemplate({ id: "lodging:otherchain" });
    let releaseA: () => void = () => undefined;
    const aIndexHeld = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const routes: Routes = {
      ...routesFor(a),
      [`${OTHER}/index.json`]: indexFor(b),
      [`${OTHER}/lodging/otherchain.json`]: b,
    };
    const answer = fakeFetch(routes);
    // Repository A's index answers only when the test says so.
    const fetchJson: FetchJson = async (url) => {
      if (url === `${BASE}/index.json`) await aIndexHeld;
      return answer(url);
    };
    const cache = createMemoryTemplateCache([]);
    const store = new V2TemplateStore({ fetchJson, baseUrl: BASE, appVersion: "2.7.0", cache });

    const scheduledA = store.sync(); // a scheduled run, waiting on A
    store.setBaseUrl(OTHER); // the admin switches to B …
    await store.sync(); // … and B's sync completes first
    expect(store.getActive().map((t) => t.id)).toEqual(["lodging:otherchain"]);

    releaseA();
    await scheduledA;

    expect(store.getActive().map((t) => t.id)).toEqual(["lodging:otherchain"]);
    expect([...cache.entries.keys()]).toEqual(["lodging:otherchain"]);
    expect(store.getStatus().templates.map((t) => t.id)).toEqual(["lodging:otherchain"]);
  });

  it("leaves nothing of the previous repository in the cache when its sync stalls mid-way", async () => {
    const OTHER = "https://other.example.test/main";
    const a1 = validTemplate();
    const a2 = validTemplate({ id: "lodging:secondchain" });
    const b = validTemplate({ id: "lodging:otherchain" });
    let releaseA2: () => void = () => undefined;
    const a2Held = new Promise<void>((resolve) => {
      releaseA2 = resolve;
    });
    const answer = fakeFetch({
      ...routesFor(a1, a2),
      [`${OTHER}/index.json`]: indexFor(b),
      [`${OTHER}/lodging/otherchain.json`]: b,
    });
    let a2Asked: () => void = () => undefined;
    const a2Requested = new Promise<void>((resolve) => {
      a2Asked = resolve;
    });
    // A's first template answers; its second only when the test says so.
    const fetchJson: FetchJson = async (url) => {
      if (url === `${BASE}/lodging/secondchain.json`) {
        a2Asked();
        await a2Held;
      }
      return answer(url);
    };
    const cache = createMemoryTemplateCache([]);
    const store = new V2TemplateStore({ fetchJson, baseUrl: BASE, appVersion: "2.7.0", cache });

    const scheduledA = store.sync();
    await a2Requested; // A has read (and once cached) its first template
    store.setBaseUrl(OTHER);
    await store.sync();
    releaseA2();
    await scheduledA;

    expect([...cache.entries.keys()]).toEqual(["lodging:otherchain"]);
    // A restart reads the cache: only B's template comes back.
    const restarted = new V2TemplateStore({
      fetchJson: answer,
      baseUrl: OTHER,
      appVersion: "2.7.0",
      cache,
    });
    restarted.loadFromCache();
    expect(restarted.getActive().map((t) => t.id)).toEqual(["lodging:otherchain"]);
  });

  it("replaces a template of the previous repository with the new one's at the same id and version", async () => {
    const OTHER = "https://other.example.test/main";
    const fromA = validTemplate();
    const fromB = validTemplate({
      issuer: {
        name: "Mirror Hotels",
        kind: "hotel-chain",
        keys: { senderDomains: ["mirror.example"] },
      },
    });
    const answer = fakeFetch({
      ...routesFor(fromA),
      [`${OTHER}/index.json`]: indexFor(fromB),
      [`${OTHER}/lodging/examplechain.json`]: fromB,
    });
    const cache = createMemoryTemplateCache([]);
    const store = new V2TemplateStore({
      fetchJson: answer,
      baseUrl: BASE,
      appVersion: "2.7.0",
      cache,
    });
    await store.sync();
    expect(store.getActive()[0].issuer.name).toBe("Example Hotels");

    store.setBaseUrl(OTHER);
    await store.sync();

    expect(store.getActive().map((t) => t.issuer.name)).toEqual(["Mirror Hotels"]);
    expect(answer.calls).toContain(`${OTHER}/lodging/examplechain.json`);
    // … and across a restart: the cache holds B's file, marked as B's.
    const restarted = new V2TemplateStore({
      fetchJson: answer,
      baseUrl: OTHER,
      appVersion: "2.7.0",
      cache,
    });
    restarted.loadFromCache();
    expect(restarted.getActive().map((t) => t.issuer.name)).toEqual(["Mirror Hotels"]);
  });

  it("keeps the previous repository's template as a reported fallback when the new one's cannot be read", async () => {
    const OTHER = "https://other.example.test/main";
    const fromA = validTemplate();
    const answer = fakeFetch({
      ...routesFor(fromA),
      [`${OTHER}/index.json`]: indexFor(fromA),
      // B's file is missing: a 404
    });
    const cache = createMemoryTemplateCache([]);
    const store = new V2TemplateStore({
      fetchJson: answer,
      baseUrl: BASE,
      appVersion: "2.7.0",
      cache,
    });
    await store.sync();

    store.setBaseUrl(OTHER);
    await store.sync();

    expect(store.getActive().map((t) => t.issuer.name)).toEqual(["Example Hotels"]);
    const [entry] = store.getStatus().templates;
    expect(entry.state).toBe("active");
    expect(entry.detail).toContain("previous template repository");
    expect(entry.detail).toContain("fetch_failed");
    // A restart does not mistake A's cached file for B's: the next sync asks B again.
    const restarted = new V2TemplateStore({
      fetchJson: answer,
      baseUrl: OTHER,
      appVersion: "2.7.0",
      cache,
    });
    restarted.loadFromCache();
    answer.calls.length = 0;
    await restarted.sync();
    expect(answer.calls).toContain(`${OTHER}/lodging/examplechain.json`);
  });

  it("drops cached templates of another repository once the new one syncs", async () => {
    const stale = validTemplate({ id: "lodging:fromelsewhere" });
    const t = validTemplate();
    const { store, cache } = makeStore(routesFor(t), { cached: [stale] });
    // Not loaded as active (a restart that failed to read it, say): still purged.
    await store.sync();
    expect([...cache.entries.keys()]).toEqual(["lodging:examplechain"]);
  });

  it("deactivates and uncaches a template the index no longer names", async () => {
    const t = validTemplate();
    const { store, cache } = makeStore({ [`${BASE}/index.json`]: indexFor() }, { cached: [t] });
    store.loadFromCache();
    expect(store.getActive()).toHaveLength(1);

    await store.sync();

    expect(store.getActive()).toEqual([]);
    expect(cache.entries.size).toBe(0);
  });

  it("reports an unreachable index and keeps what the cache activated", async () => {
    const t = validTemplate();
    const { store } = makeStore({}, { cached: [t] });
    store.loadFromCache();

    await expect(store.sync()).resolves.toBe(false);

    expect(store.getStatus().index).toBe("unavailable");
    expect(store.getActive()).toHaveLength(1);
    // The last good set stays listed, and the failure carries its date.
    expect(store.getStatus().templates).toEqual([
      expect.objectContaining({ id: t.id, state: "active", source: "cached" }),
    ]);
    expect(Date.parse(store.getStatus().ranAt ?? "")).not.toBeNaN();
  });

  it("treats a v1-shaped index as no v2 index", async () => {
    const { store } = makeStore({ [`${BASE}/index.json`]: { version: "2025-04b", airlines: [] } });
    await expect(store.sync()).resolves.toBe(false);
    expect(store.getStatus().index).toBe("unavailable");
  });

  it("rejects one bad index line without losing the rest", async () => {
    const t = validTemplate();
    const routes = routesFor(t);
    routes[`${BASE}/index.json`] = {
      version: 2,
      templates: [
        { id: "lodging:evil", domain: "lodging", version: "1.0.0", path: "../secrets.json" },
        ...(indexFor(t) as { templates: unknown[] }).templates,
      ],
    };
    const { store } = makeStore(routes);

    await store.sync();

    expect(store.getActive()).toHaveLength(1);
    expect(store.getStatus().templates[0]).toMatchObject({
      id: "lodging:evil",
      reason: "invalid",
    });
  });
});

describe("V2TemplateStore.loadFromCache", () => {
  it("re-tests cached templates — an app downgrade below minAppVersion deactivates them", () => {
    const t = validTemplate({ minAppVersion: "2.8.0" });
    const { store } = makeStore({}, { cached: [t], appVersion: "2.7.0" });

    store.loadFromCache();

    expect(store.getActive()).toEqual([]);
    expect(store.getStatus().templates[0]).toMatchObject({
      source: "cached",
      reason: "needs_newer_app",
    });
  });

  it("does not throw when the cache cannot be read", () => {
    const store = new V2TemplateStore({
      fetchJson: fakeFetch({}),
      baseUrl: BASE,
      appVersion: "2.7.0",
      cache: {
        list: () => {
          throw new Error("EACCES");
        },
        write: () => undefined,
        remove: () => undefined,
      },
    });
    expect(() => store.loadFromCache()).not.toThrow();
    expect(store.getActive()).toEqual([]);
  });
});
