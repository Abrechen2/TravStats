import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  settingsApi: { update: mocks.update, updateProfile: mocks.updateProfile },
}));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../settingsStore", async () => vi.importActual("../settingsStore"));

import { snapshotOf, useSettingsStore } from "../settingsStore";

/**
 * Beta audit 2026-09-19, unlisted finding 1: as the shared demo, changing a
 * display setting is refused with a 403, the toast says "Speichern
 * fehlgeschlagen" — and the change stayed on screen AND survived a reload,
 * because the store had applied it optimistically and `persist` had written
 * it to localStorage. The app then showed a value the server had refused.
 */
describe("a settings save the server refuses", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.updateProfile.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState((s) => ({
      display: { ...s.display, dateFormat: "DD.MM.YYYY" },
      profile: { ...s.profile, birthdate: undefined },
    }));
    // What the server is known to hold: exactly the state above.
    useSettingsStore.setState({ remoteSnapshot: snapshotOf(useSettingsStore.getState()) });
  });

  it("puts the previous value back", async () => {
    mocks.update.mockRejectedValue(new Error("403 DEMO_ACCOUNT_FORBIDDEN"));
    useSettingsStore.setState((s) => ({ display: { ...s.display, dateFormat: "YYYY-MM-DD" } }));

    await expect(useSettingsStore.getState().saveRemoteSettings()).rejects.toThrow();

    expect(useSettingsStore.getState().display.dateFormat).toBe("DD.MM.YYYY");
  });

  it("leaves a successful save alone", async () => {
    mocks.update.mockResolvedValue(undefined);
    useSettingsStore.setState((s) => ({ display: { ...s.display, dateFormat: "YYYY-MM-DD" } }));

    await useSettingsStore.getState().saveRemoteSettings();

    expect(useSettingsStore.getState().display.dateFormat).toBe("YYYY-MM-DD");
  });

  /**
   * The birthdate PUT is a separate, independent request (#186). A failure
   * there must not undo the general settings write that went through — that
   * would be the #186 defect back, with the loss moved to the other side.
   */
  it("does not roll back when only the birthdate write failed", async () => {
    mocks.update.mockResolvedValue(undefined);
    mocks.updateProfile.mockRejectedValue(new Error("400"));
    useSettingsStore.setState((s) => ({
      display: { ...s.display, dateFormat: "MM/DD/YYYY" },
      profile: { ...s.profile, birthdate: "1990-01-01" },
    }));

    await expect(useSettingsStore.getState().saveRemoteSettings()).rejects.toThrow();

    expect(useSettingsStore.getState().display.dateFormat).toBe("MM/DD/YYYY");
  });

  /**
   * An edit typed while the refused request was open was never sent, so it
   * was never refused. Restoring over it would delete something the user has
   * just typed, and the next debounce will offer it to the server properly.
   */
  it("keeps an edit made while the refused request was in flight", async () => {
    let rejectFirst!: (reason: Error) => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        })
    );
    useSettingsStore.setState((s) => ({ display: { ...s.display, dateFormat: "YYYY-MM-DD" } }));

    const inFlight = useSettingsStore.getState().saveRemoteSettings();
    await new Promise((resolve) => setTimeout(resolve, 0));
    useSettingsStore.setState((s) => ({ display: { ...s.display, dateFormat: "MM/DD/YYYY" } }));
    rejectFirst(new Error("403"));
    await expect(inFlight).rejects.toThrow();

    expect(useSettingsStore.getState().display.dateFormat).toBe("MM/DD/YYYY");
  });
});
