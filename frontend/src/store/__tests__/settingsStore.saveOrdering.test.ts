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

import { useSettingsStore } from "../settingsStore";

/**
 * An edit made while a save is in flight is still an unsaved edit.
 *
 * After a successful PUT the store recorded "what the server now holds" by
 * snapshotting the CURRENT store — which, on a slow connection, already
 * contained the change the user typed during the request. That change was
 * thereby marked saved, the next debounce saw nothing pending and skipped, and
 * the value never reached the server while the page said "saved"
 * (audit finding AUD-035).
 *
 * The second half of the same problem: two PUTs in flight together can land in
 * either order, and the loser overwrites the newer values with the older ones.
 * Saves are serialized now, so the requests leave in the order they were made.
 */
/** Let queued microtasks run — a save waits for the previous one before it
 *  touches the API, so nothing has been called on the same tick. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("settingsStore save ordering", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.updateProfile.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState((s) => ({
      profile: { ...s.profile, firstName: "start", birthdate: undefined },
      remoteSnapshot: null,
    }));
  });

  it("still reports a change made while the save was in flight", async () => {
    let releaseFirst!: () => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        })
    );

    const inFlight = useSettingsStore.getState().saveRemoteSettings();
    await tick();
    // The user types while the request is still open.
    useSettingsStore.setState((s) => ({ profile: { ...s.profile, firstName: "typed-later" } }));
    releaseFirst();
    await inFlight;

    // The response confirmed "start", not "typed-later".
    expect(useSettingsStore.getState().hasPendingChanges()).toBe(true);
  });

  it("reports nothing pending when nothing changed during the save", async () => {
    // The positive case: without it the assertion above could pass on a store
    // that simply never records anything as saved.
    mocks.update.mockResolvedValue(undefined);

    await useSettingsStore.getState().saveRemoteSettings();

    expect(useSettingsStore.getState().hasPendingChanges()).toBe(false);
  });

  it("does not put two saves on the wire at once", async () => {
    let releaseFirst!: () => void;
    let concurrent = 0;
    let maxConcurrent = 0;
    mocks.update.mockImplementation(() => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise<void>((resolve) => {
        const done = () => {
          concurrent -= 1;
          resolve();
        };
        if (!releaseFirst) releaseFirst = done;
        else done();
      });
    });

    const first = useSettingsStore.getState().saveRemoteSettings();
    const second = useSettingsStore.getState().saveRemoteSettings();
    await tick();
    releaseFirst();
    await Promise.all([first, second]);

    expect(maxConcurrent).toBe(1);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
