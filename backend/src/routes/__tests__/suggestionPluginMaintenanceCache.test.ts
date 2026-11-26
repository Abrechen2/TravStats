import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { verify } from "../../services/plugins/signing";
import {
  CACHE_PACE_MS,
  markMaintenanceDue,
  NEW_STOPS_DELAY_MS,
  refreshDueMaintenanceCaches,
} from "../../services/plugins/maintenanceCache";

jest.mock("../../services/locationEvidence/allowed", () => ({
  ...jest.requireActual("../../services/locationEvidence/allowed"),
  travTrackDerivationAllowed: jest.fn(async () => "ok"),
}));

/**
 * The inbox's cached plugin proposals (owner 2026-11-26): the tab reads the copy and never asks
 * the plugin; the poll refreshes it at the 6 h pace or after new stops; "Jetzt aktualisieren"
 * asks live; a failed refresh keeps the last answer and names why.
 */
let server: http.Server;
let base: string;
let secret = "";
let down = false;
let proposalsCalls = 0;

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
        return send(200, {
          name: "Archiv",
          version: 1,
          kinds: ["stop"],
          capabilities: ["maintenance"],
        });
      if (req.url!.endsWith("/maintenance/proposals")) {
        proposalsCalls += 1;
        if (down) return send(503, { error: "server" });
        return send(200, {
          version: 1,
          rows: [{ rowId: "7", name: "Baustelle", issues: ["noStreet"], proposals: [] }],
          totalRows: 1,
          applied: [],
          notices: [],
          noticeCount: 0,
        });
      }
      send(404, { error: "notFound" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.user.deleteMany({ where: { username: { startsWith: "plugcache-" } } });
});
beforeEach(() => {
  down = false;
  proposalsCalls = 0;
});

const root = "/api/v1/settings/suggestion-plugins";

async function setup() {
  const user = await prisma.user.create({
    data: {
      username: `plugcache-${Date.now()}-${Math.random()}`,
      passwordHash: "synthetic-test-hash",
      isAdmin: true,
    },
  });
  const cookie = `auth_token=${generateToken(user.id)}`;
  const made = await request(app)
    .post(root)
    .set("Cookie", cookie)
    .send({ name: "Archiv", url: `${base}/hook`, precision: "exact" });
  expect(made.status).toBe(201);
  secret = made.body.secret;
  return { userId: user.id, cookie, id: made.body.plugin.id as string };
}

describe("cached plugin maintenance for the inbox", () => {
  it("the inbox read never asks the plugin; the poll fills the copy", async () => {
    const { cookie, id, userId } = await setup();
    const empty = await request(app).get(`${root}/maintenance/inbox`).set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.plugins).toEqual([
      expect.objectContaining({ data: null, refreshedAt: null }),
    ]);
    expect(proposalsCalls).toBe(0);

    expect(await refreshDueMaintenanceCaches(new Date(), userId)).toBe(1);
    expect(proposalsCalls).toBe(1);
    const read = await request(app).get(`${root}/maintenance/inbox`).set("Cookie", cookie);
    expect(read.body.plugins[0].plugin.id).toBe(id);
    expect(read.body.plugins[0].data.rows[0].name).toBe("Baustelle");
    expect(proposalsCalls).toBe(1);
  });

  it("the poll waits 6 h, unless new stops made the copy due", async () => {
    const { userId } = await setup();
    const t0 = new Date();
    const at = (ms: number) => refreshDueMaintenanceCaches(new Date(t0.getTime() + ms), userId);
    await refreshDueMaintenanceCaches(t0, userId);
    expect(await at(60 * 60_000)).toBe(0);
    await markMaintenanceDue(userId, t0);
    expect(await at(NEW_STOPS_DELAY_MS + 1000)).toBe(1);
    expect(await at(CACHE_PACE_MS + 60_000)).toBe(0); // refreshed at t0 + delay: not stale yet
    expect(await at(NEW_STOPS_DELAY_MS + CACHE_PACE_MS + 60_000)).toBe(1);
  });

  it("a failed refresh keeps the last answer and names why", async () => {
    const { cookie, userId } = await setup();
    await refreshDueMaintenanceCaches(new Date(), userId);
    down = true;
    const res = await request(app)
      .post(`${root}/maintenance/refresh`)
      .set("Cookie", cookie)
      .send({ locale: "de" });
    expect(res.status).toBe(200);
    expect(res.body.plugins[0].failure).toBe("server");
    expect(res.body.plugins[0].data.rows).toHaveLength(1);
  });

  it("'Jetzt aktualisieren' asks live", async () => {
    const { cookie } = await setup();
    const res = await request(app)
      .post(`${root}/maintenance/refresh`)
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(proposalsCalls).toBe(1);
    expect(res.body.plugins[0].failure).toBeNull();
  });
});
