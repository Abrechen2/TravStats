import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { ensureAdminSettings } from "../services/instanceSettingsService";
import { railProviderSwitches } from "../services/rail/lookup";
import { instanceServicesView } from "../services/settings/instanceServices";
import { answerOperatorMark } from "../services/operatorLogos/operatorMarkService";
import { answerSubjectImage } from "../services/mapDetails/subjectImageService";
import { getCachedLatestRelease } from "../services/updateChecker";
import { TemplateRegistry } from "../services/parsers/templates/registry";

const getRate = jest.fn<(...a: unknown[]) => Promise<null>>();
const getCdnRate = jest.fn<(...a: unknown[]) => Promise<null>>();
jest.mock("../services/fx/frankfurter", () => ({ getRate: (...a: unknown[]) => getRate(...a) }));
jest.mock("../services/fx/currencyApiCdn", () => ({
  getCdnRate: (...a: unknown[]) => getCdnRate(...a),
}));

/**
 * Settings v3, owner decision 2026-11-12: the five granular outbound switches are
 * expert switches again. A service may call out only when the master switch AND its
 * own switch are on. `internetSwitch.test.ts` covers "master off"; each case here is
 * "master ON, own switch OFF", which the S6 fold into the master switch made
 * impossible to express.
 */
describe("a service's own switch still counts while the master internet switch is on", () => {
  let rowId: number;
  let original: Awaited<ReturnType<typeof ensureAdminSettings>>;
  let adminCookie: string;
  const set = (data: Record<string, boolean>) =>
    prisma.adminSettings.update({ where: { id: rowId }, data });

  beforeAll(async () => {
    original = await ensureAdminSettings();
    rowId = original.id;
    await prisma.user.deleteMany({ where: { username: "own_switch_admin" } });
    const admin = await prisma.user.create({
      data: {
        username: "own_switch_admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    getRate.mockReset().mockResolvedValue(null);
    getCdnRate.mockReset().mockResolvedValue(null);
    await set({
      internetEnabled: true,
      operatorLogosOpenDataEnabled: original.operatorLogosOpenDataEnabled,
      fxCdnFallbackEnabled: original.fxCdnFallbackEnabled,
      railTransitousEnabled: original.railTransitousEnabled,
      railDbRestEnabled: original.railDbRestEnabled,
      updateCheckEnabled: original.updateCheckEnabled,
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "own_switch_admin" } });
    await prisma.$disconnect();
  });

  it("rail: master on + Transitous off asks no Transitous; db-rest stays on; master off beats an on switch", async () => {
    await set({ railTransitousEnabled: false, railDbRestEnabled: true });
    expect(await railProviderSwitches()).toEqual({ transitous: false, dbRest: true });
    expect(await instanceServicesView()).toMatchObject({ transitous: false, dbRest: true });
    await set({ railTransitousEnabled: true, railDbRestEnabled: false });
    expect(await railProviderSwitches()).toEqual({ transitous: true, dbRest: false });
    await set({ railTransitousEnabled: true, railDbRestEnabled: true, internetEnabled: false });
    expect(await railProviderSwitches()).toEqual({ transitous: false, dbRest: false });
  });

  it("operator logos: master on + switch off makes no Wikidata or Commons request", async () => {
    await set({ operatorLogosOpenDataEnabled: false, internetEnabled: true });
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

  it("exchange rates: master on + CDN switch off still asks the ECB but never the CDN", async () => {
    const { resolveRate } = await import("../services/fx/resolver");
    await set({ fxCdnFallbackEnabled: false, internetEnabled: true });
    expect(await resolveRate("USD", "EGP", "2024-03-04")).toBeNull();
    expect(getRate).toHaveBeenCalled();
    expect(getCdnRate).not.toHaveBeenCalled();
  });

  it("update check: master on + switch off makes no GitHub request", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, status: 500 } as Response);
    await set({ updateCheckEnabled: false, internetEnabled: true });
    expect(await getCachedLatestRelease()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("scheduled template sync: master on + update-check switch off makes no request", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-own-switch-"));
    try {
      await set({ updateCheckEnabled: false, internetEnabled: true });
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
      expect(calls).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the admin settings route saves and returns all five switches", async () => {
    const five = {
      fxCdnFallbackEnabled: false,
      operatorLogosOpenDataEnabled: false,
      railTransitousEnabled: false,
      railDbRestEnabled: false,
      updateCheckEnabled: false,
    };
    const put = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", adminCookie)
      .send(five)
      .expect(200);
    expect(put.body.settings).toMatchObject(five);
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
    expect(row).toMatchObject(five);
    const get = await request(app)
      .get("/api/v1/admin/instance-settings")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(get.body.settings).toMatchObject(five);
  });
});
