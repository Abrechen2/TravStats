#!/usr/bin/env node
/**
 * Two-instance friends/federation walk-through (forgejo#416), driven by API with cookie auth.
 *
 *   S1_URL=http://<lan-ip>:8010 S2_URL=http://<lan-ip>:8011 node scripts/e2e/friends-federation.mjs
 *
 * Both backends must run fresh databases, COOKIE_SECURE=false and FEDERATION_PRIVATE_PEERS
 * covering the host the two URLs name (loopback is never allowed as a peer). The URLs are the
 * origins the servers announce to each other, so they must be reachable from both processes.
 */
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
const f1 = (await adm1.call("GET", "/admin/federation")).body;
const f2 = (await adm2.call("GET", "/admin/federation")).body;

const SCOPE = {
  groups: ["distance", "trips", "time", "places", "achievements"],
  domains: ["flight"],
  year: null,
};
const fragmentOf = (url) => url.slice(url.indexOf("#") + 1);

const inv = await a.call("POST", "/comparison/invite-links", {});
step(
  "A creates an invite link (201)",
  inv.status === 201 && Boolean(data(inv)?.url),
  JSON.stringify(inv.body)
);
const link = fragmentOf(data(inv).url);

const redeem = await b.call("POST", "/comparison/invite-links/redeem", {
  payload: link,
  scope: SCOPE,
});
step(
  "B redeems on S2 -> awaitingAdmin",
  redeem.status < 300 && data(redeem)?.status === "awaitingAdmin",
  `${redeem.status} ${JSON.stringify(redeem.body)}`
);
const again = await b.call("POST", "/comparison/invite-links/redeem", {
  payload: link,
  scope: SCOPE,
});
step(
  "same link again while pending -> answers the open request (idempotent)",
  again.status === 200 && data(again)?.status === "awaitingAdmin",
  `${again.status} ${JSON.stringify(again.body)}`
);

const list2 = (await adm2.call("GET", "/admin/federation/admissions")).body.admissions ?? [];
const out = list2.find((x) => x.direction === "outgoing" && x.status === "pending");
step("S2 admin sees the outgoing request", Boolean(out), JSON.stringify(list2));
const ap2 = await adm2.call("POST", `/admin/federation/admissions/${out?.id}/approve`, {});
step("S2 admin approves", ap2.status < 300, `${ap2.status} ${JSON.stringify(ap2.body)}`);

await new Promise((r) => setTimeout(r, 1500));
const list1 = (await adm1.call("GET", "/admin/federation/admissions")).body.admissions ?? [];
const inc = list1.find((x) => x.direction === "incoming" && x.status === "pending");
step("S1 gets an incoming request", Boolean(inc), JSON.stringify(list1));
const ap1 = await adm1.call("POST", `/admin/federation/admissions/${inc?.id}/approve`, {});
step("S1 admin approves", ap1.status < 300, `${ap1.status} ${JSON.stringify(ap1.body)}`);

// S2's delivery job asks S1 again once per minute with backoff (1, 2, 4 min): wait for it.
const waitFor = async (what, fn, ms = 6 * 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
};
const reqA = await waitFor("request", async () => {
  const pa = data(await a.call("GET", "/comparison/people"));
  return (pa.requests ?? []).find((x) => JSON.stringify(x).includes(`bob${tag}`));
});
step("A sees B's request", Boolean(reqA));
console.log("request:", JSON.stringify(reqA));
const accept = await a.call("POST", `/comparison/consents/${reqA?.consentId}/accept`, {
  scope: SCOPE,
});
step("A accepts", accept.status < 300, `${accept.status} ${JSON.stringify(accept.body)}`);

const peopleB = data(await b.call("GET", "/comparison/people"));
console.log("people(B):", JSON.stringify(peopleB).slice(0, 700));
const peopleA = data(await a.call("GET", "/comparison/people"));
console.log("people(A):", JSON.stringify(peopleA).slice(0, 700));
const keyOf = (ppl, name) =>
  (ppl.people ?? []).find((p) => JSON.stringify(p).includes(name))?.person?.key;
const keyA = keyOf(peopleB, `alice${tag}`);
const keyB = keyOf(peopleA, `bob${tag}`);
for (const [who, c, key, other] of [
  ["B", b, keyA, "alice"],
  ["A", a, keyB, "bob"],
]) {
  if (!key) {
    step(`${who}'s compare shows ${other}`, false, "no person key");
    continue;
  }
  const r = await c.call("GET", `/comparison/compare?year=all&friends=${encodeURIComponent(key)}`);
  const body = data(r);
  console.log(
    `compare(${who}) keys:`,
    Object.keys(body ?? {}),
    "friend:",
    JSON.stringify(
      (body?.friends ?? []).map((f) => ({
        k: f.person?.key,
        st: f.status,
        m: f.snapshot?.metrics,
        ach: f.snapshot?.achievements?.items?.length,
      }))
    )
  );
  const entry = (body?.friends ?? []).find((f) => f.person?.key === key);
  step(
    `${who}'s compare shows ${other}'s stats`,
    r.status === 200 && entry?.status === "ok" && entry.snapshot?.metrics?.flights === 1,
    `${r.status} ${JSON.stringify(entry)?.slice(0, 300)}`
  );
  step(
    `${who}'s compare has ${other}'s achievements section`,
    (entry?.snapshot?.achievements?.items ?? []).some(
      (i) => i.code === "FIRST_FLIGHT" && i.unlocked
    ),
    JSON.stringify(entry?.snapshot?.achievements)?.slice(0, 200)
  );
}

// Same link again after the friendship exists: the token is spent.
const third = await b.call("POST", "/comparison/invite-links/redeem", {
  payload: link,
  scope: SCOPE,
});
step(
  "redeeming the used link again -> refused",
  third.status >= 400,
  `${third.status} ${JSON.stringify(third.body)}`
);

// A link whose key is not the one the server publishes (consistent forged keypair, valid fingerprint).
import { generateKeyPairSync, createHash } from "node:crypto";
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
const c2 = new Client(S2);
await makeUser(c2, `carol${tag}`);
const tr = await c2.call("POST", "/comparison/invite-links/redeem", {
  payload: tampered,
  scope: SCOPE,
});
console.log("tampered redeem:", tr.status, JSON.stringify(tr.body).slice(0, 200));
let code = tr.body?.code;
if (tr.status < 300) {
  // S2 already pins S1 now, so this is refused at redeem; otherwise the admin's approve says so.
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
