"use strict";
/**
 * A minimal TravStats suggestion plugin, no framework: it reads the raw body,
 * verifies the signature, looks the stop up in a JSON file of places and
 * answers with the ones within 300 m. Replace `lookup` with your own source.
 *
 * Environment: PLUGIN_SECRET (from TravStats, required), PORT (8080),
 * PLACES_FILE (data/places.example.json).
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { checkRequest, ReplayCache } = require("./verify");

const VERSION = 1;
const MAX_BODY = 64 * 1024;
const RADIUS_M = 300;

/**
 * The signed hello. `list` (optional) asks TravStats to keep this plugin's places as a list:
 * `defaultName` is the list's first name (the user may rename it), `columns` the extra columns,
 * filled from each suggestion's `externalRef.fields` by key.
 */
const HELLO = {
  name: "Template plugin",
  version: VERSION,
  kinds: ["stop"],
  list: {
    defaultName: { de: "Orte · Vorlage", en: "Places · template" },
    columns: [
      { key: "ref", label: { de: "Nr.", en: "No." } },
      { key: "group", label: { de: "Gruppe", en: "Group" } },
    ],
  },
};

function meters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function loadPlaces(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** The places near the stop, nearest first, at most five. Confidence falls with distance. */
function lookup(places, stop) {
  return places
    .map((p) => ({ p, d: meters(stop, p) }))
    .filter((x) => x.d <= RADIUS_M + (stop.precisionMeters || 0))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ p, d }) => ({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      ...(p.address ? { address: p.address } : {}),
      ...(p.purpose ? { purpose: p.purpose } : {}),
      // The object form fills the list columns the hello announces (see HELLO.list).
      ...(p.id
        ? {
            externalRef: {
              id: String(p.id),
              label: p.name,
              fields: { ref: String(p.id), ...(p.group ? { group: String(p.group) } : {}) },
            },
          }
        : {}),
      ...(p.url ? { url: p.url } : {}),
      confidence: Math.max(0, Math.min(1, 1 - d / (RADIUS_M * 2))),
    }));
}

function createServer({ secret, places }) {
  if (!secret) throw new Error("PLUGIN_SECRET is required");
  const replay = new ReplayCache();
  return http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      // The container's health check: unsigned, and it says nothing but "up".
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"ok":true}');
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const refused = checkRequest({
        secret,
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
        replay,
      });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };
      if (refused) return send(refused, { error: refused === 503 ? "busy" : "unauthorized" });
      if (req.method === "GET") return send(200, HELLO);
      if (req.method !== "POST") return send(405, { error: "method" });
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        return send(400, { error: "json" });
      }
      // An unknown major: say so rather than guess.
      if (request.version !== VERSION || !request.stop) return send(400, { error: "version" });
      const suggestions = lookup(places, request.stop);
      if (suggestions.length === 0) return send(204);
      return send(200, { version: VERSION, suggestions });
    });
  });
}

if (require.main === module) {
  const file = process.env.PLACES_FILE || path.join(__dirname, "../data/places.example.json");
  const server = createServer({ secret: process.env.PLUGIN_SECRET, places: loadPlaces(file) });
  server.listen(Number(process.env.PORT || 8080), () => {
    // Coordinates are never logged: they are someone's whereabouts.
    console.log(`plugin listening on ${server.address().port}`);
  });
}

module.exports = { createServer, lookup, HELLO };
