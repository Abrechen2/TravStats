import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";

import { prisma } from "../../db";
import { resolveCountryThreshold, countryThresholdFor } from "../countryThresholdResolver";
import { hashPassword } from "../../utils/password";

/**
 * User → instance default, and what "no choice" means.
 *
 * The resolution order is the same shape `apiKeyResolver.ts` uses for keys,
 * with one difference this file exists to pin: a user's `null` means "follow
 * the instance", not "off". An account that never opened the setting has to
 * keep tracking the admin — freezing whatever the default happened to be on the
 * day it was created is the failure mode a `?? DEFAULT` in the wrong place
 * would produce, and it would be invisible until the admin changed their mind.
 */
describe("resolveCountryThreshold", () => {
  let userId: string;
  let adminSettingsId: number;
  let originalInstance: string;

  const setInstance = (tier: string) =>
    prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: { countryThreshold: tier },
    });

  const setUser = (tier: string | null) =>
    prisma.userSettings.update({ where: { userId }, data: { countryThreshold: tier } });

  beforeAll(async () => {
    const row =
      (await prisma.adminSettings.findFirst()) ?? (await prisma.adminSettings.create({ data: {} }));
    adminSettingsId = row.id;
    originalInstance = row.countryThreshold;

    const user = await prisma.user.create({
      data: {
        username: `threshold-resolver-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });
    userId = user.id;
    await prisma.userSettings.create({ data: { userId, data: {} } });
  });

  afterEach(async () => {
    // The AdminSettings row is a singleton shared by the whole suite. Putting
    // it back after every case keeps this file from deciding what an unrelated
    // test measures.
    await setInstance(originalInstance);
    await setUser(null);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("falls back to the instance default when the user has not chosen", async () => {
    await setInstance("slept");

    const resolved = await resolveCountryThreshold(userId);

    expect(resolved.effective).toBe("slept");
    expect(resolved.user).toBeNull();
    expect(resolved.instance).toBe("slept");
  });

  it("lets a user override beat the instance default", async () => {
    await setInstance("slept");
    await setUser("connection");

    const resolved = await resolveCountryThreshold(userId);

    expect(resolved.effective).toBe("connection");
    expect(resolved.user).toBe("connection");
    // The instance default keeps travelling even when it is overridden — the
    // settings UI has to NAME what clearing the choice would return to.
    expect(resolved.instance).toBe("slept");
  });

  it("returns to the instance default when the user clears their choice", async () => {
    await setInstance("connection");
    await setUser("slept");
    expect(await countryThresholdFor(userId)).toBe("slept");

    await setUser(null);

    expect(await countryThresholdFor(userId)).toBe("connection");
  });

  it("answers the instance default for a caller with no user at all", async () => {
    await setInstance("connection");

    const resolved = await resolveCountryThreshold();

    expect(resolved.effective).toBe("connection");
    expect(resolved.user).toBeNull();
  });

  it("treats an unreadable stored value as no choice rather than as a filter", async () => {
    // The columns are plain TEXT — `CountryTier` owns the closed set in
    // TypeScript. So a row written by an older build, edited by hand, or
    // carrying a retired vocabulary (`transit` became `connection` in §3.4c,
    // and a database the rename migration never ran against still holds it)
    // can hold something the ranking does not know. Filtering against a rank
    // that does not exist would count ZERO countries and look like data loss.
    await setInstance("slept");
    await setUser("six_hours");

    const resolved = await resolveCountryThreshold(userId);

    expect(resolved.user).toBeNull();
    expect(resolved.effective).toBe("slept");
  });

  it("falls back to `transited` when the INSTANCE value is unreadable", async () => {
    await setInstance("whatever_the_admin_typed");

    expect((await resolveCountryThreshold(userId)).instance).toBe("transited");
  });

  it("treats a user with no settings row at all as unset", async () => {
    await setInstance("connection");
    const stranger = await prisma.user.create({
      data: {
        username: `threshold-nosettings-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });

    try {
      expect(await countryThresholdFor(stranger.id)).toBe("connection");
    } finally {
      await prisma.user.delete({ where: { id: stranger.id } }).catch(() => {});
    }
  });
});
