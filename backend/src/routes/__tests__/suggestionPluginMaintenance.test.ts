import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { verify } from "../../services/plugins/signing";
import { clearPluginInFlight } from "../../services/plugins/ask";

jest.mock("../../services/locationEvidence/allowed", () => ({
  ...jest.requireActual("../../services/locationEvidence/allowed"),
  travTrackDerivationAllowed: jest.fn(async () => "ok"),
}));

/**
 * Location maintenance through a plugin (owner 2026-11-24): offered only when
 * the hello announces it, signed, the account's venue-named stops sent with the
 * proposals request, apply forwards only the confirmed fields, undo forwards,
 * and every failure (readOnly, signature, unreachable) reaches the caller as itself.
 */
let server: http.Server;
let base: string;
let secret = "";
let capabilities: string[] | undefined = ["maintenance"];
let applyAnswer: { status: number; body: unknown } = { status: 200, body: null };
const received: { path: string; body: Record<string, unknown> }[] = [];

const MSA_ROW = {
  rowId: "7",
  name: "MSA Zentralküche Sonthofen",
  issues: ["noStreet"],
  proposals: [
    {
      source: "stop",
      lat: 47.512,
      lon: 10.271,
      confidence: "high",
      evidence: { venueName: "MSA Menüservice Allgäu", distanceMeters: 782 },
    },
  ],
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const h = (n: string) => String(req.headers[n.toLowerCase()]);
      const signed = verify(
        secret,
        {
          method: req.method!,
          path: req.url!,
          timestamp: Number(h("TravStats-Timestamp")),
          requestId: h("TravStats-Request-Id"),
          body,
        },
        h("TravStats-Signature")
      );
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (!signed) return send(401, { error: "unauthorized" });
      if (req.method === "GET")
        return send(200, { name: "Archiv", version: 1, kinds: ["stop"], capabilities });
      const parsed = JSON.parse(body) as Record<string, unknown>;
      received.push({ path: req.url!, body: parsed });
      if (req.url!.endsWith("/maintenance/proposals"))
        return send(200, { version: 1, rows: [MSA_ROW], applied: [], pendingSearches: 0 });
      if (req.url!.endsWith("/maintenance/apply")) {
        if (applyAnswer.body) return send(applyAnswer.status, applyAnswer.body);
        return send(200, {
          version: 1,
          undoId: "u-1",
          rowId: parsed.rowId,
          written: { Latitude: parsed.lat, Longitude: parsed.lon },
        });
      }
      if (req.url!.endsWith("/maintenance/undo"))
        return send(200, {
          version: 1,
          undoId: parsed.undoId,
          rowId: "7",
          restored: { Latitude: 47.5055914, Longitude: 10.27527 },
        });
      if (req.url!.endsWith("/maintenance/ignore"))
        return send(200, { version: 1, rowId: parsed.rowId, ignored: parsed.ignored });
      send(404, { error: "notFound" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.user.deleteMany({ where: { username: { startsWith: "plugmaint-" } } });
});
beforeEach(() => {
  capabilities = ["maintenance"];
  applyAnswer = { status: 200, body: null };
  received.length = 0;
  clearPluginInFlight();
});

const root = "/api/v1/settings/suggestion-plugins";

async function setup(precision: "exact" | "100m" | "1km" = "exact") {
  const user = await prisma.user.create({
    data: {
      username: `plugmaint-${Date.now()}-${Math.random()}`,
      passwordHash: "synthetic-test-hash",
      isAdmin: true,
    },
  });
  const cookie = `auth_token=${generateToken(user.id)}`;
  const made = await request(app)
    .post(root)
    .set("Cookie", cookie)
    .send({ name: "Archiv", url: `${base}/hook`, precision });
  expect(made.status).toBe(201);
  secret = made.body.secret;
  return { userId: user.id, cookie, id: made.body.plugin.id as string };
}

async function stay(userId: string, name: string, extra: Record<string, unknown> = {}) {
  const at = new Date(Date.now() - 86_400_000);
  await prisma.dawarichStay.create({
    data: {
      userId,
      fingerprint: `fp-${Math.random()}`,
      sourceStartAt: at,
      sourceEndAt: new Date(at.getTime() + 40 * 60_000),
      sourceLat: 47.512,
      sourceLon: 10.271,
      startAt: at,
      endAt: new Date(at.getTime() + 40 * 60_000),
      lat: 47.512,
      lon: 10.271,
      zone: "Europe/Berlin",
      pointCount: 10,
      evidence: {},
      name,
      provider: "travtrack",
      ...extra,
    },
  });
}

describe("plugin location maintenance", () => {
  it("is hidden for a plugin whose hello does not announce it", async () => {
    capabilities = undefined;
    const { cookie, id } = await setup();
    const caps = await request(app).get(`${root}/${id}/capabilities`).set("Cookie", cookie);
    expect(caps.body).toEqual({ capabilities: [], maintenance: false, error: null });
    const list = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(list.status).toBe(409);
    expect(list.body.code).toBe("PLUGIN_NO_MAINTENANCE");
    expect(received).toHaveLength(0);
  });

  it("lists proposals and sends the account's venue-named stops, never plugin-named ones", async () => {
    const { userId, cookie, id } = await setup();
    await stay(userId, "MSA Menüservice Allgäu");
    await stay(userId, "Archiv-Vorschlag", { evidence: { createdFrom: "plugin:x" } });
    const caps = await request(app).get(`${root}/${id}/capabilities`).set("Cookie", cookie);
    expect(caps.body.maintenance).toBe(true);
    const list = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.rows[0].name).toBe("MSA Zentralküche Sonthofen");
    expect(list.body.stopsSent).toBe(1);
    const sent = received.find((r) => r.path === "/hook/maintenance/proposals")!;
    expect(sent.body.stops).toEqual([
      expect.objectContaining({ venueName: "MSA Menüservice Allgäu", lat: 47.512, lon: 10.271 }),
    ]);
  });

  it("sends no stops at 1 km precision, and says why", async () => {
    const { userId, cookie, id } = await setup("1km");
    await stay(userId, "MSA Menüservice Allgäu");
    const list = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(list.body.stopsSent).toBe(0);
    expect(list.body.stopsWithheld).toBe("precision");
    expect(received[0].body.stops).toEqual([]);
  });

  it("apply forwards exactly the confirmed fields and refuses anything else", async () => {
    const { cookie, id } = await setup();
    const extra = await request(app)
      .post(`${root}/${id}/maintenance/apply`)
      .set("Cookie", cookie)
      .send({ rowId: "7", lat: 47.512, lon: 10.271, source: "stop", ProjName: "x" });
    expect(extra.status).toBe(400);
    expect(received).toHaveLength(0);
    const ok = await request(app)
      .post(`${root}/${id}/maintenance/apply`)
      .set("Cookie", cookie)
      .send({ rowId: "7", lat: 47.512, lon: 10.271, street: "Gewerbestr. 5", source: "geocoder" });
    expect(ok.status).toBe(200);
    expect(ok.body.undoId).toBe("u-1");
    const { version, requestId, ...fields } = received[0].body;
    expect(version).toBe(1);
    expect(typeof requestId).toBe("string");
    expect(fields).toEqual({
      rowId: "7",
      lat: 47.512,
      lon: 10.271,
      street: "Gewerbestr. 5",
      source: "geocoder",
    });
  });

  it("undo and ignore are forwarded", async () => {
    const { cookie, id } = await setup();
    const undo = await request(app)
      .post(`${root}/${id}/maintenance/undo`)
      .set("Cookie", cookie)
      .send({ undoId: "u-1" });
    expect(undo.status).toBe(200);
    expect(undo.body.restored).toEqual({ Latitude: 47.5055914, Longitude: 10.27527 });
    const ign = await request(app)
      .post(`${root}/${id}/maintenance/ignore`)
      .set("Cookie", cookie)
      .send({ rowId: "8", ignored: true });
    expect(ign.body).toMatchObject({ rowId: "8", ignored: true });
  });

  it("a read-only archive answers readOnly", async () => {
    const { cookie, id } = await setup();
    applyAnswer = { status: 409, body: { error: "readOnly" } };
    const res = await request(app)
      .post(`${root}/${id}/maintenance/apply`)
      .set("Cookie", cookie)
      .send({ rowId: "7", lat: 47.512, lon: 10.271, source: "stop" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "readOnly", code: "PLUGIN_FAILED" });
  });

  it("a signature the plugin refuses is shown as itself, not as 'not offered'", async () => {
    const { cookie, id } = await setup();
    const old = secret;
    await request(app).post(`${root}/${id}/rotate`).set("Cookie", cookie);
    secret = old; // the plugin still holds the old secret
    const caps = await request(app).get(`${root}/${id}/capabilities`).set("Cookie", cookie);
    expect(caps.body).toMatchObject({ maintenance: false, error: "auth" });
    const res = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "auth", code: "PLUGIN_FAILED" });
  });

  it("an unreachable plugin is shown as unreachable", async () => {
    const { cookie, id } = await setup();
    await prisma.suggestionPlugin.update({
      where: { id },
      data: { url: "http://127.0.0.1:9/hook" },
    });
    const res = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "unreachable", code: "PLUGIN_FAILED" });
  });

  it("only the owner of the registration reaches it", async () => {
    const { id } = await setup();
    const other = await prisma.user.create({
      data: {
        username: `plugmaint-other-${Date.now()}`,
        passwordHash: "synthetic-test-hash",
        isAdmin: true,
      },
    });
    const res = await request(app)
      .get(`${root}/${id}/maintenance`)
      .set("Cookie", `auth_token=${generateToken(other.id)}`);
    expect(res.status).toBe(404);
    expect(received).toHaveLength(0);
  });
});
