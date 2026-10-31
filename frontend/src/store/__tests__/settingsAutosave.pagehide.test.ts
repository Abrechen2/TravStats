import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("../settingsStore");

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
