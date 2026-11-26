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
        return send(200, {
          version: 1,
          rows: [MSA_ROW],
          totalRows: 301,
          applied: [],
          pendingSearches: 0,
          notices: [
            {
              severity: "warning",
              code: "coordsMismatch",
              rowId: "21",
              message: "far from address",
            },
          ],
          noticeCount: 1,
        });
      if (req.url!.endsWith("/maintenance/confirm"))
        return send(200, { version: 1, token: "ticket-1", expiresAt: "2026-11-26T12:00:00Z" });
      if (
        (req.url!.endsWith("/maintenance/apply") || req.url!.endsWith("/maintenance/undo")) &&
        parsed.token !== "ticket-1"
      )
        return send(403, { error: "confirmationRequired" });
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

  it("also sends unnamed stays of 20+ minutes (a hotel without a venue name), never zone, short, old or plugin ones", async () => {
    const { userId, cookie, id } = await setup();
    const day = 86_400_000;
    const at = (ago: number) => new Date(Date.now() - ago);
    const unnamed = (extra: Record<string, unknown>) => stay(userId, "x", { name: null, ...extra });
    await unnamed({ lat: 47.0145, lon: 10.2936 }); // 40 min, the Solaria-like case
    await unnamed({ lat: 47.1, lon: 10.1, endAt: new Date(at(day).getTime() + 10 * 60_000) }); // 10 min
    await unnamed({
      lat: 47.2,
      lon: 10.2,
      startAt: at(400 * day),
      endAt: at(400 * day - 3_600_000),
    }); // too old
    await unnamed({ lat: 47.3, lon: 10.3, evidence: { createdFrom: "plugin:x" } });
    await unnamed({ lat: 47.4, lon: 10.4 }); // inside a privacy zone
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "home", lat: 47.4, lon: 10.4, radiusM: 200 },
    });
    const list = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    const sent = received.find((r) => r.path === "/hook/maintenance/proposals")!;
    expect(sent.body.stops).toEqual([
      expect.objectContaining({ venueName: "", lat: 47.0145, lon: 10.2936 }),
    ]);
    expect(list.body.stopsSent).toBe(1);
  });

  it("forwards search and paging to the plugin, so a row beyond the first page is findable (Ragaz)", async () => {
    const { cookie, id } = await setup();
    const res = await request(app)
      .get(`${root}/${id}/maintenance?q=%20ragaz%20&offset=300&limit=50`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const sent = received.find((r) => r.path === "/hook/maintenance/proposals")!;
    expect(sent.body).toMatchObject({ query: "ragaz", offset: 300, limit: 50 });
    const bare = await request(app).get(`${root}/${id}/maintenance`).set("Cookie", cookie);
    expect(bare.status).toBe(200);
    const last = received.filter((r) => r.path === "/hook/maintenance/proposals").pop()!;
    expect(last.body).not.toHaveProperty("query");
    expect(last.body).not.toHaveProperty("offset");
    for (const bad of ["limit=0", "limit=301", "offset=-1", `q=${"x".repeat(101)}`]) {
      const r = await request(app).get(`${root}/${id}/maintenance?${bad}`).set("Cookie", cookie);
      expect(r.status).toBe(400);
    }
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
      .send({
        rowId: "7",
        lat: 47.512,
        lon: 10.271,
        source: "stop",
        token: "ticket-1",
        ProjName: "x",
      });
    expect(extra.status).toBe(400);
    expect(received).toHaveLength(0);
    const ok = await request(app)
      .post(`${root}/${id}/maintenance/apply`)
      .set("Cookie", cookie)
      .send({
        rowId: "7",
        lat: 47.512,
        lon: 10.271,
        street: "Gewerbestr. 5",
        postcode: "87527",
        source: "geocoder",
        token: "ticket-1",
      });
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
      postcode: "87527",
      source: "geocoder",
      token: "ticket-1",
    });
  });

  it("an apply or undo without the confirmation ticket is refused by the plugin and shown as such", async () => {
    const { cookie, id } = await setup();
    const noToken = await request(app)
      .post(`${root}/${id}/maintenance/apply`)
      .set("Cookie", cookie)
      .send({ rowId: "7", lat: 47.512, lon: 10.271, source: "stop" });
    expect(noToken.status).toBe(400); // the proxy itself demands a token
    expect(received).toHaveLength(0);
    const wrong = await request(app)
      .post(`${root}/${id}/maintenance/apply`)
      .set("Cookie", cookie)
      .send({ rowId: "7", lat: 47.512, lon: 10.271, source: "stop", token: "made-up" });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ error: "confirmationRequired", code: "PLUGIN_FAILED" });
    const undo = await request(app)
      .post(`${root}/${id}/maintenance/undo`)
      .set("Cookie", cookie)
      .send({ undoId: "u-1", token: "made-up" });
    expect(undo.body).toMatchObject({ error: "confirmationRequired" });
  });

  it("confirm forwards exactly the shown values and returns the ticket; it writes nothing itself", async () => {
    const { cookie, id } = await setup();
    const res = await request(app)
      .post(`${root}/${id}/maintenance/confirm`)
      .set("Cookie", cookie)
      .send({ kind: "apply", rowId: "7", lat: 47.5, lon: 10.2, town: "Sonthofen" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("ticket-1");
    const { version, requestId, ...fields } = received[0].body;
    expect([version, typeof requestId]).toEqual([1, "string"]);
    expect(fields).toEqual({ kind: "apply", rowId: "7", lat: 47.5, lon: 10.2, town: "Sonthofen" });
    const bad = await request(app)
      .post(`${root}/${id}/maintenance/confirm`)
      .set("Cookie", cookie)
      .send({ kind: "apply", rowId: "7", lat: 47.5, lon: 10.2, ProjName: "x" });
    expect(bad.status).toBe(400);
  });

  it("notices come without the row list, with the counts, for paced polling", async () => {
    const { cookie, id } = await setup();
    const res = await request(app).get(`${root}/${id}/maintenance/notices`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ noticeCount: 1, totalRows: 301, stopsSent: 0 });
    expect(res.body.notices[0]).toMatchObject({ severity: "warning", code: "coordsMismatch" });
    expect(res.body.rows).toBeUndefined();
    expect(received[0].body).toMatchObject({ limit: 1 });
  });

  it("undo and ignore are forwarded", async () => {
    const { cookie, id } = await setup();
    const undo = await request(app)
      .post(`${root}/${id}/maintenance/undo`)
      .set("Cookie", cookie)
      .send({ undoId: "u-1", token: "ticket-1" });
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
      .send({ rowId: "7", lat: 47.512, lon: 10.271, source: "stop", token: "ticket-1" });
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
