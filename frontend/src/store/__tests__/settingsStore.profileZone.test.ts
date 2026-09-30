import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateProfile: vi.fn(),
  get: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../../lib/api", () => ({ settingsApi: mocks }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../settingsStore", async () => vi.importActual("../settingsStore"));

import { useSettingsStore } from "../settingsStore";
import { todayZoneFrom, useProfileZoneStore } from "../profileZoneStore";

/**
 * The browser-detected zone in `display.timezone` is a guess until the user
 * confirms it (ADR 0002 Q1, owner decision 2026-09-26). The store must learn
 * from the server whether a zone is set, and must not confirm the guess on the
 * user's behalf by sending it along with an unrelated settings save.
 */
describe("settingsStore — the profile zone is confirmed, never guessed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileZoneStore.getState().reset();
    mocks.getProfile.mockResolvedValue({ birthdate: null });
    mocks.update.mockResolvedValue({});
    mocks.updateProfile.mockResolvedValue({});
    useSettingsStore.setState({
      display: { ...useSettingsStore.getState().display, timezone: "Pacific/Kiritimati" },
      profile: { username: "u", email: "", birthdate: undefined },
    });
  });

  it("learns from the settings response that no zone is stored", async () => {
    mocks.get.mockResolvedValue({ display: { theme: "dark" } });
    await useSettingsStore.getState().loadRemoteSettings();
    expect(useProfileZoneStore.getState().status).toBe("missing");
  });

  it("an unrelated save does not send the guessed zone while it is unconfirmed", async () => {
    mocks.get.mockResolvedValue({ display: { theme: "dark" } });
    await useSettingsStore.getState().loadRemoteSettings();
    useSettingsStore.getState().setDisplay({ theme: "light" });
    await useSettingsStore.getState().saveRemoteSettings();
    const sent = mocks.update.mock.calls[0][0];
    expect(sent.display).not.toHaveProperty("timezone");
    expect(sent.display.theme).toBe("light");
  });

  it("a zone the user picks is confirmed and sent", async () => {
    mocks.get.mockResolvedValue({ display: {} });
    await useSettingsStore.getState().loadRemoteSettings();
    useSettingsStore.getState().setDisplay({ timezone: "Asia/Tokyo" });
    await useSettingsStore.getState().saveRemoteSettings();
    expect(useProfileZoneStore.getState().status).toBe("confirmed");
    expect(mocks.update.mock.calls[0][0].display.timezone).toBe("Asia/Tokyo");
  });

  it("a stored zone is confirmed and keeps travelling", async () => {
    mocks.get.mockResolvedValue({ display: { timezone: "Europe/Berlin" } });
    await useSettingsStore.getState().loadRemoteSettings();
    expect(useProfileZoneStore.getState().status).toBe("confirmed");
    await useSettingsStore.getState().saveRemoteSettings();
    expect(mocks.update.mock.calls[0][0].display.timezone).toBe("Europe/Berlin");
  });

  it("'today' is UTC until a zone is confirmed", () => {
    expect(todayZoneFrom("missing", "Pacific/Kiritimati")).toBe("UTC");
    expect(todayZoneFrom("unknown", "Pacific/Kiritimati")).toBe("UTC");
    expect(todayZoneFrom("confirmed", "Pacific/Kiritimati")).toBe("Pacific/Kiritimati");
  });
});
