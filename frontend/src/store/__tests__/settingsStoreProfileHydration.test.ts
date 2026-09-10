import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UserSettings } from "../../lib/api/types";

// The real store, not the global setup.ts mock — what `loadRemoteSettings`
// merges is the thing under test, and a mock cannot show it.
vi.unmock("../settingsStore");

import { useSettingsStore } from "../settingsStore";
import { useAuthStore } from "../authStore";
import { settingsApi } from "../../lib/api";

/**
 * Logging in as somebody else must not delete the new account's own e-mail.
 *
 * The guard against cross-account leftovers ran AFTER the server's values had
 * been merged in, so it could not tell a leftover from a value that had just
 * arrived. It blanked `profile.email` whenever the persisted username differed
 * from the one now logged in — including when the server had supplied the
 * correct address for that very account — and the next auto-save wrote the
 * blank back (audit finding AUD-036).
 *
 * The stale local profile is now dropped BEFORE hydration, and what the server
 * sends is never second-guessed.
 */
function signedInAs(username: string) {
  useAuthStore.setState({ user: { id: "u1", username, isAdmin: false } as never });
}

describe("settingsStore.loadRemoteSettings — profile across accounts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the e-mail the server sent for the account now logged in", async () => {
    // localStorage still holds the PREVIOUS account's profile.
    useSettingsStore.setState((s) => ({
      profile: { ...s.profile, username: "previous-user", email: "previous@example.com" },
    }));
    signedInAs("current-user");
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      profile: { username: "current-user", email: "current@example.com" },
    } as unknown as UserSettings);

    await useSettingsStore.getState().loadRemoteSettings();

    const { profile } = useSettingsStore.getState();
    expect(profile.username).toBe("current-user");
    expect(profile.email).toBe("current@example.com");
  });

  it("does not carry the previous account's e-mail when the server sends none", async () => {
    useSettingsStore.setState((s) => ({
      profile: { ...s.profile, username: "previous-user", email: "previous@example.com" },
    }));
    signedInAs("current-user");
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      profile: { username: "current-user" },
    } as unknown as UserSettings);

    await useSettingsStore.getState().loadRemoteSettings();

    expect(useSettingsStore.getState().profile.email).not.toBe("previous@example.com");
  });

  it("leaves the same account's own profile alone", async () => {
    // The positive case: without it the two above would pass on a store that
    // simply blanks the e-mail every time.
    useSettingsStore.setState((s) => ({
      profile: { ...s.profile, username: "same-user", email: "same@example.com" },
    }));
    signedInAs("same-user");
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      profile: { username: "same-user" },
    } as unknown as UserSettings);

    await useSettingsStore.getState().loadRemoteSettings();

    expect(useSettingsStore.getState().profile.email).toBe("same@example.com");
  });
});
