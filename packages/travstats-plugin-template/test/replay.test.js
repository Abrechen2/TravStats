"use strict";
/**
 * Replays signed requests against the template, as TravStats sends them: the
 * fixture vector of the guide, a real round trip, and every refusal (bad
 * signature, stale timestamp, replayed request id).
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { sign } = require("../src/verify");
const { createServer } = require("../src/server");

const SECRET = "test-secret-0123456789abcdef0123456789";
const places = require("../data/places.example.json");

test("the guide's fixture vector", () => {
  assert.strictEqual(
    sign(SECRET, {
      method: "POST",
      path: "/hooks/travstats?x=1",
      timestamp: 1763900000,
      requestId: "0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10",
      body: '{"version":1}',
    }),
    "v1=c1611e231a9667ee0bc0a11707bb4d8c49791ed150df97a7794e552469b68c2a"
  );
});

function request(
  port,
  { path = "/", body = "", secret = SECRET, timestamp, requestId, method = "POST" }
) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const id = requestId ?? crypto.randomUUID();
  const headers = {
    "TravStats-Plugin-Version": "1",
    "TravStats-Timestamp": String(ts),
    "TravStats-Request-Id": id,
    "TravStats-Signature": sign(secret, { method, path, timestamp: ts, requestId: id, body }),
    ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
  };
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
}

const stopBody = (requestId, lat = 48.137, lon = 11.575) =>
  JSON.stringify({
    version: 1,
    kind: "stop",
    requestId,
    stop: {
      start: "2026-01-15T10:00:00.000Z",
      end: "2026-01-15T11:00:00.000Z",
      timeZone: "Europe/Berlin",
      lat,
      lon,
      precisionMeters: 100,
    },
    locale: "de",
  });

test("a signed stop is answered; refusals are 401", async (t) => {
  const server = createServer({ secret: SECRET, places });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = server.address().port;

  const id = crypto.randomUUID();
  const ok = await request(port, { path: "/hook", body: stopBody(id), requestId: id });
  assert.strictEqual(ok.status, 200);
  const answer = await ok.json();
  assert.strictEqual(answer.version, 1);
  assert.strictEqual(answer.suggestions[0].name, "Marienplatz");
  assert.ok(answer.suggestions[0].confidence > 0 && answer.suggestions[0].confidence <= 1);

  const replayed = await request(port, { path: "/hook", body: stopBody(id), requestId: id });
  assert.strictEqual(replayed.status, 401, "a replayed request id is refused");

  const wrong = await request(port, {
    path: "/hook",
    body: stopBody(crypto.randomUUID()),
    secret: "other",
  });
  assert.strictEqual(wrong.status, 401, "a wrong secret is refused");

  const stale = await request(port, {
    path: "/hook",
    body: stopBody(crypto.randomUUID()),
    timestamp: Math.floor(Date.now() / 1000) - 301,
  });
  assert.strictEqual(stale.status, 401, "a timestamp outside ±300 s is refused");

  const far = crypto.randomUUID();
  const nothing = await request(port, {
    path: "/hook",
    body: stopBody(far, 52.52, 13.405),
    requestId: far,
  });
  assert.strictEqual(nothing.status, 204, "nothing near is 204");

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.strictEqual(health.status, 200);

  const hello = await request(port, { method: "GET", path: "/hook" });
  assert.deepStrictEqual(await hello.json(), {
    name: "Template plugin",
    version: 1,
    kinds: ["stop"],
  });
});

// rc.45 review: a full cache evicted the oldest id even while it was still inside its window,
// so that request could be replayed. A full cache now refuses new requests instead.
test("a full replay cache refuses new requests and never forgets a live id", () => {
  const { ReplayCache, WINDOW_S } = require("../src/verify");
  const cache = new ReplayCache(2);
  const t = 1763900000;
  assert.strictEqual(cache.claim("a", t), "ok");
  assert.strictEqual(cache.claim("b", t), "ok");
  assert.strictEqual(cache.claim("c", t + 10), "full");
  assert.strictEqual(cache.claim("a", t + 10), "replay");
  // Once the ids have aged out of both windows there is room again.
  assert.strictEqual(cache.claim("c", t + WINDOW_S * 2 + 1), "ok");
});

test("checkRequest answers 503, not 401, while the replay cache is full", () => {
  const { ReplayCache, checkRequest } = require("../src/verify");
  const replay = new ReplayCache(1);
  const nowS = 1763900000;
  const signed = (requestId) => ({
    secret: SECRET,
    method: "POST",
    path: "/",
    body: "{}",
    replay,
    nowS,
    headers: {
      "travstats-timestamp": String(nowS),
      "travstats-request-id": requestId,
      "travstats-signature": sign(SECRET, {
        method: "POST",
        path: "/",
        timestamp: nowS,
        requestId,
        body: "{}",
      }),
    },
  });
  assert.strictEqual(checkRequest(signed(crypto.randomUUID())), null);
  assert.strictEqual(checkRequest(signed(crypto.randomUUID())), 503);
});
