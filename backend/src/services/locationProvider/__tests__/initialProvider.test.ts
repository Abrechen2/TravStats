import { readFileSync } from "fs";
import path from "path";
import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";
import { hashPassword } from "../../../utils/password";
import { getInstanceSettings, updateInstanceSettings } from "../../instanceSettingsService";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { initialLocationProvider } from "../initialProvider";
import { createFirstAdmin } from "../../../scripts/firstAdmin";
import { seedLoginUser } from "../../../seedLoginUser";

/**
 * TravTrack as the default for new accounts (TravTrack plan T8, spec rule 4):
 * an account created while TravTrack is on starts on `travtrack`; one created
 * while it is off starts on `none` (no row); existing accounts are never
 * switched; the demo account never gets it. Every creation path — register,
 * the first admin (`setup.ts`) and an admin creating an account — goes
 * through `initialLocationProvider`.
 */

const PREFIX = "travtrack-initial-provider-";
const PASSWORD = "password123";

const providerOf = (userId: string) =>
  prisma.userSettings.findUnique({
    where: { userId },
    select: { locationProvider: true, locationProviderRev: true, data: true },
  });

describe("the initial location provider", () => {
  const switches = travTrackSwitches();
  let registration: boolean;
  let adminCookie: string;

  beforeAll(async () => {
    registration = (await getInstanceSettings()).allowRegistration;
    await updateInstanceSettings({ allowRegistration: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    const admin = await prisma.user.create({
      data: {
        username: `${PREFIX}admin`,
        passwordHash: await hashPassword(PASSWORD),
        isAdmin: true,
      },
    });
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { username: { startsWith: PREFIX }, NOT: { username: `${PREFIX}admin` } },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await updateInstanceSettings({ allowRegistration: registration });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const fresh = async (name: string, isDemo = false) =>
    (
      await prisma.user.create({
        data: { username: `${PREFIX}${name}`, passwordHash: "x", isDemo },
      })
    ).id;

  it("an account created while TravTrack is on starts on travtrack, rev 0", async () => {
    await switches.set({ beta: true, config: true });
    const userId = await fresh("on");
    await expect(prisma.$transaction((tx) => initialLocationProvider(tx, userId))).resolves.toBe(
      "travtrack"
    );
    expect(await providerOf(userId)).toMatchObject({
      locationProvider: "travtrack",
      locationProviderRev: 0,
    });
  });

  it("an account created while TravTrack is off starts on none and gets no row", async () => {
    await switches.set({ beta: true, config: false });
    const userId = await fresh("off");
    await expect(prisma.$transaction((tx) => initialLocationProvider(tx, userId))).resolves.toBe(
      "none"
    );
    expect(await providerOf(userId)).toBeNull();
  });

  it("keeps what the account's creation already stamped in its settings", async () => {
    await switches.set({ beta: true, config: true });
    const userId = await fresh("stamped");
    await prisma.userSettings.create({ data: { userId, data: { whatsNewSeenVersion: "9.9.9" } } });
    await prisma.$transaction((tx) => initialLocationProvider(tx, userId));
    expect(await providerOf(userId)).toMatchObject({
      locationProvider: "travtrack",
      data: { whatsNewSeenVersion: "9.9.9" },
    });
  });

  it("the demo account stays none", async () => {
    await switches.set({ beta: true, config: true });
    const userId = await fresh("demo-like", true);
    await expect(prisma.$transaction((tx) => initialLocationProvider(tx, userId))).resolves.toBe(
      "none"
    );
    expect(await providerOf(userId)).toBeNull();
  });

  it("no demo seed calls it", () => {
    for (const file of ["seedDemoAccount.ts", "seedDemoUser.ts"]) {
      const text = readFileSync(path.join(__dirname, "../../..", file), "utf8");
      expect(text).not.toContain("initialLocationProvider");
    }
  });

  it("switching TravTrack on later changes no existing account", async () => {
    await switches.set({ beta: true, config: false });
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: `${PREFIX}before`, password: PASSWORD });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: `${PREFIX}before` } });
    const before = await providerOf(user.id);
    await switches.set({ beta: true, config: true });
    expect(await providerOf(user.id)).toEqual(before);
    expect(before?.locationProvider ?? "none").toBe("none");
  });

  it("an account registered while TravTrack is on starts on travtrack", async () => {
    await switches.set({ beta: true, config: true });
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: `${PREFIX}registered`, password: PASSWORD });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: `${PREFIX}registered` },
    });
    expect(await providerOf(user.id)).toMatchObject({ locationProvider: "travtrack" });
    // The creation's own stamp survives beside it.
    expect((await providerOf(user.id))?.data).toHaveProperty("whatsNewSeenVersion");
  });

  it("an admin-created account follows the same rule", async () => {
    await switches.set({ beta: true, config: true });
    const on = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", adminCookie)
      .send({ username: `${PREFIX}by-admin-on`, password: PASSWORD });
    expect(on.status).toBe(201);
    expect(await providerOf(on.body.id ?? on.body.user?.id)).toMatchObject({
      locationProvider: "travtrack",
    });
    await switches.set({ beta: true, config: false });
    const off = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", adminCookie)
      .send({ username: `${PREFIX}by-admin-off`, password: PASSWORD });
    expect(off.status).toBe(201);
    expect((await providerOf(off.body.id ?? off.body.user?.id))?.locationProvider ?? "none").toBe(
      "none"
    );
  });
  it("the first admin the createAdmin script makes follows the same rule", async () => {
    await switches.set({ beta: true, config: true });
    const on = await createFirstAdmin(prisma, {
      username: `${PREFIX}script-on`,
      passwordHash: "x",
    });
    expect(await providerOf(on.id)).toMatchObject({ locationProvider: "travtrack" });
    await switches.set({ beta: true, config: false });
    const off = await createFirstAdmin(prisma, {
      username: `${PREFIX}script-off`,
      passwordHash: "x",
    });
    expect((await providerOf(off.id))?.locationProvider ?? "none").toBe("none");
  });

  it("the dev seed's demo login is a demo account and stays none", async () => {
    await switches.set({ beta: true, config: true });
    const user = await seedLoginUser(prisma, { username: `${PREFIX}seed-demo`, passwordHash: "x" });
    expect(user.isDemo).toBe(true);
    expect((await providerOf(user.id))?.locationProvider ?? "none").toBe("none");
  });

  it("the scripts create their accounts through these helpers", () => {
    const read = (file: string) => readFileSync(path.join(__dirname, "../../..", file), "utf8");
    expect(read("scripts/createAdmin.ts")).toContain("createFirstAdmin(");
    expect(read("seed.ts")).toContain("seedLoginUser(");
    expect(read("scripts/createAdmin.ts")).not.toContain("prisma.user.create(");
    expect(read("seed.ts")).not.toContain("prisma.user.upsert(");
  });
});
