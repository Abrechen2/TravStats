import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { prisma } from "../../../../db";
import { JWT_SECRET } from "../../../../utils/jwtSecret";
import travplanRouter from "../../../../routes/travplan";
import guestRouter from "../../../../routes/guest";
import { errorHandler } from "../../../../middleware/errorHandler";
import { hash } from "../../../federation/refusal";
import { bookingSchema } from "../../schema";
import { signVouch, vouchSubject } from "../vouch";
import { readTripArchive } from "../../../trip/exchange/readArchive";
import { endAllGuestsAfterRestore, endGuestsOfOrigin } from "../sessions";

jest.mock("../../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));

// Two servers in one process: the identity module answers for whichever one is "running".
const HOST = "https://host.example";
const GUEST_SERVER = "https://guest.example";
const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    key: privateKey,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};
const hostKeys = pair();
const guestKeys = pair();
const mockState: { current: "host" | "guest" | "off" } = { current: "host" };
jest.mock("../../../federation/identity", () => ({
  loadIdentity: async () => {
    const which = mockState.current;
    if (which === "off") throw new Error("federation-off");
    const keys = which === "host" ? hostKeys : guestKeys;
    return {
      origin: which === "host" ? HOST : GUEST_SERVER,
      key: keys.key,
      publicKey: keys.publicKey,
      fingerprint: "x",
      source: "settings",
    };
  },
  resetIdentityCache: () => undefined,
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/guest", guestRouter);
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

let owner: string, guestUser: string, other: string;
const userCookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);
const call = (method: "get" | "post" | "delete", url: string, who: string, body?: object) => {
  const r = request(app)
    [method]("/api/v1" + url)
    .set("Cookie", userCookie(who));
  return body ? r.send(body) : r;
};
/** A guest call: cookie session (with the marker header) or phone token. */
function asGuest(
  method: "get" | "post" | "delete",
  url: string,
  cred: { cookie?: string; pat?: string },
  body?: object,
  marker = true
) {
  const r = request(app)[method]("/api/v1/guest" + url);
  if (cred.cookie) r.set("Cookie", "ts_guest=" + cred.cookie);
  if (cred.cookie && marker) r.set("X-TravStats-Guest", "1");
  if (cred.pat) r.set("Authorization", "Bearer " + cred.pat);
  return body ? r.send(body) : r;
}
const cookieValue = (res: request.Response, name: string): string | undefined => {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const hit = raw.find((c) => c.startsWith(name + "="));
  return hit ? hit.split(";")[0].slice(name.length + 1) : undefined;
};

async function newPlan() {
  const r = await call("post", "/travplan/plans", owner, {
    name: "Guest trip",
    clientRef: randomUUID(),
    settings: { destination: "Madeira", startDay: "2027-03-10", endDay: "2027-03-17" },
  });
  expect(r.status).toBe(201);
  const plan = await prisma.travelPlan.findFirstOrThrow({ where: { tripId: r.body.tripId } });
  return { tripId: r.body.tripId as string, planId: plan.id, revision: r.body.revision as number };
}

/** The guest's server signs a vouch for `invite`/`nonce` as `who`, as it would on its own screen. */
async function vouchAs(who: string, invite: string, nonce: string, host = HOST) {
  mockState.current = "guest";
  try {
    return await call("post", "/federation/vouch", who, { host, invite, nonce });
  } finally {
    mockState.current = "host";
  }
}
const vouchOf = (redirectUrl: string) => redirectUrl.split("#vouch=")[1];

interface Joined {
  memberId: string;
  cookie: string;
  planId: string;
  tripId: string;
  inviteId: string;
}
/** The whole §6.5 flow, with a hook to tamper at each step. */
async function joinGuest(
  plan: { tripId: string; planId: string },
  options: { who?: string; username?: string } = {}
): Promise<Joined> {
  const invited = await call("post", `/trips/${plan.tripId}/plan/guests`, owner, {
    origin: GUEST_SERVER,
    username: options.username ?? "annas-name",
  });
  expect(invited.status).toBe(201);
  const [inviteId, secret] = (invited.body.link as string).split("#")[1].split(".");
  const started = await request(app).post("/api/v1/guest/join/start").send({ inviteId, secret });
  expect(started.status).toBe(200);
  const nonce = new URL(started.body.vouchUrl).searchParams.get("nonce")!;
  const vouched = await vouchAs(options.who ?? guestUser, inviteId, nonce);
  expect(vouched.status).toBe(200);
  const done = await request(app)
    .post("/api/v1/guest/join/complete")
    .set("Cookie", "ts_guest_join=" + cookieValue(started, "ts_guest_join"))
    .send({ vouch: vouchOf(vouched.body.redirectUrl) });
  expect(done.status).toBe(201);
  return {
    memberId: invited.body.member.id,
    cookie: cookieValue(done, "ts_guest")!,
    planId: done.body.planId,
    tripId: done.body.tripId,
    inviteId,
  };
}
async function startOnly(plan: { tripId: string }) {
  const invited = await call("post", `/trips/${plan.tripId}/plan/guests`, owner, {
    origin: GUEST_SERVER,
    username: "x",
  });
  const [inviteId, secret] = (invited.body.link as string).split("#")[1].split(".");
  const started = await request(app).post("/api/v1/guest/join/start").send({ inviteId, secret });
  const nonce = new URL(started.body.vouchUrl).searchParams.get("nonce")!;
  return {
    inviteId,
    secret,
    nonce,
    memberId: invited.body.member.id as string,
    joinCookie: "ts_guest_join=" + cookieValue(started, "ts_guest_join"),
  };
}
const complete = (vouch: string, cookie?: string) => {
  const r = request(app).post("/api/v1/guest/join/complete");
  if (cookie) r.set("Cookie", cookie);
  return r.send({ vouch });
};

const idea = (title: string) => ({
  type: "upsert",
  collection: "ideas",
  value: { id: randomUUID(), title, category: "", priority: "optional", note: "", itemId: null },
});

beforeAll(async () => {
  const users = await Promise.all(
    [0, 1, 2].map((n) =>
      prisma.user.create({
        data: { username: "guests-test-" + n + "-" + randomUUID(), passwordHash: "x" },
      })
    )
  );
  [owner, guestUser, other] = users.map((u) => u.id);
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  // Both servers are pinned, enabled and verified in the one table the admin pins into.
  for (const [origin, keys] of [
    [GUEST_SERVER, guestKeys],
    [HOST, hostKeys],
  ] as const)
    await prisma.comparisonPeer.upsert({
      where: { origin },
      create: { origin, publicKey: keys.publicKey, enabled: true, verifiedAt: new Date() },
      update: { publicKey: keys.publicKey, enabled: true, verifiedAt: new Date() },
    });
});
// The host-wide cap counts every remote member in the database, so each test starts without any.
beforeEach(async () => {
  await prisma.travelPlanMember.deleteMany({ where: { kind: "remote" } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("TravPlan remote guests", () => {
  it("lets a vouched guest read and edit the one plan, names them as the author and tells the owner", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const read = await asGuest("get", `/plans/${plan.planId}`, { cookie: guest.cookie });
    expect(read.status).toBe(200);
    expect(read.body.self).toMatchObject({ kind: "remote", isOwner: false });
    const written = await asGuest(
      "post",
      `/plans/${plan.planId}/mutations`,
      { cookie: guest.cookie },
      { clientRef: randomUUID(), baseRevision: read.body.revision, operation: idea("Levada walk") }
    );
    expect(written.status).toBe(200);
    expect(written.body.lastMutation).toMatchObject({
      summary: "upsert:ideas",
      actor: { displayName: expect.any(String) },
    });
    const notices = await call("get", `/trips/${plan.tripId}/plan/collab`, owner);
    expect(notices.body.notices).toHaveLength(1);
    // The member row carries the pseudonym, never an account id.
    const member = await prisma.travelPlanMember.findUniqueOrThrow({
      where: { id: guest.memberId },
    });
    expect(member).toMatchObject({ kind: "remote", status: "active", userId: null });
    expect(member.remoteSubject).toBe(vouchSubject(guestKeys.key, HOST, guestUser));
  });

  it("refuses a forged vouch, and the invited place stays unclaimed", async () => {
    const plan = await newPlan();
    const s = await startOnly(plan);
    const impostor = pair();
    const iat = Math.floor(Date.now() / 1000);
    const forged = signVouch(
      {
        v: 1,
        iss: GUEST_SERVER,
        aud: HOST,
        sub: "c".repeat(64),
        name: "Mallory",
        invite: s.inviteId,
        nonce: s.nonce,
        iat,
        exp: iat + 60,
      },
      impostor.key
    );
    const refused = await complete(forged, s.joinCookie);
    expect([refused.status, refused.body.code]).toEqual([403, "PLAN_GUEST_VOUCH_INVALID"]);
    const member = await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: s.memberId } });
    expect(member.status).toBe("invited");
    expect(await prisma.travelPlanGuestSession.count({ where: { memberId: s.memberId } })).toBe(0);
  });

  it("refuses a vouch from a server the admin has not admitted, even if it signs correctly", async () => {
    const plan = await newPlan();
    const s = await startOnly(plan);
    const rogue = pair();
    const iat = Math.floor(Date.now() / 1000);
    const token = signVouch(
      {
        v: 1,
        iss: "https://rogue.example",
        aud: HOST,
        sub: "d".repeat(64),
        name: "Rogue",
        invite: s.inviteId,
        nonce: s.nonce,
        iat,
        exp: iat + 60,
      },
      rogue.key
    );
    expect((await complete(token, s.joinCookie)).body.code).toBe("PLAN_GUEST_VOUCH_INVALID");
  });

  it("refuses a vouch replayed after it was used, and one carried by another browser", async () => {
    const plan = await newPlan();
    const s = await startOnly(plan);
    const vouched = await vouchAs(guestUser, s.inviteId, s.nonce);
    const token = vouchOf(vouched.body.redirectUrl);
    // Another browser: the nonce is bound to the cookie of the browser that started the join.
    const elsewhere = await complete(token, "ts_guest_join=" + "z".repeat(40));
    expect(elsewhere.body.code).toBe("PLAN_GUEST_VOUCH_INVALID");
    const noCookie = await complete(token);
    expect(noCookie.body.code).toBe("PLAN_GUEST_JOIN_NOT_STARTED");
    expect((await complete(token, s.joinCookie)).status).toBe(201);
    const replay = await complete(token, s.joinCookie);
    expect([replay.status, replay.body.code]).toEqual([403, "PLAN_GUEST_VOUCH_INVALID"]);
    expect(await prisma.travelPlanGuestSession.count({ where: { memberId: s.memberId } })).toBe(1);
  });

  it("refuses a vouch bound to another invitation or another plan's nonce", async () => {
    const planA = await newPlan();
    const planB = await newPlan();
    const a = await startOnly(planA);
    const b = await startOnly(planB);
    // A's nonce, B's invitation id.
    const mixed = await vouchAs(guestUser, b.inviteId, a.nonce);
    expect((await complete(vouchOf(mixed.body.redirectUrl), a.joinCookie)).body.code).toBe(
      "PLAN_GUEST_VOUCH_INVALID"
    );
  });

  it("answers a used, wrong or expired invitation with the same 404 and starts nothing", async () => {
    const plan = await newPlan();
    const s = await startOnly(plan);
    const start = (inviteId: string, secret: string) =>
      request(app).post("/api/v1/guest/join/start").send({ inviteId, secret });
    const wrong = await start(s.inviteId, "w".repeat(43));
    expect([wrong.status, wrong.body.code]).toEqual([404, "PLAN_GUEST_INVITE_INVALID"]);
    expect((await start(randomUUID(), s.secret)).body.code).toBe("PLAN_GUEST_INVITE_INVALID");
    await prisma.travelPlanGuestInvite.update({
      where: { id: s.inviteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await start(s.inviteId, s.secret)).body.code).toBe("PLAN_GUEST_INVITE_INVALID");
  });

  it("will not vouch for a host the guest's own admin has not admitted", async () => {
    const refused = await vouchAs(guestUser, randomUUID(), "e".repeat(64), "https://evil.example");
    expect([refused.status, refused.body.code]).toEqual([403, "PLAN_GUEST_HOST_NOT_ADMITTED"]);
    const check = await call("get", "/federation/vouch/check?host=https://evil.example", guestUser);
    expect(check.body.code).toBe("PLAN_GUEST_HOST_NOT_ADMITTED");
  });

  it("refuses to invite a person on a server that is not admitted", async () => {
    const plan = await newPlan();
    const r = await call("post", `/trips/${plan.tripId}/plan/guests`, owner, {
      origin: "https://nobody.example",
      username: "x",
    });
    expect([r.status, r.body.code]).toEqual([403, "PLAN_GUEST_PEER_NOT_ADMITTED"]);
  });

  it("ends a guest's access at once when the owner removes them (cookie and phone token)", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const pat = await asGuest("post", `/plans/${plan.planId}/pat`, { cookie: guest.cookie });
    expect(pat.status).toBe(201);
    expect(pat.body.token).toMatch(/^ts_gpat_/);
    expect((await asGuest("get", `/plans/${plan.planId}`, { pat: pat.body.token })).status).toBe(
      200
    );
    const removed = await call(
      "delete",
      `/trips/${plan.tripId}/plan/members/${guest.memberId}`,
      owner
    );
    expect(removed.body).toEqual({ revoked: true });
    for (const cred of [{ cookie: guest.cookie }, { pat: pat.body.token }]) {
      const after = await asGuest("get", `/plans/${plan.planId}`, cred);
      // A removed guest hears "revoked", not "sign in" (the credential is a tombstone).
      expect([after.status, after.body.code]).toEqual([401, "PLAN_GUEST_REVOKED"]);
    }
    // Their past change would keep their name; the pseudonym is released for a later invitation.
    expect(
      await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: guest.memberId } })
    ).toMatchObject({ status: "revoked", remoteSubject: null });
  });

  it("ends every guest of a server the moment its pin is suspended, replaced or removed", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const ok = () => asGuest("get", `/plans/${plan.planId}`, { cookie: guest.cookie });
    expect((await ok()).status).toBe(200);
    // Even before any hook ran: the request itself asks the pin.
    await prisma.comparisonPeer.update({
      where: { origin: GUEST_SERVER },
      data: { enabled: false },
    });
    const dead = await ok();
    expect([dead.status, dead.body.code]).toEqual([401, "PLAN_GUEST_REVOKED"]);
    await prisma.comparisonPeer.update({
      where: { origin: GUEST_SERVER },
      data: { enabled: true },
    });
    expect((await ok()).status).toBe(200);
    // A replaced key is a different server: the old credential does not carry over.
    const replacement = pair();
    await prisma.comparisonPeer.update({
      where: { origin: GUEST_SERVER },
      data: { publicKey: replacement.publicKey },
    });
    expect((await ok()).body.code).toBe("PLAN_GUEST_REVOKED");
    await prisma.comparisonPeer.update({
      where: { origin: GUEST_SERVER },
      data: { publicKey: guestKeys.publicKey },
    });
    // The admin hooks revoke for good: back under the old key the guest stays out.
    expect((await ok()).status).toBe(200);
    await endGuestsOfOrigin(GUEST_SERVER);
    expect((await ok()).status).toBe(401);
    expect(
      (await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: guest.memberId } })).status
    ).toBe("revoked");
  });

  it("ends every guest and credential after a restore", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    await endAllGuestsAfterRestore();
    expect((await asGuest("get", `/plans/${plan.planId}`, { cookie: guest.cookie })).status).toBe(
      401
    );
    expect(await prisma.travelPlanGuestSession.count()).toBe(0);
  });

  it("keeps owner-only acts away from a guest: no delete, no members, no AI policy, no handover", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const cred = { cookie: guest.cookie };
    const deleted = await asGuest("delete", `/plans/${plan.planId}`, cred);
    expect(deleted.status).toBe(404);
    expect(await prisma.travelPlan.count({ where: { id: plan.planId } })).toBe(1);
    const post = (operation: object) =>
      asGuest("post", `/plans/${plan.planId}/mutations`, cred, {
        clientRef: randomUUID(),
        baseRevision: plan.revision,
        operation,
      });
    expect((await post({ type: "handover" })).body.code).toBe("PLAN_OWNER_ONLY");
    expect(
      (await post({ type: "settings", values: { ai: { enabled: true, policy: "cloud_allowed" } } }))
        .body.code
    ).toBe("PLAN_OWNER_ONLY");
    expect((await asGuest("post", `/plans/${plan.planId}/members`, cred, {})).status).toBe(404);
    expect((await asGuest("post", `/plans/${plan.planId}/proposals`, cred, {})).status).toBe(404);
  });

  it("never lets a credential for one plan act on another, in the path or by trip id", async () => {
    const planA = await newPlan();
    const planB = await newPlan();
    const guest = await joinGuest(planA);
    const pat = (await asGuest("post", `/plans/${planA.planId}/pat`, { cookie: guest.cookie })).body
      .token;
    for (const cred of [{ cookie: guest.cookie }, { pat }]) {
      for (const [method, url] of [
        ["get", `/plans/${planB.planId}`],
        ["get", `/plans/${planB.planId}/collab`],
        ["get", `/plans/${planB.planId}/documents`],
        ["post", `/plans/${planB.planId}/mutations`],
      ] as const) {
        const r = await asGuest(method, url, cred, method === "post" ? {} : undefined);
        expect([url, r.status, r.body.code]).toEqual([url, 404, "PLAN_NOT_FOUND"]);
      }
    }
  });

  it("refuses a user session or user token at the guest door, and a guest credential at the user door", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const asUser = await request(app)
      .get(`/api/v1/guest/plans/${plan.planId}`)
      .set("Cookie", userCookie(owner));
    expect([asUser.status, asUser.body.code]).toEqual([401, "PLAN_GUEST_REQUIRED"]);
    const userPat = await request(app)
      .get(`/api/v1/guest/plans/${plan.planId}`)
      .set("Authorization", "Bearer ts_pat_" + "a".repeat(40));
    expect(userPat.body.code).toBe("PLAN_GUEST_REQUIRED");
    const jwtBearer = await request(app)
      .get(`/api/v1/guest/plans/${plan.planId}`)
      .set("Authorization", "Bearer " + jwt.sign({ userId: owner, epoch: 0 }, JWT_SECRET));
    expect(jwtBearer.body.code).toBe("PLAN_GUEST_REQUIRED");
    // The other way round: the guest cookie and a phone token open nothing on the user routes.
    const pat = (await asGuest("post", `/plans/${plan.planId}/pat`, { cookie: guest.cookie })).body
      .token;
    for (const url of [`/trips/${plan.tripId}/plan`, "/travplan/plans"]) {
      const viaCookie = await request(app)
        .get("/api/v1" + url)
        .set("Cookie", "ts_guest=" + guest.cookie);
      const viaBearer = await request(app)
        .get("/api/v1" + url)
        .set("Authorization", "Bearer " + pat);
      expect([viaCookie.status, viaBearer.status]).toEqual([401, 401]);
    }
    // And a cookie session mints no phone token from a phone token.
    expect((await asGuest("post", `/plans/${plan.planId}/pat`, { pat })).status).toBe(403);
  });

  it("does not let a cross-site form write with the cookie alone", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const r = await asGuest(
      "post",
      `/plans/${plan.planId}/notices/read`,
      { cookie: guest.cookie },
      {},
      false
    );
    expect([r.status, r.body.code]).toEqual([403, "PLAN_GUEST_CSRF"]);
  });

  it("limits one guest to 120 writes a minute without touching another guest", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const second = await joinGuest(await newPlan(), { who: other });
    const hit = () =>
      asGuest("post", `/plans/${plan.planId}/notices/read`, { cookie: guest.cookie }, {});
    let last = 200;
    for (let i = 0; i < 120; i++) last = (await hit()).status;
    expect(last).toBe(200);
    const over = await hit();
    expect([over.status, over.body.code]).toEqual([429, "PLAN_GUEST_RATE_LIMITED"]);
    const fine = await asGuest(
      "post",
      `/plans/${second.planId}/notices/read`,
      { cookie: second.cookie },
      {}
    );
    expect(fine.status).toBe(200);
  });

  it("counts a guest's weather and place searches against the owner, not the guest", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    // Without a configured location the forecast refuses before any provider call, which is the
    // path that matters here: the actor is resolved and the quota user is the owner.
    const r = await asGuest(
      "post",
      `/plans/${plan.planId}/forecast`,
      { cookie: guest.cookie },
      { clientRef: randomUUID(), baseRevision: plan.revision }
    );
    expect(r.body.code).toBe("PLAN_WEATHER_LOCATION");
    expect(await prisma.travelPlanUsage.count({ where: { userId: guestUser } })).toBe(0);
  });

  it("does not let a guest attach a private document of the owner's trip to a booking", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const secret = await prisma.document.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        storedName: "private-" + randomUUID() + ".txt",
        mimetype: "text/plain",
        sizeBytes: 3,
        sha256: hash(randomUUID()),
        format: "text",
      },
    });
    const booking = bookingSchema.parse({
      id: randomUUID(),
      kind: "hotel",
      title: "Hotel",
      reference: null,
      provider: "",
      day: null,
      endDay: null,
      time: null,
      timezone: null,
      amount: null,
      paid: 0,
      currency: "EUR",
      place: "",
      documentIds: [secret.id],
      source: "",
      details: {},
    });
    const r = await asGuest(
      "post",
      `/plans/${plan.planId}/mutations`,
      { cookie: guest.cookie },
      {
        clientRef: randomUUID(),
        baseRevision: plan.revision,
        operation: { type: "upsert", collection: "bookings", value: booking },
      }
    );
    expect([r.status, r.body.code]).toEqual([404, "PLAN_DOCUMENT_NOT_FOUND"]);
    const hidden = await asGuest("get", `/plans/${plan.planId}/documents/${secret.id}/file`, {
      cookie: guest.cookie,
    });
    expect(hidden.status).toBe(404);
  });

  it("ends a guest's access when federation is switched off, and mints at most five phone tokens", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    for (let n = 0; n < 5; n++)
      expect(
        (await asGuest("post", `/plans/${plan.planId}/pat`, { cookie: guest.cookie })).status
      ).toBe(201);
    const sixth = await asGuest("post", `/plans/${plan.planId}/pat`, { cookie: guest.cookie });
    expect([sixth.status, sixth.body.code]).toEqual([409, "PLAN_GUEST_PAT_LIMIT"]);
    mockState.current = "off";
    const off = await asGuest("get", `/plans/${plan.planId}`, { cookie: guest.cookie });
    mockState.current = "host";
    expect([off.status, off.body.code]).toEqual([401, "PLAN_GUEST_REVOKED"]);
  });

  it("opens no session for a join whose credential cannot be issued, and leaves the invitation usable", async () => {
    const plan = await newPlan();
    const s = await startOnly(plan);
    const vouched = await vouchAs(guestUser, s.inviteId, s.nonce);
    // The guest's server is unpinned between the vouch and the callback.
    await prisma.comparisonPeer.update({
      where: { origin: GUEST_SERVER },
      data: { enabled: false },
    });
    const refused = await complete(vouchOf(vouched.body.redirectUrl), s.joinCookie);
    await prisma.comparisonPeer.update({
      where: { origin: GUEST_SERVER },
      data: { enabled: true },
    });
    expect(refused.status).toBe(403);
    const member = await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: s.memberId } });
    expect(member.status).toBe("invited");
    expect((await complete(vouchOf(vouched.body.redirectUrl), s.joinCookie)).status).toBe(201);
  });

  it("caps the guests of one host at twenty", async () => {
    const plan = await newPlan();
    const filler = await newPlan();
    const existing = await prisma.travelPlanMember.count({
      where: { kind: "remote", status: { in: ["invited", "active"] } },
    });
    await prisma.travelPlanMember.createMany({
      data: Array.from({ length: Math.max(0, 20 - existing) }, (_, n) => ({
        planId: filler.planId,
        kind: "remote",
        remoteOrigin: GUEST_SERVER,
        remoteSubject: "f".repeat(60) + String(1000 + n),
        displayName: "filler",
        status: "invited",
      })),
    });
    const r = await call("post", `/trips/${plan.tripId}/plan/guests`, owner, {
      origin: GUEST_SERVER,
      username: "one too many",
    });
    expect([r.status, r.body.code]).toEqual([
      409,
      expect.stringMatching(/PLAN_GUEST_LIMIT|PLAN_MEMBER_LIMIT/),
    ]);
    await prisma.travelPlanMember.deleteMany({
      where: { planId: filler.planId, displayName: "filler" },
    });
  });
});

describe("TravPlan guest pairing by claim code (forgejo#404)", () => {
  const code = (plan: { planId: string }, cookie: string) =>
    asGuest("post", `/plans/${plan.planId}/pat/code`, { cookie });
  const claim = (planId: string, value: unknown) =>
    request(app).post(`/api/v1/guest/plans/${planId}/pat/claim`).send({ code: value });

  it("trades a minted code once for a phone token that opens the plan", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const minted = await code(plan, guest.cookie);
    expect(minted.status).toBe(201);
    expect(minted.body.code).toMatch(/^[A-Z2-9]{10}$/);
    const ttl = new Date(minted.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);
    // Only the hash is stored.
    expect(JSON.stringify(await prisma.travelPlanGuestClaim.findMany())).not.toContain(
      minted.body.code
    );
    const claimed = await claim(plan.planId, minted.body.code);
    expect(claimed.status).toBe(201);
    expect(claimed.body.token).toMatch(/^ts_gpat_/);
    expect(
      (await asGuest("get", `/plans/${plan.planId}`, { pat: claimed.body.token })).status
    ).toBe(200);
  });

  it("refuses a used code, an expired code, another plan's code and a wrong code with ONE answer", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const otherPlan = await newPlan();
    const used = (await code(plan, guest.cookie)).body.code as string;
    expect((await claim(plan.planId, used)).status).toBe(201);
    const expired = (await code(plan, guest.cookie)).body.code as string;
    await prisma.travelPlanGuestClaim.updateMany({
      where: { usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const fresh = (await code(plan, guest.cookie)).body.code as string;
    const answers = [
      await claim(plan.planId, used),
      await claim(plan.planId, expired),
      await claim(otherPlan.planId, fresh),
      await claim(plan.planId, "ZZZZZZZZZZ"),
      await claim(plan.planId, 42),
      await claim("not-a-uuid", fresh),
    ];
    for (const a of answers)
      expect([a.status, a.body.code]).toEqual([400, "PLAN_GUEST_CLAIM_INVALID"]);
    expect(new Set(answers.map((a) => a.body.error)).size).toBe(1);
    // The failed attempt with the wrong plan did not burn the code.
    expect((await claim(plan.planId, fresh)).status).toBe(201);
  });

  it("lets a code be redeemed only once under a race", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const c = (await code(plan, guest.cookie)).body.code as string;
    const results = await Promise.all([1, 2, 3].map(() => claim(plan.planId, c)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it("will not mint a code from a phone token", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const c = (await code(plan, guest.cookie)).body.code as string;
    const pat = (await claim(plan.planId, c)).body.token as string;
    const refused = await asGuest("post", `/plans/${plan.planId}/pat/code`, { pat });
    expect([refused.status, refused.body.code]).toEqual([403, "PLAN_GUEST_REQUIRED"]);
    const noCred = await request(app).post(`/api/v1/guest/plans/${plan.planId}/pat/code`);
    expect(noCred.status).toBe(401);
  });

  it("refuses the code of a guest who was removed in the meantime", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const c = (await code(plan, guest.cookie)).body.code as string;
    await call("delete", `/trips/${plan.tripId}/plan/members/${guest.memberId}`, owner);
    expect((await claim(plan.planId, c)).body.code).toBe("PLAN_GUEST_CLAIM_INVALID");
  });

  it("keeps the code when the phone token could not be issued (token limit)", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    for (let n = 0; n < 5; n++) {
      const c = (await code(plan, guest.cookie)).body.code as string;
      expect((await claim(plan.planId, c)).status).toBe(201);
    }
    const c = (await code(plan, guest.cookie)).body.code as string;
    expect((await claim(plan.planId, c)).body.code).toBe("PLAN_GUEST_PAT_LIMIT");
    await prisma.travelPlanGuestSession.deleteMany({
      where: { memberId: guest.memberId, kind: "pat" },
    });
    expect((await claim(plan.planId, c)).status).toBe(201);
  });

  it("retires an earlier unused code when a new one is minted", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const first = (await code(plan, guest.cookie)).body.code as string;
    const second = (await code(plan, guest.cookie)).body.code as string;
    expect((await claim(plan.planId, first)).status).toBe(400);
    expect((await claim(plan.planId, second)).status).toBe(201);
  });

  it("tells a revoked guest from an expired one, with distinct code and text", async () => {
    const plan = await newPlan();
    const expiring = await joinGuest(plan);
    await prisma.travelPlanGuestSession.updateMany({
      where: { memberId: expiring.memberId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await asGuest("get", `/plans/${plan.planId}`, { cookie: expiring.cookie });
    const removed = await joinGuest(plan, { username: "second", who: other });
    await call("delete", `/trips/${plan.tripId}/plan/members/${removed.memberId}`, owner);
    const revoked = await asGuest("get", `/plans/${plan.planId}`, { cookie: removed.cookie });
    expect([expired.status, expired.body.code]).toEqual([401, "PLAN_GUEST_EXPIRED"]);
    expect([revoked.status, revoked.body.code]).toEqual([401, "PLAN_GUEST_REVOKED"]);
    expect(expired.body.error).not.toBe(revoked.body.error);
  });

  it("reports host, owner, plan and the credential's expiry on the session", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const session = await asGuest("get", "/session", { cookie: guest.cookie });
    expect(session.body).toMatchObject({
      planName: "Guest trip",
      hostName: expect.any(String),
      ownerName: expect.stringContaining("guests-test-0"),
      credential: "session",
    });
    expect(new Date(session.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const c = (await code(plan, guest.cookie)).body.code as string;
    const pat = await claim(plan.planId, c);
    const asPhone = await asGuest("get", "/session", { pat: pat.body.token });
    expect(asPhone.body.expiresAt).toBe(pat.body.expiresAt);
  });

  it("replays a guest mutation with the same clientRef instead of applying it twice", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const read = await asGuest("get", `/plans/${plan.planId}`, { cookie: guest.cookie });
    const body = {
      clientRef: randomUUID(),
      baseRevision: read.body.revision,
      operation: idea("Once"),
    };
    const first = await asGuest(
      "post",
      `/plans/${plan.planId}/mutations`,
      { cookie: guest.cookie },
      body
    );
    const again = await asGuest(
      "post",
      `/plans/${plan.planId}/mutations`,
      { cookie: guest.cookie },
      body
    );
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body.revision).toBe(first.body.revision);
    expect(again.body.state.ideas).toHaveLength(1);
  });
});

describe("TravPlan plan documents (D6)", () => {
  const text = (label: string) => Buffer.from(`plan document ${label} ${randomUUID()}`);
  const upload = (planId: string, cred: { cookie: string }, name: string, buf = text(name)) =>
    request(app)
      .post(`/api/v1/guest/plans/${planId}/documents`)
      .set("Cookie", "ts_guest=" + cred.cookie)
      .set("X-TravStats-Guest", "1")
      .attach("file", buf, { filename: name, contentType: "text/plain" });

  it("shows a guest the documents uploaded for the plan, labelled, and nothing else of the trip", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    // The owner's private document on the same trip.
    const secret = await prisma.document.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        storedName: "private-" + randomUUID() + ".txt",
        originalName: "passport-scan.txt",
        mimetype: "text/plain",
        sizeBytes: 3,
        sha256: hash(randomUUID()),
        format: "text",
      },
    });
    const up = await upload(plan.planId, guest, "tickets.txt");
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      displayName: "tickets.txt",
      uploadedBy: { memberId: guest.memberId },
    });
    const list = await asGuest("get", `/plans/${plan.planId}/documents`, { cookie: guest.cookie });
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([up.body.id]);
    const file = await asGuest("get", `/plans/${plan.planId}/documents/${up.body.id}/file`, {
      cookie: guest.cookie,
    });
    expect(file.status).toBe(200);
    const hidden = await asGuest("get", `/plans/${plan.planId}/documents/${secret.id}/file`, {
      cookie: guest.cookie,
    });
    expect([hidden.status, hidden.body.code]).toEqual([404, "PLAN_DOCUMENT_NOT_FOUND"]);
    // The owner sees both on the trip, the upload labelled with the guest.
    const ownerList = await call("get", `/trips/${plan.tripId}/plan/documents`, owner);
    expect(ownerList.body.documents.map((d: { id: string }) => d.id).sort()).toEqual(
      [up.body.id, secret.id].sort()
    );
  });

  it("answers bytes equal to a private owner document exactly like a new file, and exposes nothing", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const bytes = text("same");
    const mine = await request(app)
      .post(`/api/v1/trips/${plan.tripId}/plan/documents`)
      .set("Cookie", userCookie(owner))
      .attach("file", bytes, { filename: "own.txt", contentType: "text/plain" });
    expect(mine.status).toBe(201);
    // Now it is the owner's private document: no plan row.
    await prisma.travelPlanDocument.deleteMany({ where: { documentId: mine.body.id } });
    const fresh = await upload(plan.planId, guest, "new.txt");
    const same = await upload(plan.planId, guest, "copy.txt", bytes);
    expect(same.status).toBe(fresh.status);
    expect(Object.keys(same.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(same.body.id).not.toBe(mine.body.id);
    expect(same.body.uploadedBy).toMatchObject({ memberId: guest.memberId });
    const list = await asGuest("get", `/plans/${plan.planId}/documents`, { cookie: guest.cookie });
    expect(list.body.documents.map((d: { id: string }) => d.id).sort()).toEqual(
      [fresh.body.id, same.body.id].sort()
    );
    // The owner's own row is untouched and still hidden from the guest.
    const hidden = await asGuest("get", `/plans/${plan.planId}/documents/${mine.body.id}/file`, {
      cookie: guest.cookie,
    });
    expect(hidden.status).toBe(404);
    // A wrong declared type gets the same answer whether or not the owner holds those bytes.
    const wrong = (planId: string, buf: Buffer) =>
      request(app)
        .post(`/api/v1/guest/plans/${planId}/documents`)
        .set("Cookie", "ts_guest=" + guest.cookie)
        .set("X-TravStats-Guest", "1")
        .field("format", "pdf")
        .attach("file", buf, { filename: "x.exe", contentType: "application/x-msdownload" });
    const held = text("held");
    const heldOwn = await request(app)
      .post(`/api/v1/trips/${plan.tripId}/plan/documents`)
      .set("Cookie", userCookie(owner))
      .attach("file", held, { filename: "held.txt", contentType: "text/plain" });
    await prisma.travelPlanDocument.deleteMany({ where: { documentId: heldOwn.body.id } });
    const wrongNew = await wrong(plan.planId, text("fresh"));
    const wrongSame = await wrong(plan.planId, held);
    expect(wrongSame.status).toBe(wrongNew.status);
    expect(wrongSame.body).toEqual(wrongNew.body);
    // A real repeat by the same member is answered with their existing document.
    const repeat = await upload(plan.planId, guest, "copy.txt", bytes);
    expect(repeat.body.id).toBe(same.body.id);
  });

  it("stops a guest at fifty documents on one plan", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const docs = await Promise.all(
      Array.from({ length: 50 }, (_, n) =>
        prisma.document.create({
          data: {
            userId: owner,
            tripId: plan.tripId,
            storedName: "filler-" + randomUUID() + ".txt",
            mimetype: "text/plain",
            sizeBytes: 1,
            sha256: hash("filler" + n + randomUUID()),
            format: "text",
          },
        })
      )
    );
    await prisma.travelPlanDocument.createMany({
      data: docs.map((d) => ({
        planId: plan.planId,
        documentId: d.id,
        uploadedByMemberId: guest.memberId,
      })),
    });
    const r = await upload(plan.planId, guest, "fifty-one.txt");
    expect([r.status, r.body.code]).toEqual([409, "PLAN_DOCUMENT_LIMIT"]);
  });

  it("shows a co-planner on this server only the plan's documents, never the owner's other ones", async () => {
    const plan = await newPlan();
    for (const [a, b] of [
      [owner, other],
      [other, owner],
    ])
      await prisma.shareConsent.upsert({
        where: { requesterId_targetId: { requesterId: a, targetId: b } },
        create: { requesterId: a, targetId: b, status: "accepted", decidedAt: new Date() },
        update: { status: "accepted" },
      });
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: other } })).username;
    const invited = await call("post", `/trips/${plan.tripId}/plan/members`, owner, {
      username: name,
    });
    await call("post", `/travplan/invitations/${invited.body.id}/accept`, other);
    const secret = await prisma.document.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        storedName: "private-" + randomUUID() + ".txt",
        mimetype: "text/plain",
        sizeBytes: 3,
        sha256: hash(randomUUID()),
        format: "text",
      },
    });
    const up = await request(app)
      .post(`/api/v1/trips/${plan.tripId}/plan/documents`)
      .set("Cookie", userCookie(other))
      .attach("file", text("local"), { filename: "route.txt", contentType: "text/plain" });
    expect(up.status).toBe(201);
    expect(up.body.uploadedBy).toMatchObject({ displayName: name });
    const list = await call("get", `/trips/${plan.tripId}/plan/documents`, other);
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([up.body.id]);
    const hidden = await call(
      "get",
      `/trips/${plan.tripId}/plan/documents/${secret.id}/file`,
      other
    );
    expect([hidden.status, hidden.body.code]).toEqual([404, "PLAN_DOCUMENT_NOT_FOUND"]);
    expect((await call("get", `/trips/${plan.tripId}/plan/documents`, guestUser)).status).toBe(404);
  });

  it("shows a document attached to a booking to a guest, and hides one the guest never uploaded", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const doc = await prisma.document.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        storedName: "booked-" + randomUUID() + ".txt",
        originalName: "booking.txt",
        mimetype: "text/plain",
        sizeBytes: 1,
        sha256: hash(randomUUID()),
        format: "text",
      },
    });
    const bookingId = randomUUID();
    const row = await prisma.travelPlan.findUniqueOrThrow({ where: { id: plan.planId } });
    const state = row.state as { bookings: unknown[] };
    await prisma.travelPlan.update({
      where: { id: plan.planId },
      data: {
        state: {
          ...(state as object),
          bookings: [
            bookingSchema.parse({
              id: bookingId,
              kind: "hotel",
              title: "Hotel",
              reference: null,
              provider: "",
              day: null,
              endDay: null,
              time: null,
              timezone: null,
              amount: null,
              paid: 0,
              currency: "EUR",
              place: "",
              documentIds: [doc.id],
              source: "",
              details: {},
            }),
          ],
        } as never,
      },
    });
    const list = await asGuest("get", `/plans/${plan.planId}/documents`, { cookie: guest.cookie });
    expect(list.body.documents).toEqual([
      expect.objectContaining({ id: doc.id, attached: true, uploadedBy: null }),
    ]);
  });

  const exportOf = (planId: string, cookie: string) =>
    request(app)
      .get(`/api/v1/guest/plans/${planId}/export`)
      .set("Cookie", "ts_guest=" + cookie)
      .set("X-TravStats-Guest", "1")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });

  it("gives a guest the trip's roadtrip as a version 4 file, without the owner's private fields", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    const route = await prisma.tripRoute.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        kind: "roadtrip",
        name: "Inselrunde",
        mode: "road",
        notes: "PRIVATE-ROUTE-NOTE",
      },
    });
    await prisma.tripStop.create({
      data: {
        routeId: route.id,
        routeOrderIdx: 0,
        title: "Funchal",
        lat: 32.65,
        lon: -16.9,
        notes: "PRIVATE-STOP-NOTE",
      },
    });
    // An unrelated flight of the owner's on the same trip, with a booking and a price.
    const booking = await prisma.booking.create({
      data: { userId: owner, tripId: plan.tripId, pnr: "PNR-SECRET", price: 4321, currency: "EUR" },
    });
    await prisma.flight.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        bookingId: booking.id,
        flightNumber: "XY999",
        airline: "Secret Air",
        depIata: "FRA",
        depLat: 50,
        depLon: 8,
        arrIata: "FNC",
        arrLat: 32.7,
        arrLon: -16.7,
        departureTime: new Date("2027-03-10T08:00:00Z"),
        arrivalTime: new Date("2027-03-10T12:00:00Z"),
        price: 1234.5,
        bookingReference: "BOOKREF-SECRET",
        seatNumber: "12A",
      },
    });
    await prisma.tripJournalEntry.create({
      data: { tripId: plan.tripId, date: new Date(), body: "PRIVATE-JOURNAL" },
    });
    const res = await exportOf(plan.planId, guest.cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(".travstats");
    const archive = readTripArchive(res.body as Buffer);
    expect(archive.manifest.formatVersion).toBe(4);
    expect(archive.file.roadtrips.map((r) => r.name)).toEqual(["Inselrunde"]);
    expect(archive.file.roadtrips[0].stations.map((s) => s.title)).toEqual(["Funchal"]);
    expect(JSON.stringify(archive.file)).not.toContain("PRIVATE");
    // Nothing of the unrelated flight or its booking reaches the guest.
    expect(archive.file.flights).toEqual([]);
    expect(archive.file.bookings).toEqual([]);
    const text = JSON.stringify(archive.file);
    for (const secret of [
      "PNR-SECRET",
      "BOOKREF-SECRET",
      "XY999",
      "Secret Air",
      "4321",
      "1234.5",
      "12A",
    ])
      expect(text).not.toContain(secret);
  });

  it("gives a revoked guest no file, whether the credential is gone or only the membership ended", async () => {
    const plan = await newPlan();
    const guest = await joinGuest(plan);
    // Membership ended while the credential is still around (a request racing the revocation).
    await prisma.travelPlanMember.update({
      where: { id: guest.memberId },
      data: { status: "revoked" },
    });
    // The guest door answers an ended access with its one code (401 PLAN_GUEST_REQUIRED), as for the plan itself.
    expect((await exportOf(plan.planId, guest.cookie)).status).toBe(401);
    // The owner's removal also deletes the credential.
    const second = await joinGuest(plan, { username: "second", who: other });
    await call("delete", `/trips/${plan.tripId}/plan/members/${second.memberId}`, owner);
    expect((await exportOf(plan.planId, second.cookie)).status).toBe(401);
  });

  it("refuses the export to a credential of another plan, and once the guest has left", async () => {
    const plan = await newPlan();
    const other = await newPlan();
    const guest = await joinGuest(plan);
    expect((await exportOf(other.planId, guest.cookie)).status).toBe(404);
    expect((await asGuest("post", "/leave", { cookie: guest.cookie })).status).toBe(200);
    expect((await exportOf(plan.planId, guest.cookie)).status).toBeGreaterThanOrEqual(401);
  });
});
