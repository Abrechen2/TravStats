import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, settingsApi: { ...actual.settingsApi, update } };
});

import { asSettingsLevel, useSettingsLevelStore } from "../settingsLevelStore";

describe("settingsLevelStore (forgejo#321)", () => {
  beforeEach(() => {
    useSettingsLevelStore.setState({ level: null });
    update.mockReset();
  });

  it("takes the level GET /settings answered, and ignores anything else", () => {
    useSettingsLevelStore.getState().noteRemote({ settingsLevel: "standard" });
    expect(useSettingsLevelStore.getState().level).toBe("standard");
    useSettingsLevelStore.getState().noteRemote({ settingsLevel: "advanced" });
    useSettingsLevelStore.getState().noteRemote({});
    expect(useSettingsLevelStore.getState().level).toBe("standard");
  });

  it("writes a change to the account, and puts it back when the write fails", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    update.mockRejectedValueOnce(new Error("offline"));
    useSettingsLevelStore.getState().setLevel("expert");
    expect(update).toHaveBeenCalledWith({ settingsLevel: "expert" });
    expect(useSettingsLevelStore.getState().level).toBe("expert");
    await vi.waitFor(() => expect(useSettingsLevelStore.getState().level).toBe("standard"));
  });

  it("reads only the two levels", () => {
    expect(asSettingsLevel("expert")).toBe("expert");
    expect(asSettingsLevel("Expert")).toBeNull();
    expect(asSettingsLevel(null)).toBeNull();
  });
});
