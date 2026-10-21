import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UserSettings } from "../../lib/api/types";

vi.unmock("../settingsStore");

import { useSuggestionSwitchesStore } from "../suggestionSwitchesStore";
import { useSettingsStore } from "../settingsStore";
import { settingsApi } from "../../lib/api";

/** The inbox suggestion switches (forgejo#306) as the web holds them. */
describe("suggestionSwitchesStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSuggestionSwitchesStore.setState({ trips: true, stays: true });
  });

  it("learns both switches from the settings response", () => {
    useSuggestionSwitchesStore
      .getState()
      .noteRemote({ tripSuggestions: { enabled: false }, staySuggestions: { enabled: false } });
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: false, stays: false });
  });

  it("keeps the default when an older server sends no switch", () => {
    useSuggestionSwitchesStore.getState().noteRemote({ autoCreateTrips: true });
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: true, stays: true });
  });

  it("is fed by loadRemoteSettings, from the same response", async () => {
    vi.spyOn(settingsApi, "getProfile").mockResolvedValue({ birthdate: null } as never);
    vi.spyOn(settingsApi, "get").mockResolvedValue({
      tripSuggestions: { enabled: false },
      staySuggestions: { enabled: true },
    } as UserSettings);
    await useSettingsStore.getState().loadRemoteSettings();
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: false, stays: true });
  });

  it("a flip persists the nested key at once", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    useSuggestionSwitchesStore.getState().setTrips(false);
    useSuggestionSwitchesStore.getState().setStays(false);
    expect(useSuggestionSwitchesStore.getState()).toMatchObject({ trips: false, stays: false });
    expect(update).toHaveBeenCalledWith({ tripSuggestions: { enabled: false } });
    expect(update).toHaveBeenCalledWith({ staySuggestions: { enabled: false } });
  });

  it("a failed save puts the switch back", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("offline"));
    useSuggestionSwitchesStore.getState().setStays(false);
    await vi.waitFor(() => expect(useSuggestionSwitchesStore.getState().stays).toBe(true));
  });

  describe("quick flips of one switch (trip recording, forgejo#316)", () => {
    type Pending = { payload: unknown; resolve: () => void; reject: (e: Error) => void };
    let calls: Pending[];

    beforeEach(() => {
      calls = [];
      useSuggestionSwitchesStore.setState({ tripRecording: false });
      vi.spyOn(settingsApi, "update").mockImplementation(
        (payload) =>
          new Promise<UserSettings>((resolve, reject) => {
            calls.push({ payload, resolve: () => resolve({} as UserSettings), reject });
          })
      );
    });

    const settle = async () => {
      await new Promise((r) => setTimeout(r, 0));
    };

    it("sends one write at a time, so the server hears the flips in the order they were made", async () => {
      const store = useSuggestionSwitchesStore.getState();
      store.setTripRecording(true);
      store.setTripRecording(false);
      expect(calls).toHaveLength(1);
      calls[0].resolve();
      await settle();
      expect(calls.map((c) => c.payload)).toEqual([
        { tripRecording: { enabled: true } },
        { tripRecording: { enabled: false } },
      ]);
      calls[1].resolve();
      await settle();
      expect(useSuggestionSwitchesStore.getState().tripRecording).toBe(false);
    });

    it("a superseded write that fails late does not put back a value the server no longer holds", async () => {
      const store = useSuggestionSwitchesStore.getState();
      store.setTripRecording(true); // r1
      store.setTripRecording(false); // r2
      store.setTripRecording(true); // r3 — what the user wants, and what the server ends on
      await settle();
      // Every write sent so far succeeds except the first, which fails last.
      calls.slice(1).forEach((c) => c.resolve());
      await settle();
      calls[0].reject(new Error("offline"));
      await settle();
      // Then whatever is still to be sent goes through.
      for (let seen = 1; seen < calls.length; seen++) {
        calls[seen].resolve();
        await settle();
      }
      const sent = (settingsApi.update as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const serverHolds = (sent[sent.length - 1][0] as { tripRecording: { enabled: boolean } })
        .tripRecording.enabled;
      expect(serverHolds).toBe(true);
      expect(useSuggestionSwitchesStore.getState().tripRecording).toBe(true);
    });

    it("a failed latest write falls back to the value the server last confirmed", async () => {
      const store = useSuggestionSwitchesStore.getState();
      store.setTripRecording(true);
      calls[0].resolve();
      await settle();
      store.setTripRecording(false);
      await settle();
      calls[calls.length - 1].reject(new Error("offline"));
      await settle();
      expect(useSuggestionSwitchesStore.getState().tripRecording).toBe(true);
    });
  });
});
