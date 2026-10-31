import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEB_PREF_SECTIONS } from "../../../../lib/webPrefs/registry";
import {
  createWebPrefsSync,
  type StoredSection,
  type WebPrefsTransport,
} from "../../../../lib/webPrefs/webPrefsSync";
import TrackLayersPanel from "../TrackLayersPanel";
import { DEFAULT_PREFS, PREFS_KEY, useTrackMapPrefs } from "../trackMapPrefs";
import { LEGACY_PREFS_KEY, migrateLegacyTrackPrefs } from "../../../../lib/webPrefs/trackMap";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const trackSection = WEB_PREF_SECTIONS.find((s) => s.name === "trackMap")!;
const stored = (key: string) => window.localStorage.getItem(key);

/** The account's web-prefs row, as the server holds it. */
function fakeServer(): { sections: Record<string, StoredSection>; transport: WebPrefsTransport } {
  const sections: Record<string, StoredSection> = {};
  return {
    sections,
    transport: {
      get: async () => ({ sections: { ...sections }, updatedAt: null }),
      put: async (incoming) => {
        for (const [name, s] of Object.entries(incoming)) sections[name] = s;
        return { sections: { ...sections }, updatedAt: null };
      },
    },
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("Track map appearance follows the account", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("migrates the rc.5 per-browser document once and idempotently", () => {
    window.localStorage.setItem(
      LEGACY_PREFS_KEY,
      JSON.stringify({ layers: { heat: true }, color: "plain", opacity: 0.5 })
    );
    migrateLegacyTrackPrefs();
    const migrated = JSON.parse(stored(PREFS_KEY)!);
    expect(migrated.layers.heat).toBe(true);
    expect(migrated.color).toBe("plain");
    expect(migrated.opacity).toBe(0.5);
    expect(stored(LEGACY_PREFS_KEY)).toBeNull();

    // A choice made since must survive a second run, and a stale legacy copy
    // that reappears (another tab, an old build) never overwrites it.
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...migrated, color: "speed" }));
    window.localStorage.setItem(LEGACY_PREFS_KEY, JSON.stringify({ color: "plain" }));
    migrateLegacyTrackPrefs();
    migrateLegacyTrackPrefs();
    expect(JSON.parse(stored(PREFS_KEY)!).color).toBe("speed");
    expect(stored(LEGACY_PREFS_KEY)).toBeNull();
  });

  it("keeps the legacy document when storage refuses the new one", () => {
    window.localStorage.setItem(LEGACY_PREFS_KEY, JSON.stringify({ color: "plain" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    migrateLegacyTrackPrefs();
    setItem.mockRestore();
    expect(stored(LEGACY_PREFS_KEY)).not.toBeNull();
    migrateLegacyTrackPrefs();
    expect(JSON.parse(stored(PREFS_KEY)!).color).toBe("plain");
  });

  it("a second browser sees the appearance chosen in the first", async () => {
    const server = fakeServer();
    const startSync = () =>
      createWebPrefsSync({
        sections: [trackSection],
        transport: server.transport,
        storage: memoryStorage(),
        userId: "u1",
        debounceMs: 0,
      });

    // Browser A: opens the panel, switches heat on, sets the opacity.
    const a = renderHook(() => useTrackMapPrefs());
    const syncA = startSync();
    await act(async () => syncA.start());
    act(() => a.result.current[1]({ layers: { ...a.result.current[0].layers, heat: true } }));
    act(() => a.result.current[1]({ opacity: 0.4 }));
    await act(async () => syncA.flush());
    syncA.stop();
    a.unmount();
    expect(server.sections.trackMap).toBeDefined();

    // Browser B: empty storage, mounts the panel BEFORE the account answers.
    window.localStorage.clear();
    const b = renderHook(() => useTrackMapPrefs());
    expect(b.result.current[0]).toEqual(DEFAULT_PREFS);
    const syncB = startSync();
    await act(async () => syncB.start());
    expect(b.result.current[0].layers.heat).toBe(true);
    expect(b.result.current[0].opacity).toBe(0.4);
    syncB.stop();
  });

  it("says 'Konnte diese Wahl nicht merken' when storage refuses, and the choice still applies", () => {
    const { result } = renderHook(() => useTrackMapPrefs());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => result.current[1]({ color: "plain" }));
    expect(result.current[0].color).toBe("plain");
    expect(result.current[2]).toBe(true);

    const view = render(
      <TrackLayersPanel prefs={result.current[0]} onChange={() => {}} saveFailed />
    );
    expect(screen.getByRole("status")).toHaveTextContent("track:map.route.notRemembered");
    view.unmount();
    render(<TrackLayersPanel prefs={result.current[0]} onChange={() => {}} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears the failed state once a later choice is stored", () => {
    const { result } = renderHook(() => useTrackMapPrefs());
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    act(() => result.current[1]({ color: "plain" }));
    expect(result.current[2]).toBe(true);
    act(() => result.current[1]({ color: "speed" }));
    expect(result.current[2]).toBe(false);
    spy.mockRestore();
  });
});

describe("Track layer rows are switches", () => {
  it("expose role=switch with aria-checked and toggle from the keyboard", () => {
    const onChange = vi.fn();
    render(<TrackLayersPanel prefs={DEFAULT_PREFS} onChange={onChange} />);
    const heat = screen.getByRole("switch", { name: "track:map.layers.heat" });
    expect(heat).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "track:map.layers.routes" })).toBeChecked();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    heat.focus();
    expect(heat).toHaveFocus();
    // jsdom has no native Space activation; the click a Space press makes is what counts.
    fireEvent.click(heat);
    expect(onChange).toHaveBeenCalledWith({ layers: { ...DEFAULT_PREFS.layers, heat: true } });
  });
});
