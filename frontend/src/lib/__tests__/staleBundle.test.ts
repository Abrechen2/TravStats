import { describe, it, expect, vi } from "vitest";
import {
  RELOAD_WINDOW_MS,
  STALE_RELOAD_KEY,
  STALE_RELOAD_PARAM,
  cacheBustedUrl,
  isChunkLoadError,
  reloadNowForStaleBundle,
  stripStaleReloadParam,
  tryReloadForStaleBundle,
  type RecoveryDeps,
} from "../staleBundle";

function memoryStorage(initial: Record<string, string> = {}): RecoveryDeps["storage"] {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

function deps(
  overrides: Partial<RecoveryDeps> = {}
): RecoveryDeps & { replace: ReturnType<typeof vi.fn> } {
  return {
    storage: memoryStorage(),
    now: () => 1_000_000_000,
    replace: vi.fn(),
    href: "https://travstats.example/dashboard/flights?mode=routes#x",
    ...overrides,
  } as RecoveryDeps & { replace: ReturnType<typeof vi.fn> };
}

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/DashboardPage-abc.js",
    "error loading dynamically imported module: https://x/assets/a.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/Dashboard-abc.css",
    "'text/html' is not a valid JavaScript MIME type.",
  ])("recognises %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("does not take an ordinary error for a stale chunk", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("tryReloadForStaleBundle", () => {
  it("reloads once, to a cache-busted URL, and remembers when", () => {
    const d = deps();
    expect(tryReloadForStaleBundle(d)).toBe(true);
    expect(d.replace).toHaveBeenCalledTimes(1);
    const target = new URL(d.replace.mock.calls[0][0] as string);
    expect(target.pathname).toBe("/dashboard/flights");
    expect(target.searchParams.get("mode")).toBe("routes");
    expect(target.searchParams.get(STALE_RELOAD_PARAM)).toBe("1000000000");
    expect(target.hash).toBe("#x");
    expect(d.storage?.getItem(STALE_RELOAD_KEY)).toBe("1000000000");
  });

  // The loop this guard exists for: the reload came back with the same
  // stale page, the chunk fails again — it must NOT reload a second time.
  it("does not reload again inside the window", () => {
    const storage = memoryStorage({ [STALE_RELOAD_KEY]: String(1_000_000_000 - 1000) });
    const d = deps({ storage });
    expect(tryReloadForStaleBundle(d)).toBe(false);
    expect(d.replace).not.toHaveBeenCalled();
  });

  it("reloads again once the window has passed (the next update, hours later)", () => {
    const storage = memoryStorage({
      [STALE_RELOAD_KEY]: String(1_000_000_000 - RELOAD_WINDOW_MS - 1),
    });
    const d = deps({ storage });
    expect(tryReloadForStaleBundle(d)).toBe(true);
  });

  it("ignores a garbage marker instead of trusting it", () => {
    const d = deps({ storage: memoryStorage({ [STALE_RELOAD_KEY]: "nonsense" }) });
    expect(tryReloadForStaleBundle(d)).toBe(true);
  });

  it("never reloads automatically without storage, since nothing could stop a loop", () => {
    const d = deps({ storage: null });
    expect(tryReloadForStaleBundle(d)).toBe(false);
    expect(d.replace).not.toHaveBeenCalled();
  });

  it("never reloads when storage throws", () => {
    const d = deps({
      storage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
      },
    });
    expect(tryReloadForStaleBundle(d)).toBe(false);
  });
});

describe("reloadNowForStaleBundle (the button)", () => {
  it("reloads even inside the window — a person asked for it", () => {
    const storage = memoryStorage({ [STALE_RELOAD_KEY]: String(1_000_000_000 - 10) });
    const d = deps({ storage });
    reloadNowForStaleBundle(d);
    expect(d.replace).toHaveBeenCalledTimes(1);
  });
});

describe("stripStaleReloadParam", () => {
  it("removes only the reload marker and keeps path, query and hash", () => {
    const replaceState = vi.fn();
    stripStaleReloadParam(
      { href: cacheBustedUrl("https://t.example/trips?view=list#top", 42) },
      { replaceState, state: { idx: 3 } }
    );
    expect(replaceState).toHaveBeenCalledWith({ idx: 3 }, "", "/trips?view=list#top");
  });

  it("leaves a URL without the marker alone", () => {
    const replaceState = vi.fn();
    stripStaleReloadParam({ href: "https://t.example/trips" }, { replaceState, state: null });
    expect(replaceState).not.toHaveBeenCalled();
  });
});
