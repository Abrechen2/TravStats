import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { updatePolicy } from "../../services/externalServices/policy";

/**
 * Calendar sources (spec 2026-11-23-plugins-and-calendar.md, P1): the
 * forgejo#411 egress rule on save and on every read, the fixed failure kinds
 * of the test button, and secrets that never come back.
 */

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:one",
  "SUMMARY:Kunde",
  `DTSTART:${new Date(Date.now() - 86_400_000).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

let server: http.Server;
let base: string;
let davRequests: string[] = [];
const big = "X".repeat(6 * 1024 * 1024);

function caldavAnswer(req: http.IncomingMessage, body: string, res: http.ServerResponse) {
  davRequests.push(`${req.method} ${req.url}`);
  const ms = (inner: string) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
  res.writeHead(207, { "Content-Type": "application/xml" });
  if (req.url === "/dav/" && req.method === "PROPFIND")
    return res.end(
      ms(
        `<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:current-user-principal><d:href>/dav/principals/me/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    );
  if (req.url === "/dav/principals/me/")
    return res.end(
      ms(
        `<d:response><d:href>/dav/principals/me/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/dav/cal/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    );
  if (req.url === "/dav/cal/")
    return res.end(
      ms(
        `<d:response><d:href>/dav/cal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          `<d:response><d:href>/dav/cal/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Arbeit</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          `<d:response><d:href>/dav/cal/tasks/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Aufgaben</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    );
  if (req.url === "/dav/cal/work/" && req.method === "REPORT") {
    expect(body).toContain("time-range");
    return res.end(
      ms(
        `<d:response><d:href>/dav/cal/work/1.ics</d:href><d:propstat><d:prop><c:calendar-data>${ICS}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    );
  }
  if (req.url === "/dav-deep/") return res.end(ms("<d:a>".repeat(40) + "</d:a>".repeat(40)));
  if (req.url === "/dav-foreign/")
    return res.end(
      ms(
        `<d:response><d:href>/dav-foreign/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>http://169.254.169.254/latest/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    );
  res.end(ms(""));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.startsWith("/dav")) {
        if (req.headers.authorization !== `Basic ${Buffer.from("me:pw").toString("base64")}`) {
          res.writeHead(401);
          return res.end();
        }
        return caldavAnswer(req, body, res);
      }
      if (req.url === "/ok.ics") {
        res.writeHead(200, { "Content-Type": "text/calendar" });
        return res.end(ICS);
      }
      if (req.url === "/auth.ics") {
        res.writeHead(403);
        return res.end();
      }
      if (req.url === "/gone.ics") {
        res.writeHead(404);
        return res.end();
      }
      if (req.url === "/moved.ics") {
        res.writeHead(302, { Location: "http://169.254.169.254/" });
        return res.end();
      }
      if (req.url === "/html.ics") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<html>please log in</html>");
      }
      if (req.url === "/big.ics") {
        res.writeHead(200, { "Content-Type": "text/calendar" });
        return res.end(big);
      }
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((d) => d !== "calendar") }));
  await prisma.user.deleteMany({ where: { username: { startsWith: "calsrc-" } } });
  await prisma.$disconnect();
});

async function account(isAdmin: boolean) {
  const user = await prisma.user.create({
    data: {
      username: `calsrc-${isAdmin ? "a" : "u"}-${Date.now()}-${Math.random()}`,
      passwordHash: "synthetic-test-hash",
      isAdmin,
    },
  });
  return { id: user.id, cookie: `auth_token=${generateToken(user.id)}` };
}

const api = (cookie: string) => ({
  list: () => request(app).get("/api/v1/settings/calendar-sources").set("Cookie", cookie),
  add: (body: object) =>
    request(app).post("/api/v1/settings/calendar-sources").set("Cookie", cookie).send(body),
  test: (id: string) =>
    request(app)
      .post(`/api/v1/settings/calendar-sources/${id}/test`)
      .set("Cookie", cookie)
      .send({}),
  discover: (body: object) =>
    request(app)
      .post("/api/v1/settings/calendar-sources/caldav/discover")
      .set("Cookie", cookie)
      .send(body),
});

describe("calendar sources: egress (forgejo#411)", () => {
  it("refuses a private address for an ordinary account on save", async () => {
    const { cookie } = await account(false);
    const res = await api(cookie).add({ kind: "ics", label: "Arbeit", icsUrl: `${base}/ok.ics` });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalidUrl", code: "PRIVATE_TARGET" });
    const dav = await api(cookie).discover({ url: `${base}/dav/`, username: "me", password: "pw" });
    expect(dav.body).toMatchObject({ error: "invalidUrl", code: "PRIVATE_TARGET" });
  });

  it("lets an admin's own source reach the LAN, and reads it", async () => {
    const { cookie } = await account(true);
    const added = await api(cookie).add({ kind: "ics", label: "Arbeit", icsUrl: `${base}/ok.ics` });
    expect(added.status).toBe(201);
    const res = await api(cookie).test(added.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, events: 1, skippedRules: 0 });
  });

  it("re-checks the stored address on every read: a demoted admin loses the LAN target", async () => {
    const { id, cookie } = await account(true);
    const added = await api(cookie).add({ kind: "ics", label: "Arbeit", icsUrl: `${base}/ok.ics` });
    await prisma.user.update({ where: { id }, data: { isAdmin: false } });
    const res = await api(cookie).test(added.body.id);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalidUrl", code: "PRIVATE_TARGET" });
    const row = await prisma.calendarSource.findUniqueOrThrow({ where: { id: added.body.id } });
    expect(row).toMatchObject({ lastStatus: "invalidUrl", lastErrorCode: "PRIVATE_TARGET" });
  });

  it("is switched off by the admin's catalogue switch (the kill switch)", async () => {
    const { cookie } = await account(true);
    const added = await api(cookie).add({ kind: "ics", label: "Arbeit", icsUrl: `${base}/ok.ics` });
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "calendar"] }));
    try {
      const res = await api(cookie).test(added.body.id);
      expect(res.body).toMatchObject({
        error: "notConfigured",
        code: "CALENDAR_EGRESS_SERVICE_OFF",
      });
      expect((await api(cookie).list()).body.blocked).toBe("service_off");
    } finally {
      await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((d) => d !== "calendar") }));
    }
  });
});

describe("calendar sources: test button failure kinds", () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["/auth.ics", "auth", undefined],
    ["/gone.ics", "notFound", undefined],
    ["/moved.ics", "protocol", "CALENDAR_REDIRECT"],
    ["/html.ics", "protocol", "CALENDAR_PARSE"],
    ["/big.ics", "protocol", "CALENDAR_TOO_LARGE"],
    ["/fail.ics", "unreachable", undefined],
  ];
  it.each(cases)("%s answers %s", async (path, kind, code) => {
    const { cookie } = await account(true);
    const added = await api(cookie).add({ kind: "ics", label: "x", icsUrl: `${base}${path}` });
    const res = await api(cookie).test(added.body.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(kind);
    if (code) expect(res.body.code).toBe(code);
  });

  it("answers a closed port as unreachable", async () => {
    const { cookie } = await account(true);
    const added = await api(cookie).add({
      kind: "ics",
      label: "x",
      icsUrl: "http://127.0.0.1:1/x.ics",
    });
    expect((await api(cookie).test(added.body.id)).body.error).toBe("unreachable");
  });
});

describe("calendar sources: secrets", () => {
  it("never echoes the ICS address or the CalDAV password, only that they are set", async () => {
    const { id, cookie } = await account(true);
    await api(cookie).add({
      kind: "ics",
      label: "Privat",
      icsUrl: `webcal://127.0.0.1:${new URL(base).port}/ok.ics?token=s3cret`,
    });
    const listed = await api(cookie).list();
    const text = JSON.stringify(listed.body);
    expect(text).not.toContain("s3cret");
    expect(listed.body.sources[0]).toMatchObject({
      kind: "ics",
      icsHost: `127.0.0.1:${new URL(base).port}`,
      credentialSet: true,
    });
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { userId: id } });
    expect(row.icsUrlEncrypted).not.toContain("s3cret");
  });
});

describe("calendar sources: CalDAV", () => {
  it("discovers the event calendars and reads one with a time-range REPORT", async () => {
    const { cookie } = await account(true);
    davRequests = [];
    const found = await api(cookie).discover({
      url: `${base}/dav/`,
      username: "me",
      password: "pw",
    });
    expect(found.status).toBe(200);
    expect(found.body.collections).toEqual([{ href: `${base}/dav/cal/work/`, name: "Arbeit" }]);
    const added = await api(cookie).add({
      kind: "caldav",
      label: "Arbeit",
      url: `${base}/dav/`,
      username: "me",
      password: "pw",
      collections: found.body.collections,
    });
    expect(JSON.stringify(added.body)).not.toContain('"pw"');
    const res = await api(cookie).test(added.body.id);
    expect(res.body).toMatchObject({ ok: true, events: 1 });
    expect(davRequests).toContain("REPORT /dav/cal/work/");
  });

  it("answers a wrong password as auth", async () => {
    const { cookie } = await account(true);
    const res = await api(cookie).discover({ url: `${base}/dav/`, username: "me", password: "no" });
    expect(res.body.error).toBe("auth");
  });

  it("refuses XML nested past the cap and an href on another host", async () => {
    const { cookie } = await account(true);
    const deep = await api(cookie).discover({
      url: `${base}/dav-deep/`,
      username: "me",
      password: "pw",
    });
    expect(deep.body).toMatchObject({ error: "protocol", code: "CALENDAR_XML_TOO_DEEP" });
    const foreign = await api(cookie).discover({
      url: `${base}/dav-foreign/`,
      username: "me",
      password: "pw",
    });
    expect(foreign.body).toMatchObject({ error: "protocol", code: "CALENDAR_FOREIGN_HREF" });
  });
});
