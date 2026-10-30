import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** The recommended set of the approved mockup (mockup-admin.html `rec:` entries). */
const RECOMMENDED: Record<string, "free" | "freeCredit"> = {
  airlabs: "free",
  aerodatabox: "free",
  aeroapi: "freeCredit",
  opensky: "free",
  adsblol: "free",
  openrouteservice: "free",
  railTimetables: "free",
  geocoder: "free",
  immich: "free",
  ollama: "free",
  openData: "free",
  logos: "free",
  fx: "free",
  webdav: "free",
  smtp: "free",
};

type Row = {
  id: string;
  recommended: string | null;
  consent?: unknown;
  configured: boolean;
};

describe("external services view: catalogue facts (forgejo#392)", () => {
  let adminId: string;
  let cookie: string;
  let rowId: number;

  beforeAll(async () => {
    adminId = (
      await prisma.user.create({
        data: {
          username: `es-cat-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isAdmin: true,
          isActive: true,
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(adminId)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    delete process.env.OLLAMA_URL;
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { externalServicePolicy: {}, ollamaUrl: null },
    });
  });

  afterAll(async () => {
    await prisma.adminSettings.update({ where: { id: rowId }, data: { ollamaUrl: null } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  const rows = async (): Promise<Row[]> => {
    const res = await request(app).get("/api/v1/admin/external-services").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return (res.body.categories as Array<{ services: Row[] }>).flatMap((c) => c.services);
  };

  it("tags exactly the services of the approved mockup as recommended (GraphHopper and Google Places are not)", async () => {
    const tagged = Object.fromEntries(
      (await rows()).filter((r) => r.recommended).map((r) => [r.id, r.recommended])
    );
    expect(tagged).toEqual(RECOMMENDED);
  });

  it("keeps Dawarich out of the admin service list (accounts connect it themselves)", async () => {
    expect((await rows()).map((r) => r.id)).not.toContain("dawarich");
    const res = await request(app).get("/api/v1/admin/external-services").set("Cookie", cookie);
    expect(res.body.accountConnections.map((c: { id: string }) => c.id)).toContain("dawarich");
  });

  it("does not call a local Ollama cloud, and counts it configured once its address is set", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { ollamaUrl: "http://192.168.1.50:11434" },
    });
    const ollama = (await rows()).find((r) => r.id === "ollama")!;
    expect(ollama.consent).toBeUndefined();
    expect(ollama.configured).toBe(true);
  });

  it("calls a remote Ollama cloud: it carries the consent block", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { ollamaUrl: "https://ollama.example.com" },
    });
    const ollama = (await rows()).find((r) => r.id === "ollama")!;
    expect(ollama.consent).toBeDefined();
  });
});
