import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../db";
import { ensureAdminSettings, getInstanceSettings } from "../services/instanceSettingsService";
import { isOpenDataEnabled } from "../services/openData/http";
import { railProviderSwitches } from "../services/rail/lookup";
import { instanceServicesView } from "../services/settings/instanceServices";
import { answerOperatorMark } from "../services/operatorLogos/operatorMarkService";
import { answerSubjectImage } from "../services/mapDetails/subjectImageService";
import { getAdminFxSettings } from "../services/parserSettings";
import { getCachedLatestRelease } from "../services/updateChecker";
import { TemplateRegistry } from "../services/parsers/templates/registry";

const getRate = jest.fn<(...a: unknown[]) => Promise<null>>();
const getCdnRate = jest.fn<(...a: unknown[]) => Promise<null>>();
jest.mock("../services/fx/frankfurter", () => ({ getRate: (...a: unknown[]) => getRate(...a) }));
jest.mock("../services/fx/currencyApiCdn", () => ({
  getCdnRate: (...a: unknown[]) => getCdnRate(...a),
}));

/**
 * Settings v3 master switch "the server may ask external services"
 * (`admin_settings.internet_enabled`). Each of the six columns it gates is
 * asserted in both positions: with the column ON the master switch decides, and
 * a column that is itself OFF stays off when the master switch is on.
 */
describe("internet master switch gates the external-service calls", () => {
  let rowId: number;
  let original: Awaited<ReturnType<typeof ensureAdminSettings>>;

  const set = (data: Record<string, boolean>) =>
    prisma.adminSettings.update({ where: { id: rowId }, data });

  beforeAll(async () => {
    getRate.mockResolvedValue(null);
    getCdnRate.mockResolvedValue(null);
    original = await ensureAdminSettings();
    rowId = original.id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    getRate.mockReset().mockResolvedValue(null);
    getCdnRate.mockReset().mockResolvedValue(null);
    await set({
      internetEnabled: true,
      openDataEnabled: original.openDataEnabled,
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults to on, and the stored columns are readable unchanged while it is off", async () => {
    expect(original.internetEnabled).toBe(true);
    await set({ openDataEnabled: true, internetEnabled: false });
    const settings = await getInstanceSettings();
    expect(settings.internetEnabled).toBe(false);
    // The column keeps its value: switching the master back on restores it.
    expect(settings.openDataEnabled).toBe(true);
  });

  it("openDataEnabled: open data calls are refused while the master switch is off", async () => {
    await set({ openDataEnabled: true, internetEnabled: true });
    expect(await isOpenDataEnabled()).toBe(true);
    await set({ internetEnabled: false });
    expect(await isOpenDataEnabled()).toBe(false);
    await set({ openDataEnabled: false, internetEnabled: true });
    expect(await isOpenDataEnabled()).toBe(false);
  });

  it("rail timetable sources: the rail lookup and the account view read both as off", async () => {
    expect(await railProviderSwitches()).toEqual({ transitous: true, dbRest: true });
    expect(await instanceServicesView()).toMatchObject({ transitous: true, dbRest: true });
    await set({ internetEnabled: false });
    expect(await railProviderSwitches()).toEqual({ transitous: false, dbRest: false });
    expect(await instanceServicesView()).toMatchObject({ transitous: false, dbRest: false });
  });

  it("operator logos: no Wikidata or Commons lookup while the master switch is off", async () => {
    await set({ internetEnabled: false });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    expect(await answerOperatorMark("airline", "Zzyzx Test Airways")).toEqual({
      mark: null,
      pending: false,
    });
    expect(await answerSubjectImage("airline", "Zzyzx Test Airways")).toMatchObject({
      disabled: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exchange rates: no ECB and no CDN call while the master switch is off, both while it is on", async () => {
    const { resolveRate } = await import("../services/fx/resolver");
    await set({ internetEnabled: false });
    expect((await getAdminFxSettings()).internetEnabled).toBe(false);
    expect(await resolveRate("USD", "EGP", "2024-03-04")).toBeNull();
    expect(getRate).not.toHaveBeenCalled();
    expect(getCdnRate).not.toHaveBeenCalled();

    await set({ internetEnabled: true });
    expect(await resolveRate("USD", "EGP", "2024-03-04")).toBeNull();
    expect(getRate).toHaveBeenCalled();
    expect(getCdnRate).toHaveBeenCalled();
  });

  it("update check: no GitHub release request while the master switch is off", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, status: 500 } as Response);
    await set({ internetEnabled: false });
    expect(await getCachedLatestRelease()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    await set({ internetEnabled: true });
    await getCachedLatestRelease();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("update check: the scheduled template sync makes no request while the master switch is off", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-internet-"));
    try {
      const run = async (internetEnabled: boolean): Promise<string[]> => {
        await set({ internetEnabled });
        const calls: string[] = [];
        const registry = new TemplateRegistry({
          baseUrl: "https://templates.example.test",
          cacheDir: tmp,
          snapshotDir: path.join(tmp, "snap"),
          fetchJson: (url: string) => {
            calls.push(url);
            return Promise.reject(new Error("HTTP 404"));
          },
        });
        await (registry as unknown as { scheduledSync: () => Promise<void> }).scheduledSync();
        return calls;
      };
      expect(await run(false)).toEqual([]);
      expect((await run(true)).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
