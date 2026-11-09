#!/usr/bin/env node
/**
 * Two-instance friends/federation walk-through (forgejo#416), driven by API with cookie auth.
 * Flow: invite link -> server admission -> redeem -> inviter confirms -> connection active ->
 * compare -> share a trip (linked copy arrives) -> plan invite; then a forwarded link: a third
 * user redeems, the inviter declines, the link is burnt.
 *
 *   S1_URL=http://<lan-ip>:8010 S2_URL=http://<lan-ip>:8011 node scripts/e2e/friends-federation.mjs
 *
 * Both backends must run fresh databases, COOKIE_SECURE=false and FEDERATION_PRIVATE_PEERS
 * covering the host the two URLs name (loopback is never allowed as a peer). The URLs are the
 * origins the servers announce to each other, so they must be reachable from both processes.
 */
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";

const S1 = process.env.S1_URL;
const S2 = process.env.S2_URL;
if (!S1 || !S2) throw new Error("Set S1_URL and S2_URL");
const PASSWORD = "e2e-Passw0rd-123";

let failed = 0;
const step = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
};

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = "";
  }
  async call(method, path, body) {
    const res = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    const auth = set.map((c) => c.split(";")[0]).filter((c) => c.startsWith("auth_token="));
    if (auth.length) this.cookie = auth[auth.length - 1];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json ?? text };
  }
}
const data = (r) =>
  r.body && typeof r.body === "object" && "data" in r.body ? r.body.data : r.body;

async function makeAdmin(c, name) {
  const r = await c.call("POST", "/setup/initialize", {
    username: name,
    password: PASSWORD,
    allowRegistration: true,
  });
  if (r.status >= 300) throw new Error(`initialize ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  if (!c.cookie) {
    const l = await c.call("POST", "/auth/login", { username: name, password: PASSWORD });
    if (l.status >= 300) throw new Error(`login ${name}: ${l.status}`);
  }
}
async function makeUser(c, name) {
  const r = await c.call("POST", "/auth/register", { username: name, password: PASSWORD });
  if (r.status >= 300) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  if (!c.cookie) await c.call("POST", "/auth/login", { username: name, password: PASSWORD });
}
const flight = (n, dep, arr) => ({
  flightNumber: n,
  departure: dep,
  arrival: arr,
  departureLocal: "2025-05-08T13:00",
  arrivalLocal: "2025-05-08T17:00",
  depTimezone: "Europe/Lisbon",
  arrTimezone: "Europe/Berlin",
});
const LIS = { iata: "LIS", lat: 38.7742, lon: -9.1342 };
const FRA = { iata: "FRA", lat: 50.0379, lon: 8.5622 };

const tag = Date.now().toString(36);
const adm1 = new Client(S1),
  adm2 = new Client(S2),
  a = new Client(S1),
  b = new Client(S2);
await makeAdmin(adm1, `adm1${tag}`);
await makeAdmin(adm2, `adm2${tag}`);
await makeUser(a, `alice${tag}`);
await makeUser(b, `bob${tag}`);

for (const [c, n, dep, arr] of [
  [a, "AL1", LIS, FRA],
  [b, "BO1", FRA, LIS],
]) {
  const r = await c.call("POST", "/flights", flight(n, dep, arr));
  if (r.status !== 201) throw new Error(`flight: ${r.status} ${JSON.stringify(r.body)}`);
}
for (const c of [adm1, adm2]) {
  const r = await c.call("PUT", "/admin/instance-settings", { betaFeaturesEnabled: true });
  if (r.status >= 300) throw new Error(`instance-settings: ${r.status} ${JSON.stringify(r.body)}`);
  const t = await c.call("PUT", "/admin/federation/trip-sharing", { enabled: true });
  if (t.status >= 300) throw new Error(`trip-sharing: ${t.status} ${JSON.stringify(t.body)}`);
}
for (const [c, origin, n] of [
  [adm1, S1, 1],
  [adm2, S2, 2],
]) {
  const r = await c.call("PUT", "/admin/federation", { enabled: true, origin });
  step(
    `S${n} admin switches federation on (key generated)`,
    r.status === 200 && r.body.hasKey && r.body.enabled,
    JSON.stringify(r.body)
  );
}

const SCOPE = {
  groups: ["distance", "trips", "time", "places", "achievements"],
  domains: ["flight"],
  year: null,
};
const SWITCHES = {
  plans: true,
  stats: "overview",
  achievements: true,
  leaderboard: true,
  tripOffers: true,
};
const fragmentOf = (url) => url.slice(url.indexOf("#") + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// S2's delivery job asks S1 again once per minute with backoff (1, 2, 4 min): wait for it.
const waitFor = async (fn, ms = 6 * 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(3000);
  }
  return null;
};
const friendsOf = async (c) => data(await c.call("GET", "/friends"));

// 1. Invite link (v2, carries the inviter's switches) -> redeem -> server admission.
const inv = await a.call("POST", "/comparison/invite-links", { switches: SWITCHES });
step(
  "A creates an invite link (201)",
  inv.status === 201 && Boolean(data(inv)?.url),
  JSON.stringify(inv.body)
);
const link = fragmentOf(data(inv).url);
step(
  "the link is a v2 payload with the inviter's switches",
  (() => {
    const p = JSON.parse(Buffer.from(link, "base64url").toString());
    return p.v === 2 && p.switches?.plans === true;
  })()
);

const redeem = await b.call("POST", "/comparison/invite-links/redeem", {
  payload: link,
  scope: SCOPE,
  switches: SWITCHES,
});
step(
  "B redeems on S2 -> awaitingAdmin",
  redeem.status < 300 && data(redeem)?.status === "awaitingAdmin",
  `${redeem.status} ${JSON.stringify(redeem.body)}`
);
const again = await b.call("POST", "/comparison/invite-links/redeem", {
  payload: link,
  scope: SCOPE,
  switches: SWITCHES,
});
step(
  "same link again while pending -> answers the open request (idempotent)",
  again.status === 200 && data(again)?.status === "awaitingAdmin",
  `${again.status} ${JSON.stringify(again.body)}`
);
const own2 = (await friendsOf(b)).admissions ?? [];
step("B's /friends lists the open admission", own2.length === 1, JSON.stringify(own2));

const list2 = (await adm2.call("GET", "/admin/federation/admissions")).body.admissions ?? [];
const out = list2.find((x) => x.direction === "outgoing" && x.status === "pending");
step("S2 admin sees the outgoing request", Boolean(out), JSON.stringify(list2));
const ap2 = await adm2.call("POST", `/admin/federation/admissions/${out?.id}/approve`, {});
step("S2 admin approves", ap2.status < 300, `${ap2.status} ${JSON.stringify(ap2.body)}`);
await sleep(1500);
const list1 = (await adm1.call("GET", "/admin/federation/admissions")).body.admissions ?? [];
const inc = list1.find((x) => x.direction === "incoming" && x.status === "pending");
step("S1 gets an incoming request", Boolean(inc), JSON.stringify(list1));
const ap1 = await adm1.call("POST", `/admin/federation/admissions/${inc?.id}/approve`, {});
step("S1 admin approves", ap1.status < 300, `${ap1.status} ${JSON.stringify(ap1.body)}`);

// 2. The redeem lands as a request A confirms; nothing is active before.
const reqA = await waitFor(async () =>
  (await friendsOf(a)).requests.find((x) => x.username === `bob${tag}`)
);
step(
  "A sees B's request (via the link, with a fingerprint)",
  Boolean(reqA?.viaLink && reqA.fingerprint),
  JSON.stringify(reqA)
);
step(
  "the request carries what B offers and what A chose on the link",
  reqA?.switches?.plans === true && reqA?.proposed?.plans === true,
  JSON.stringify(reqA)
);
step("nothing is a friend yet", (await friendsOf(a)).friends.length === 0);
const accept = await a.call("POST", `/friends/${encodeURIComponent(reqA?.key)}/accept`, {
  switches: SWITCHES,
});
step("A confirms", accept.status < 300, `${accept.status} ${JSON.stringify(accept.body)}`);
const activeA = (await friendsOf(a)).friends.find((x) => x.username === `bob${tag}`);
step("A: the connection is active", activeA?.state === "active", JSON.stringify(activeA));
const activeB = await waitFor(
  async () =>
    (await friendsOf(b)).friends.find((x) => x.username === `alice${tag}` && x.state === "active"),
  60_000
);
step("B: the connection is active", Boolean(activeB));
step(
  "B's friend row carries a connectionId and the directional switches",
  Boolean(activeB?.connectionId) &&
    activeB?.theirs?.plans === true &&
    activeB?.mine?.plans === true,
  JSON.stringify(activeB)
);

// 3. Compare with achievements, both ways, under the friend's key.
for (const [who, c, f, other] of [
  ["B", b, activeB, "alice"],
  ["A", a, activeA, "bob"],
]) {
  const r = await c.call(
    "GET",
    `/comparison/compare?year=all&friends=${encodeURIComponent(f?.key)}`
  );
  const entry = (data(r)?.friends ?? []).find((x) => x.person?.key === f?.key);
  step(
    `${who}'s compare shows ${other}'s stats`,
    r.status === 200 && entry?.status === "ok" && entry.snapshot?.metrics?.flights === 1,
    `${r.status} ${JSON.stringify(entry)?.slice(0, 300)}`
  );
  step(
    `${who}'s compare has ${other}'s achievements`,
    (entry?.snapshot?.achievements?.items ?? []).some(
      (i) => i.code === "FIRST_FLIGHT" && i.unlocked
    ),
    JSON.stringify(entry?.snapshot?.achievements)?.slice(0, 200)
  );
}

// 4. Share a trip: A offers, B accepts, the linked copy arrives on S2.
const trip = await a.call("POST", "/trips", {
  name: `Lisbon ${tag}`,
  startDate: "2025-05-08",
  endDate: "2025-05-12",
});
const tripId = trip.body?.trip?.id ?? data(trip)?.id;
step(
  "A creates a trip",
  trip.status === 201 && Boolean(tripId),
  `${trip.status} ${JSON.stringify(trip.body)}`
);
const offer = await a.call("POST", `/sharing/remote/trips/${tripId}/offers`, {
  remoteId: activeA?.connectionId,
});
step(
  "A offers the trip to B by connection id",
  offer.status === 201,
  `${offer.status} ${JSON.stringify(offer.body)}`
);
const offerB = await waitFor(async () => {
  const o = data(await b.call("GET", "/sharing/remote/offers"));
  return (Array.isArray(o) ? o : (o?.offers ?? [])).find((x) =>
    JSON.stringify(x).includes(`Lisbon ${tag}`)
  );
}, 120_000);
step("B receives the offer", Boolean(offerB), "no offer");
if (offerB) {
  const acc = await b.call("POST", `/sharing/remote/offers/${offerB.id}/accept`, {});
  step("B accepts the offer", acc.status < 300, `${acc.status} ${JSON.stringify(acc.body)}`);
}
const copy = await waitFor(async () => {
  const t = data(await b.call("GET", `/friends/${encodeURIComponent(activeB?.key)}/trips`));
  return (t?.fromThem ?? []).find((x) => x.copyState === "linked" && x.localTripId);
}, 120_000);
step(
  "B: the linked copy arrives (copyState linked, localTripId set)",
  Boolean(copy),
  JSON.stringify(copy)
);
const mine = data(await a.call("GET", `/friends/${encodeURIComponent(activeA?.key)}/trips`));
step("A: the trip shows under 'to them'", (mine?.toThem ?? []).length === 1, JSON.stringify(mine));

// 5. Plan invite over the connection (TravPlan is a per-account switch).
for (const c of [adm1, adm2]) {
  const r = await c.call("PATCH", "/travplan/config", { enabled: true });
  if (r.status >= 300) throw new Error(`travplan config: ${r.status} ${JSON.stringify(r.body)}`);
}
for (const c of [a, b]) {
  const r = await c.call("PUT", "/settings", { travPlan: { enabled: true } });
  if (r.status >= 300) throw new Error(`travPlan switch: ${r.status} ${JSON.stringify(r.body)}`);
}
const plan = await a.call("POST", "/travplan/plans", {
  name: `Plan ${tag}`,
  settings: {},
  tripId,
  clientRef: randomUUID(),
});
step(
  "A creates a plan on the trip",
  plan.status < 300,
  `${plan.status} ${JSON.stringify(plan.body).slice(0, 300)}`
);
const conns = await a.call("GET", `/trips/${tripId}/plan/members/connections`);
step(
  "A can invite B into the plan (plans on at both sides)",
  JSON.stringify(data(conns) ?? conns.body).includes(activeA?.connectionId),
  `${conns.status} ${JSON.stringify(conns.body)}`
);
const planInvite = await a.call("POST", `/trips/${tripId}/plan/members`, {
  connectionId: activeA?.connectionId,
});
step(
  "A invites B into the plan",
  planInvite.status === 201,
  `${planInvite.status} ${JSON.stringify(planInvite.body)}`
);
const plansA = await waitFor(async () => {
  const p = data(await a.call("GET", `/friends/${encodeURIComponent(activeA?.key)}/plans`));
  return (p?.plans ?? []).length ? p.plans : null;
}, 60_000);
step(
  "A: the plan shows under /friends/:key/plans (owner me)",
  plansA?.[0]?.owner === "me",
  JSON.stringify(plansA)
);

// 6. Used link and forged key.
const third = await b.call("POST", "/comparison/invite-links/redeem", {
  payload: link,
  scope: SCOPE,
});
step(
  "redeeming the used link again -> refused",
  third.status >= 400,
  `${third.status} ${JSON.stringify(third.body)}`
);

// 7. Forwarded link: a third user on S2 redeems A's new link, A declines, the link is burnt.
const fwd = data(await a.call("POST", "/comparison/invite-links", { switches: SWITCHES }));
const fwdLink = fragmentOf(fwd.url);
const carol = new Client(S2);
await makeUser(carol, `carol${tag}`);
const cr = await carol.call("POST", "/comparison/invite-links/redeem", {
  payload: fwdLink,
  scope: SCOPE,
  switches: SWITCHES,
});
step("carol (forwarded link) redeems", cr.status < 300, `${cr.status} ${JSON.stringify(cr.body)}`);
const reqC = await waitFor(
  async () => (await friendsOf(a)).requests.find((x) => x.username === `carol${tag}`),
  90_000
);
step("A sees carol's request", Boolean(reqC?.viaLink), JSON.stringify(reqC));
const declined = await a.call("POST", `/friends/${encodeURIComponent(reqC?.key)}/decline`, {});
step(
  "A declines -> {declined:true}",
  declined.status < 300 && data(declined)?.declined === true,
  `${declined.status} ${JSON.stringify(declined.body)}`
);
const afterA = await friendsOf(a);
step(
  "carol is gone from A's friends and requests",
  ![...afterA.friends, ...afterA.requests].some((x) => x.username === `carol${tag}`),
  JSON.stringify(afterA)
);
const dave = new Client(S2);
await makeUser(dave, `dave${tag}`);
const dr = await dave.call("POST", "/comparison/invite-links/redeem", {
  payload: fwdLink,
  scope: SCOPE,
  switches: SWITCHES,
});
let burnt = dr.status >= 400;
if (!burnt) {
  await sleep(70_000);
  const afterD = await friendsOf(a);
  burnt = ![...afterD.friends, ...afterD.requests].some((x) => x.username === `dave${tag}`);
}
step(
  "the declined link is burnt: dave cannot use it",
  burnt,
  `${dr.status} ${JSON.stringify(dr.body)}`
);

// 8. A friend can be removed through /friends (never the comparison endpoint).
const rm = await b.call("DELETE", `/friends/${encodeURIComponent(activeB?.key)}`);
step(
  "B removes A -> {removed:true}",
  rm.status < 300 && data(rm)?.removed === true,
  `${rm.status} ${JSON.stringify(rm.body)}`
);
step(
  "B no longer lists A",
  !(await friendsOf(b)).friends.some((x) => x.username === `alice${tag}` && x.state === "active")
);

// 9. A link whose key is not the one the server publishes (consistent forged keypair, valid fingerprint).

const forged = (() => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const fp = createHash("sha256")
    .update(publicKey.export({ format: "pem", type: "spki" }))
    .digest("hex");
  return { raw: raw.toString("base64url"), fp };
})();
const inv2 = data(await a.call("POST", "/comparison/invite-links", {}));
const p2 = JSON.parse(Buffer.from(fragmentOf(inv2.url), "base64url").toString());
p2.publicKey = forged.raw;
p2.fingerprint = forged.fp;
const tampered = Buffer.from(JSON.stringify(p2)).toString("base64url");
const erin = new Client(S2);
await makeUser(erin, `erin${tag}`);
const tr = await erin.call("POST", "/comparison/invite-links/redeem", {
  payload: tampered,
  scope: SCOPE,
});
let code = tr.body?.code;
if (tr.status < 300) {
  const l = (await adm2.call("GET", "/admin/federation/admissions")).body.admissions ?? [];
  const o = l.find((x) => x.direction === "outgoing" && x.status === "pending");
  const ap = await adm2.call("POST", `/admin/federation/admissions/${o?.id}/approve`, {});
  code = ap.body?.code;
}
step(
  "tampered fingerprint -> FEDERATION_ADMISSION_KEY_MISMATCH",
  code === "FEDERATION_ADMISSION_KEY_MISMATCH",
  String(code)
);

console.log(failed ? `\n${failed} step(s) FAILED` : "\nall steps passed");
process.exit(failed ? 1 : 0);
