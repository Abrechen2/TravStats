import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("../settingsStore");

import type { UserSettings } from "../../lib/api/types";
import { settingsApi } from "../../lib/api";
import { useSettingsStore } from "../settingsStore";
import { scheduleAutosave } from "../settingsAutosave";

describe("settings autosave on pagehide", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the pending settings PUT with fetch keepalive, not axios, when the page is hidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.setState({ remoteSnapshot: "baseline" });

    scheduleAutosave();
    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/settings");
    expect(init).toMatchObject({ method: "PUT", keepalive: true, credentials: "include" });
    expect(JSON.parse(init.body)).toHaveProperty("defaults");
  });
});

describe("settings autosave on pagehide while a save is in flight", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the latest snapshot at once instead of waiting behind the active request", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve({ ok: true });
      })
    );
    // The first (axios) save never answers: the unload is about to cancel it.
    let finish!: () => void;
    const axiosSave = vi.spyOn(settingsApi, "update").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({} as UserSettings);
        })
    );
    useSettingsStore.setState({ remoteSnapshot: "baseline" });

    scheduleAutosave();
    // Start the save (timer fires), then edit again so the snapshot is newer.
    await new Promise((r) => setTimeout(r, 600));
    expect(axiosSave).toHaveBeenCalledTimes(1);
    useSettingsStore.setState({
      display: { ...useSettingsStore.getState().display, language: "de" },
    });

    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].init).toMatchObject({ method: "PUT", keepalive: true });
    expect(JSON.parse(calls[0].init.body as string).display.language).toBe("de");
    finish();
    axiosSave.mockRestore();
  });

  it("a pending edit behind an active request is not queued behind it on pagehide", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    let finish!: () => void;
    const axiosSave = vi.spyOn(settingsApi, "update").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({} as UserSettings);
        })
    );
    useSettingsStore.setState({ remoteSnapshot: "baseline-2" });

    scheduleAutosave();
    await new Promise((r) => setTimeout(r, 600));
    expect(axiosSave).toHaveBeenCalled();
    scheduleAutosave(); // a newer edit is waiting for its debounce
    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish();
    axiosSave.mockRestore();
  });
});
