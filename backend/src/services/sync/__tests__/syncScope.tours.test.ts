import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { loadSyncScope, scopeFingerprint } from "../scope";
import { toursVisible } from "../../tourVisibility";
import { getInstanceSettings, updateInstanceSettings } from "../../instanceSettingsService";

/**
 * tours-own-domain T1: tours follow the user's `tour` switch AND the instance's
 * beta key — in the sync scope too. Switching either changes the fingerprint, so
 * a phone holding an old cursor is told to resync (hide / re-send).
 */
describe("sync scope and toursVisible for the tour domain", () => {
  const username = "sync-scope-tours";
  let userId: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "tour"], data: {} },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  const setDomains = (enabledDomains: string[]) =>
    prisma.userSettings.update({ where: { userId }, data: { enabledDomains } });

  it("shows tours with the switch on and beta open", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await setDomains(["flight", "tour"]);
    expect((await loadSyncScope(userId)).tours).toBe(true);
    expect(await toursVisible(userId)).toBe(true);
  });

  it("hides tours when the user switched the domain off, even with beta open", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await setDomains(["flight"]);
    expect((await loadSyncScope(userId)).tours).toBe(false);
    expect(await toursVisible(userId)).toBe(false);
  });

  it("hides tours when beta is off, even with the domain on", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    await setDomains(["flight", "tour"]);
    expect((await loadSyncScope(userId)).tours).toBe(false);
    expect(await toursVisible(userId)).toBe(false);
  });

  it("changes the cursor fingerprint when the switch changes", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await setDomains(["flight", "tour"]);
    const on = scopeFingerprint(await loadSyncScope(userId));
    await setDomains(["flight"]);
    const off = scopeFingerprint(await loadSyncScope(userId));
    expect(on).not.toBe(off);
  });
});
