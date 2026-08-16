import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { stampWhatsNewSeen } from "../whatsNewStamp";
import { appVersion } from "../../utils/version";

/**
 * A brand-new account was greeted with "New in TravStats 2.6.0" — the news of a
 * release it never ran. Confirmed on a fresh account during the 2.6.0 UAT.
 *
 * The stamp goes at ACCOUNT CREATION, not where the settings row is created
 * lazily on first read: an account created long ago may still have no settings
 * row, and stamping there would silence a modal it has every right to see.
 */
describe("stampWhatsNewSeen", () => {
  const upsert = jest.fn<() => Promise<unknown>>();
  const db = { userSettings: { upsert } } as unknown as Parameters<typeof stampWhatsNewSeen>[0];

  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({});
  });

  it("records the running version for the new account", async () => {
    await stampWhatsNewSeen(db, "user-1");

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0] as {
      where: { userId: string };
      create: { data: Record<string, unknown> };
    };
    expect(args.where).toEqual({ userId: "user-1" });
    expect(args.create.data).toEqual({ whatsNewSeenVersion: appVersion });
  });

  it("leaves an existing settings row alone", async () => {
    // Upsert, not create: two creation paths could race, and a row that
    // already exists carries the user's own choices. Overwriting it to
    // suppress one modal would be a poor trade.
    await stampWhatsNewSeen(db, "user-1");

    const args = upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update).toEqual({});
  });

  it("never lets a failed stamp break the signup", async () => {
    upsert.mockRejectedValue(new Error("database on fire"));

    // A missing stamp costs one unnecessary modal; a thrown error costs the
    // account the user was trying to create.
    await expect(stampWhatsNewSeen(db, "user-1")).resolves.toBeUndefined();
  });

  it("stamps the release version, not the build tag", () => {
    // `appVersion` has any -rc.N suffix stripped, which is what the content
    // entries are keyed on — stamping "2.6.0-rc.5" would match no entry and
    // show the modal anyway.
    expect(appVersion).not.toMatch(/-rc\.|-beta\./);
  });
});
