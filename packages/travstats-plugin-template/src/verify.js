"use strict";
/**
 * Checking a TravStats request: HMAC-SHA256 over
 *   METHOD "\n" path "\n" timestamp "\n" requestId "\n" body
 * compared in constant time, a timestamp within ±300 s of this clock, and a
 * request id never seen before (the replay cache is mandatory: without it a
 * captured request could be sent again within the window).
 */
const crypto = require("node:crypto");

const WINDOW_S = 300;

function signingString({ method, path, timestamp, requestId, body }) {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${requestId}\n${body}`;
}

function sign(secret, parts) {
  return `v1=${crypto.createHmac("sha256", secret).update(signingString(parts), "utf8").digest("hex")}`;
}

/**
 * Remembers request ids for as long as a request carrying them could still be
 * accepted (its timestamp may be up to WINDOW_S in the past or the future, so
 * 2 x WINDOW_S), bounded. When the bound is reached it refuses NEW requests
 * instead of forgetting a live id: evicting one would let that request be
 * replayed inside its window.
 */
class ReplayCache {
  constructor(max = 10000) {
    this.max = max;
    this.seen = new Map(); // insertion order = arrival order
  }
  /** "ok" the first time an id is offered, "replay" for a seen one, "full" while no room is left. */
  claim(requestId, nowS) {
    for (const [id, at] of this.seen) {
      if (nowS - at <= WINDOW_S * 2) break;
      this.seen.delete(id);
    }
    if (this.seen.has(requestId)) return "replay";
    if (this.seen.size >= this.max) return "full";
    this.seen.set(requestId, nowS);
    return "ok";
  }
}

/**
 * The whole check. Returns null when the request may be answered, else the
 * HTTP status to refuse it with (401 for a bad signature, stale timestamp or replay;
 * 503 while the replay cache is full, so TravStats retries later instead of
 * reading it as a wrong key).
 */
function checkRequest({
  secret,
  method,
  path,
  headers,
  body,
  replay,
  nowS = Math.floor(Date.now() / 1000),
}) {
  const timestamp = Number(headers["travstats-timestamp"]);
  const requestId = String(headers["travstats-request-id"] || "");
  const given = String(headers["travstats-signature"] || "");
  if (!Number.isInteger(timestamp) || Math.abs(nowS - timestamp) > WINDOW_S) return 401;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return 401;
  const expected = Buffer.from(sign(secret, { method, path, timestamp, requestId, body }));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return 401;
  const claim = replay.claim(requestId, nowS);
  if (claim === "replay") return 401;
  if (claim === "full") return 503;
  return null;
}

module.exports = { sign, signingString, checkRequest, ReplayCache, WINDOW_S };
