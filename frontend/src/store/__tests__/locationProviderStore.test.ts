import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LocationProviderSettings } from "../../lib/api/locationProvider";

/**
 * The location-provider store across accounts and overlapping requests
 * (Codex, final pass over dev/travtrack): an account switch must not leave
 * the previous account's provider on screen, a response that arrives for the
 * previous account is dropped, and within one account only the newest
 * request's answer wins — a slow GET must not undo a switch that landed.
 */

const { getProvider, setProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  setProvider: vi.fn(),
}));
vi.mock("../../lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/locationProvider")>()),
  locationProviderApi: { get: getProvider, set: setProvider },
}));

import { useLocationProviderStore } from "../locationProviderStore";
import { useAuthStore } from "../authStore";
import type { User } from "../../types";

const state = (kind: LocationProviderSettings["kind"], rev: number): LocationProviderSettings => ({
  kind,
  rev,
  status: "ok",
  choices: { none: true, travtrack: false, dawarich: true },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const user = (id: string) => ({ id, username: id }) as unknown as User;
const store = () => useLocationProviderStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: user("alice") });
  store().reset();
});

describe("locationProviderStore", () => {
  it("a slow GET that answers after a successful switch does not undo it", async () => {
    const slowGet = deferred<LocationProviderSettings>();
    getProvider.mockReturnValueOnce(slowGet.promise);
    setProvider.mockResolvedValueOnce(state("dawarich", 1));

    const refreshing = store().refresh();
    await store().choose("dawarich");
    slowGet.resolve(state("none", 0));
    await refreshing;

    expect(store().settings).toEqual(state("dawarich", 1));
  });

  it("the newer of two GETs wins whatever order they answer in", async () => {
    const first = deferred<LocationProviderSettings>();
    const second = deferred<LocationProviderSettings>();
    getProvider.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = store().refresh();
    const b = store().refresh();
    second.resolve(state("dawarich", 2));
    first.resolve(state("none", 1));
    await Promise.all([a, b]);

    expect(store().settings).toEqual(state("dawarich", 2));
  });

  it("an account switch clears the previous account's provider", async () => {
    getProvider.mockResolvedValueOnce(state("dawarich", 3));
    await store().refresh();
    expect(store().settings?.kind).toBe("dawarich");

    useAuthStore.setState({ user: user("bob") });
    expect(store().settings).toBeNull();

    // Bob's own load fails: nothing of Alice's comes back.
    getProvider.mockRejectedValueOnce(new Error("network"));
    await store().refresh();
    expect(store().settings).toBeNull();
    expect(store().loadFailed).toBe(true);
  });

  it("a logout clears it too", async () => {
    getProvider.mockResolvedValueOnce(state("dawarich", 3));
    await store().refresh();
    useAuthStore.getState().clearSession();
    expect(store().settings).toBeNull();
  });

  it("drops an answer that was asked for the previous account", async () => {
    const aliceGet = deferred<LocationProviderSettings>();
    getProvider.mockReturnValueOnce(aliceGet.promise);
    const refreshing = store().refresh();

    useAuthStore.setState({ user: user("bob") });
    aliceGet.resolve(state("dawarich", 3));
    expect(await refreshing).toBeNull();

    expect(store().settings).toBeNull();
  });
});
