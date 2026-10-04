import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import {
  PENDING_STORAGE_KEY,
  createWebPrefsSync,
  stableStringify,
  type StoredSection,
  type WebPrefSectionDef,
  type WebPrefsSync,
  type WebPrefsTransport,
} from "../webPrefsSync";

/**
 * The sync engine (forgejo#200) against a fake server that holds the same
 * per-section last-write-wins rule as `backend/src/services/webPrefs/merge.ts`.
 * The sections are tiny stores, so each test can stand for one device.
 */

interface Prefs {
  colors: Record<string, string>;
  hidden: string[];
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** One "device": its own store, its own storage, the two sections over them. */
function device(initial: Partial<Prefs> = {}) {
  const store: StoreApi<Prefs> = createStore<Prefs>(() => ({
    colors: {},
    hidden: [],
    ...initial,
  }));
  const applied: string[] = [];
  const section = <K extends keyof Prefs>(name: string, key: K): WebPrefSectionDef => ({
    name,
    read: () => store.getState()[key],
    isDefault: (v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0),
    apply: (v) => {
      applied.push(name);
      store.setState({ [key]: v } as Partial<Prefs>);
    },
    subscribe: (cb) =>
      store.subscribe((s, p) => {
        if (s[key] !== p[key]) cb();
      }),
  });
  return {
    store,
    applied,
    storage: memoryStorage(),
    sections: [section("domainColors", "colors"), section("dashboardHiddenDomains", "hidden")],
  };
}

function fakeServer(initial: Record<string, StoredSection> = {}) {
  let sections: Record<string, StoredSection> = structuredClone(initial);
  let failNext: Array<{ status?: number }> = [];
  const transport = {
    get: vi.fn(async () => ({ sections: structuredClone(sections), updatedAt: null })),
    put: vi.fn(async (incoming: Record<string, { value: unknown; updatedAt: string }>) => {
      const failure = failNext.shift();
      if (failure)
        throw failure.status ? { response: { status: failure.status } } : new Error("offline");
      const stale: string[] = [];
      const next = { ...sections };
      for (const [name, entry] of Object.entries(incoming)) {
        const current = sections[name];
        if (current && Date.parse(entry.updatedAt) < Date.parse(current.updatedAt)) {
          stale.push(name);
          continue;
        }
        next[name] = { value: structuredClone(entry.value), updatedAt: entry.updatedAt };
      }
      sections = next;
      return { sections: structuredClone(sections), updatedAt: null, stale, dropped: [] };
    }),
  } satisfies WebPrefsTransport;
  return {
    transport,
    get sections() {
      return sections;
    },
    failWith: (...failures: Array<{ status?: number }>) => {
      failNext = failures;
    },
  };
}

const syncs: WebPrefsSync[] = [];

function startSync(
  dev: ReturnType<typeof device>,
  server: ReturnType<typeof fakeServer>,
  extra: { userId?: string; onFailure?: (kind: string) => void } = {}
) {
  const sync = createWebPrefsSync({
    sections: dev.sections,
    transport: server.transport,
    storage: dev.storage,
    userId: extra.userId ?? "user-1",
    onFailure: extra.onFailure,
    debounceMs: 1000,
    retryBaseMs: 2000,
    failuresBeforeNotice: 2,
  });
  syncs.push(sync);
  return sync;
}

const at = (iso: string) => ({ updatedAt: iso });

describe("web prefs sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
  });
  afterEach(() => {
    for (const s of syncs.splice(0)) s.stop();
    vi.useRealTimers();
  });

  it("applies the server's value on load — the server wins over this device", async () => {
    const phone = device({ colors: { flight: "#000000" } });
    const server = fakeServer({
      domainColors: { value: { flight: "#ff0000" }, ...at("2026-10-01T00:00:00Z") },
    });
    await startSync(phone, server).start();
    expect(phone.store.getState().colors).toEqual({ flight: "#ff0000" });
    // Applying is not a change: nothing goes back up.
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.transport.put).not.toHaveBeenCalled();
  });

  it("uploads a device's own choice when the server has none — the first device seeds", async () => {
    const desktop = device({ colors: { flight: "#00ff00" } });
    const server = fakeServer();
    await startSync(desktop, server).start();
    expect(server.transport.put).toHaveBeenCalledTimes(1);
    expect(Object.keys(server.transport.put.mock.calls[0][0])).toEqual(["domainColors"]);
    expect(server.sections.domainColors.value).toEqual({ flight: "#00ff00" });
  });

  it("does not upload defaults, even when they are written after the load", async () => {
    const fresh = device();
    const server = fakeServer();
    await startSync(fresh, server).start();
    // A map mounting writes its defaults: a new array, the same value.
    fresh.store.setState({ hidden: [] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.transport.put).not.toHaveBeenCalled();
  });

  it("debounces a change and sends only the section that changed", async () => {
    const dev = device();
    const server = fakeServer({
      domainColors: { value: {}, ...at("2026-10-01T00:00:00Z") },
      dashboardHiddenDomains: { value: [], ...at("2026-10-01T00:00:00Z") },
    });
    await startSync(dev, server).start();

    dev.store.setState({ hidden: ["cruise"] });
    dev.store.setState({ hidden: ["cruise", "rail"] });
    await vi.advanceTimersByTimeAsync(999);
    expect(server.transport.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(server.transport.put).toHaveBeenCalledTimes(1);
    const body = server.transport.put.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(["dashboardHiddenDomains"]);
    expect(body.dashboardHiddenDomains.value).toEqual(["cruise", "rail"]);
    expect(dev.storage.data.has(PENDING_STORAGE_KEY)).toBe(false);
  });

  it("keeps the local value when a write fails, retries with backoff, and says so once", async () => {
    const dev = device();
    const server = fakeServer({ domainColors: { value: {}, ...at("2026-10-01T00:00:00Z") } });
    const onFailure = vi.fn();
    await startSync(dev, server, { onFailure }).start();
    server.failWith({}, { status: 503 }, {});

    dev.store.setState({ colors: { flight: "#123456" } });
    await vi.advanceTimersByTimeAsync(1000); // first try — fails
    expect(dev.store.getState().colors).toEqual({ flight: "#123456" });
    expect(JSON.parse(dev.storage.data.get(PENDING_STORAGE_KEY)!).sections).toHaveProperty(
      "domainColors"
    );
    await vi.advanceTimersByTimeAsync(2000); // second — fails, the user is told
    expect(onFailure).toHaveBeenCalledWith("retrying");
    await vi.advanceTimersByTimeAsync(4000); // third — fails
    await vi.advanceTimersByTimeAsync(8000); // fourth — lands
    expect(server.transport.put).toHaveBeenCalledTimes(4);
    expect(server.sections.domainColors.value).toEqual({ flight: "#123456" });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(dev.storage.data.has(PENDING_STORAGE_KEY)).toBe(false);
  });

  it("does not retry a refused write, keeps the local value, and names the cause", async () => {
    const dev = device();
    const server = fakeServer({ domainColors: { value: {}, ...at("2026-10-01T00:00:00Z") } });
    const onFailure = vi.fn();
    await startSync(dev, server, { onFailure }).start();
    server.failWith({ status: 413 });

    dev.store.setState({ colors: { flight: "#abcdef" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.transport.put).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("tooLarge");
    expect(dev.store.getState().colors).toEqual({ flight: "#abcdef" });
  });

  it("sends nothing after stop — a pending write is dropped, an in-flight answer ignored", async () => {
    const dev = device();
    const server = fakeServer({ domainColors: { value: {}, ...at("2026-10-01T00:00:00Z") } });
    const sync = startSync(dev, server);
    await sync.start();

    dev.store.setState({ colors: { flight: "#111111" } });
    sync.stop(); // sign-out inside the debounce
    dev.store.setState({ colors: { flight: "#222222" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.transport.put).not.toHaveBeenCalled();
  });

  it("delivers an edit an earlier visit never sent, when it is newer than the server's", async () => {
    const dev = device({ colors: { flight: "#0000ff" } });
    dev.storage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ userId: "user-1", sections: { domainColors: "2026-10-03T00:00:00.000Z" } })
    );
    const server = fakeServer({
      domainColors: { value: { flight: "#ff0000" }, ...at("2026-10-02T00:00:00Z") },
    });
    await startSync(dev, server).start();
    expect(dev.applied).not.toContain("domainColors");
    expect(server.sections.domainColors.value).toEqual({ flight: "#0000ff" });
  });

  it("lets the server win over an older undelivered edit", async () => {
    const dev = device({ colors: { flight: "#0000ff" } });
    dev.storage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ userId: "user-1", sections: { domainColors: "2026-10-01T00:00:00.000Z" } })
    );
    const server = fakeServer({
      domainColors: { value: { flight: "#ff0000" }, ...at("2026-10-02T00:00:00Z") },
    });
    await startSync(dev, server).start();
    expect(dev.store.getState().colors).toEqual({ flight: "#ff0000" });
    expect(server.transport.put).not.toHaveBeenCalled();
  });

  it("never sends another account's undelivered edits", async () => {
    const dev = device({ colors: { flight: "#0000ff" } });
    dev.storage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ userId: "someone-else", sections: { domainColors: "2026-10-03T00:00:00Z" } })
    );
    const server = fakeServer({
      domainColors: { value: { flight: "#ff0000" }, ...at("2026-10-02T00:00:00Z") },
    });
    await startSync(dev, server).start();
    expect(dev.store.getState().colors).toEqual({ flight: "#ff0000" });
    expect(server.transport.put).not.toHaveBeenCalled();
  });

  it("lets the server's copy win over a change made on this page before the load answered", async () => {
    const dev = device();
    const server = fakeServer({
      dashboardHiddenDomains: { value: ["lodging"], ...at("2026-10-01T00:00:00Z") },
    });
    let release!: () => void;
    const original = server.transport.get.getMockImplementation()!;
    server.transport.get.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(original())))
    );
    const starting = startSync(dev, server).start();
    dev.store.setState({ hidden: ["cruise"] }); // e.g. an auto-picked default
    release();
    await starting;
    await vi.advanceTimersByTimeAsync(5000);
    expect(dev.store.getState().hidden).toEqual(["lodging"]);
    expect(server.transport.put).not.toHaveBeenCalled();
  });

  it("adopts the server's value when its own write turns out to be stale", async () => {
    const dev = device();
    const server = fakeServer({ domainColors: { value: {}, ...at("2026-10-01T00:00:00Z") } });
    await startSync(dev, server).start();
    dev.store.setState({ colors: { flight: "#333333" } });
    // Another device wrote after this one's edit was made but before it arrived.
    server.transport.put.mockImplementationOnce(async () => ({
      sections: {
        domainColors: { value: { flight: "#999999" }, ...at("2026-10-04T12:00:00.500Z") },
      },
      updatedAt: null,
      stale: ["domainColors"],
      dropped: [],
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(dev.store.getState().colors).toEqual({ flight: "#999999" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.transport.put).toHaveBeenCalledTimes(1);
  });

  it("two devices: a colour set on the computer appears on the phone", async () => {
    const server = fakeServer();
    const computer = device();
    const phone = device();
    const computerSync = startSync(computer, server);
    const phoneSync = startSync(phone, server);
    await computerSync.start();
    await phoneSync.start();

    computer.store.setState({ colors: { flight: "#e11d48" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.sections.domainColors.value).toEqual({ flight: "#e11d48" });

    // The phone's tab comes back into view.
    await phoneSync.refresh();
    expect(phone.store.getState().colors).toEqual({ flight: "#e11d48" });
    // …and does not echo it back.
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.transport.put).toHaveBeenCalledTimes(1);

    // A section the phone changes in the meantime is not overwritten by the
    // computer's colours: the merge is per section.
    phone.store.setState({ hidden: ["cruise"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.sections.domainColors.value).toEqual({ flight: "#e11d48" });
    expect(server.sections.dashboardHiddenDomains.value).toEqual(["cruise"]);

    // A third browser signing in for the first time gets both.
    const tablet = device();
    await startSync(tablet, server).start();
    expect(tablet.store.getState()).toMatchObject({
      colors: { flight: "#e11d48" },
      hidden: ["cruise"],
    });
  });
});

describe("stableStringify", () => {
  it("compares objects regardless of key order, as jsonb returns them", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(
      stableStringify({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 })
    );
  });
});
