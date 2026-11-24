import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { updatePolicy } from "../../services/externalServices/policy";
import { verify } from "../../services/plugins/signing";
import { clearPluginInFlight } from "../../services/plugins/ask";

/**
 * Suggestion plugin settings (spec 2026-11-23-plugins-and-calendar.md, P3):
 * the secret shown once, the forgejo#411 rule, the test button's synthetic stop
 * and its failure reasons, the limit of five, and the backfill's bounds.
 */
let server: http.Server;
let base: string;
let lastBody = "";
let status = 200;
let secret = "";

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
      if (!signed) {
        res.writeHead(401);
        return res.end();
      }
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ name: "Archiv", version: 1, kinds: ["stop"] }));
      }
      lastBody = body;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ version: 1, suggestions: [{ name: "Marienplatz", confidence: 0.5 }] })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.user.deleteMany({ where: { username: { startsWith: "plugroute-" } } });
});
beforeEach(() => {
  status = 200;
  clearPluginInFlight();
});

async function account(isAdmin: boolean) {
  const user = await prisma.user.create({
    data: {
      username: `plugroute-${Date.now()}-${Math.random()}`,
      passwordHash: "synthetic-test-hash",
      isAdmin,
    },
  });
  return { id: user.id, cookie: `auth_token=${generateToken(user.id)}`, username: user.username };
}
const root = "/api/v1/settings/suggestion-plugins";

describe("suggestion plugins", () => {
  it("returns the secret once; the list never carries it", async () => {
    const { cookie } = await account(true);
    const made = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "Archiv", url: `${base}/hook` });
    expect(made.status).toBe(201);
    expect(made.body.plugin).toMatchObject({ precision: "100m", enabled: true, secretSet: true });
    expect(Buffer.from(made.body.secret, "base64url")).toHaveLength(32);
    const list = await request(app).get(root).set("Cookie", cookie);
    expect(JSON.stringify(list.body)).not.toContain(made.body.secret);
    const row = await prisma.suggestionPlugin.findUniqueOrThrow({
      where: { id: made.body.plugin.id },
    });
    expect(row.secretEncrypted).not.toContain(made.body.secret);
    const rotated = await request(app)
      .post(`${root}/${made.body.plugin.id}/rotate`)
      .set("Cookie", cookie);
    expect(rotated.body.secret).not.toBe(made.body.secret);
  });

  it("refuses a LAN or plain-http address for an ordinary account", async () => {
    const { cookie } = await account(false);
    const lan = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "x", url: `${base}/hook` });
    expect(lan.body).toMatchObject({ error: "invalidUrl", code: "PRIVATE_TARGET" });
    const http = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "x", url: "http://plugin.example.com/hook" });
    expect(http.body).toMatchObject({ error: "invalidUrl", code: "CALENDAR_HTTPS_REQUIRED" });
  });

  it("holds an account to five plugins", async () => {
    const { cookie } = await account(true);
    for (let i = 0; i < 5; i++)
      await request(app)
        .post(root)
        .set("Cookie", cookie)
        .send({ name: `p${i}`, url: `${base}/h${i}` });
    const sixth = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "p6", url: `${base}/h6` });
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe("PLUGIN_LIMIT");
  });

  it("tests with a signed synthetic stop that carries no account data", async () => {
    const { cookie, id, username } = await account(true);
    const made = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "Archiv", url: `${base}/hook` });
    secret = made.body.secret;
    const res = await request(app)
      .post(`${root}/${made.body.plugin.id}/test`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      outcome: "ok",
      version: 1,
      first: { name: "Marienplatz" },
      hello: { name: "Archiv", kinds: ["stop"] },
    });
    const sent = JSON.parse(lastBody);
    expect(sent).toMatchObject({ kind: "test", stop: { lat: 48.137, lon: 11.575 } });
    expect(lastBody).not.toContain(id);
    expect(lastBody).not.toContain(username);
    const listed = await request(app).get(root).set("Cookie", cookie);
    expect(listed.body.plugins[0]).toMatchObject({ lastOutcome: "ok", lastVersion: 1 });
  });

  it("names the failure of a test as itself", async () => {
    const { cookie } = await account(true);
    const made = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "Archiv", url: `${base}/hook` });
    secret = "a-different-secret";
    const res = await request(app)
      .post(`${root}/${made.body.plugin.id}/test`)
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "auth", code: "PLUGIN_FAILED" });
    const listed = await request(app).get(root).set("Cookie", cookie);
    expect(listed.body.plugins[0].lastOutcome).toBe("auth");
  });

  it("is switched off by the admin's catalogue switch", async () => {
    const { cookie } = await account(true);
    const made = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "A", url: `${base}/hook` });
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "suggestionPlugins"] }));
    try {
      const res = await request(app)
        .post(`${root}/${made.body.plugin.id}/test`)
        .set("Cookie", cookie);
      expect(res.status).toBe(409);
      expect((await request(app).get(root).set("Cookie", cookie)).body.blocked).toBe("service_off");
    } finally {
      await updatePolicy((p) => ({
        ...p,
        disabled: p.disabled.filter((d) => d !== "suggestionPlugins"),
      }));
    }
  });

  it("refuses a backfill the plugin does not allow, and one over 90 days", async () => {
    const { cookie } = await account(true);
    const made = await request(app)
      .post(root)
      .set("Cookie", cookie)
      .send({ name: "A", url: `${base}/hook` });
    const id = made.body.plugin.id;
    const off = await request(app)
      .post(`${root}/${id}/backfill`)
      .set("Cookie", cookie)
      .send({ from: "2026-10-01", to: "2026-10-10" });
    expect(off.body.code).toBe("PLUGIN_BACKFILL_REFUSED");
    await request(app).patch(`${root}/${id}`).set("Cookie", cookie).send({ backfillAllowed: true });
    const long = await request(app)
      .post(`${root}/${id}/backfill`)
      .set("Cookie", cookie)
      .send({ from: "2026-01-01", to: "2026-06-01" });
    expect(long.body.code).toBe("PLUGIN_BACKFILL_REFUSED");
  });
});
