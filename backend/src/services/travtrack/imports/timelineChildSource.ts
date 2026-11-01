/**
 * The program of the Google Timeline / GeoJSON reader (forgejo#394), run by
 * `trackFileChild.ts` as `node -e`. Plain CommonJS in a string, like the GPX
 * reader's; no backtick or dollar-brace may appear inside it.
 *
 * It does not build a tree of the file. A scanner walks the text in slices
 * (decoding as a stream, so a multi-byte character split between two slices
 * survives), tracks only nesting, strings and the key of the root object, and
 * hands each ELEMENT of an interesting array to a mapper as a small parsed
 * object. A 400 MB `Records.json` therefore costs the child its largest element,
 * not the file. The interesting arrays are the ones the formats use, by key at
 * the root (or the root array itself):
 *
 *   locations        Takeout "Records.json" (old Location History)
 *   timelineObjects  Takeout "Semantic Location History/YYYY/YYYY_MONTH.json"
 *   semanticSegments, rawSignals, and the root array
 *                    the on-device Timeline export (Android / iOS "Timeline.json")
 *   features         GeoJSON FeatureCollection
 *
 * Field names, checked 2026-11-01 against the open-source importers of
 * Dawarich (github.com/Freika/dawarich, app/services/google_maps/
 * records_importer.rb, semantic_history_importer.rb, phone_takeout_importer.rb)
 * which read real exports: Records.json `latitudeE7`/`longitudeE7`/
 * `timestamp|timestampMs`/`accuracy`/`altitude`/`velocity`/`heading`/`activity`;
 * semantic history `placeVisit.location.latitudeE7`, `activitySegment.
 * startLocation|endLocation`, `simplifiedRawPath.points[].latE7|lngE7|
 * timestamp`, `duration.startTimestamp|startTimestampMs`; the on-device export
 * `semanticSegments[].timelinePath[].point|time`, `visit.topCandidate.
 * placeLocation.latLng`, `activity.start|end.latLng`, `rawSignals[].position.
 * LatLng|timestamp|accuracyMeters|altitudeMeters|speedMetersPerSecond`, and the
 * older Android array form with `geo:lat,lon` strings and
 * `durationMinutesOffsetFromStartTime`.
 *
 * A time without an offset is not guessed (no host zone enters): it reads as
 * "no time". An accuracy, speed or heading the file does not carry stays
 * unknown, never zero.
 */
export function timelineSource(): string {
  return String.raw`
const SLICE_BYTES = 4 * 1024 * 1024;
const MAX_ELEMENT_CHARS = 8 * 1024 * 1024;
const WANTED = { locations: 1, timelineObjects: 1, semanticSegments: 1, rawSignals: 1, features: 1 };
const E7 = 1e7;
const MOTIONS = ["stationary", "walking", "running", "cycling", "automotive"];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const finite = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
};

// ---- outputs ---------------------------------------------------------------
const lat = [], lon = [], time = [], acc = [], alt = [], speed = [], course = [], motion = [];
let invalid = 0;
const formats = {};
let max = 0;

class TooMany extends Error {}

function emit(la, lo, t, o) {
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    invalid += 1;
    return;
  }
  if (lat.length + invalid >= max) throw new TooMany();
  lat.push(la); lon.push(lo); time.push(t);
  acc.push(o && Number.isFinite(o.acc) && o.acc >= 0 ? o.acc : NaN);
  alt.push(o && Number.isFinite(o.alt) ? o.alt : NaN);
  speed.push(o && Number.isFinite(o.speed) && o.speed >= 0 ? o.speed : NaN);
  course.push(o && Number.isFinite(o.course) && o.course >= 0 && o.course <= 360 ? o.course : NaN);
  motion.push(o && o.motion !== undefined ? o.motion : -1);
}

// ---- values ------------------------------------------------------------------
/** An instant in ms, or NaN: ISO text WITH an offset, or an epoch number / digit string. */
function instant(v) {
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return n >= 1e11 ? n : n * 1000;
  }
  if (typeof v !== "string") return NaN;
  const s = v.trim();
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/i.exec(s);
  if (!m) return NaN;
  let zone = m[2].toUpperCase();
  if (zone !== "Z" && zone.length === 5) zone = zone.slice(0, 3) + ":" + zone.slice(3);
  let body = m[1];
  if (body.length === 16) body += ":00";
  // Date.parse takes ms precision; longer fractions are cut, not rounded.
  body = body.replace(/(\.\d{3})\d+/, "$1");
  return Date.parse(body + zone);
}

/** "geo:48.1,11.5", "48.1°, 11.5°" (an optional third part is the altitude) → [lat, lon, alt] or null. */
function geo(v) {
  if (typeof v !== "string") return null;
  const parts = v.replace(/^\s*geo:/i, "").replace(/°/g, "").split(",");
  if (parts.length < 2) return null;
  const la = finite(parts[0]), lo = finite(parts[1]);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return [la, lo, parts.length > 2 ? finite(parts[2]) : NaN];
}

function motionOf(type) {
  if (typeof type !== "string") return undefined;
  const k = type.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (k === "still" || k === "stationary") return 0;
  if (k === "walking" || k === "on_foot") return 1;
  if (k === "running") return 2;
  if (k === "cycling" || k === "on_bicycle" || k === "biking") return 3;
  if (/(vehicle|driving|bus|train|subway|tram|motorcycl|car|taxi|rail)/.test(k)) return 4;
  return undefined;
}

function bestActivity(list) {
  let bestType, bestConf = -1;
  for (const group of arr(list)) {
    for (const a of arr(isObj(group) ? group.activity : null)) {
      const c = isObj(a) && Number.isFinite(a.confidence) ? a.confidence : 0;
      if (isObj(a) && c > bestConf) { bestConf = c; bestType = a.type; }
    }
    if (bestType !== undefined) break; // the first group is the one stamped with the fix
  }
  return motionOf(bestType);
}

// ---- mappers ---------------------------------------------------------------
function records(e) {
  formats["google-records"] = 1;
  emit(finite(e.latitudeE7) / E7, finite(e.longitudeE7) / E7, instant(e.timestamp !== undefined ? e.timestamp : e.timestampMs), {
    acc: finite(e.accuracy), alt: finite(e.altitude), speed: finite(e.velocity),
    course: finite(e.heading), motion: bestActivity(e.activity),
  });
}

const at = (d, a, b) => (isObj(d) ? instant(d[a] !== undefined ? d[a] : d[b]) : NaN);

function legacySemantic(e) {
  formats["google-semantic"] = 1;
  if (isObj(e.activitySegment)) {
    const s = e.activitySegment, d = s.duration;
    const t0 = at(d, "startTimestamp", "startTimestampMs"), t1 = at(d, "endTimestamp", "endTimestampMs");
    const mo = motionOf(s.activityType);
    const edge = (loc, t) => {
      if (isObj(loc)) emit(finite(loc.latitudeE7) / E7, finite(loc.longitudeE7) / E7, t, { acc: finite(loc.accuracyMetres), motion: mo });
    };
    edge(s.startLocation, t0);
    for (const p of arr(isObj(s.simplifiedRawPath) ? s.simplifiedRawPath.points : null)) {
      if (!isObj(p)) continue;
      emit(finite(p.latE7) / E7, finite(p.lngE7) / E7, instant(p.timestamp !== undefined ? p.timestamp : p.timestampMs), { acc: finite(p.accuracyMeters), motion: mo });
    }
    // Waypoints carry no time of their own: they are read, and counted as "no time".
    for (const w of arr(isObj(s.waypointPath) ? s.waypointPath.waypoints : null)) {
      if (isObj(w)) emit(finite(w.latE7) / E7, finite(w.lngE7) / E7, NaN, { motion: mo });
    }
    edge(s.endLocation, t1);
  } else if (isObj(e.placeVisit)) {
    const v = e.placeVisit, loc = v.location;
    if (isObj(loc) && loc.latitudeE7 !== undefined) {
      emit(finite(loc.latitudeE7) / E7, finite(loc.longitudeE7) / E7, at(v.duration, "startTimestamp", "startTimestampMs"), { acc: finite(loc.accuracyMetres) });
    }
  }
}

const latLngOf = (v) => geo(isObj(v) ? (v.latLng !== undefined ? v.latLng : v.LatLng) : v);

function deviceSegment(e) {
  formats["google-timeline"] = 1;
  const t0 = instant(e.startTime), t1 = instant(e.endTime);
  for (const p of arr(e.timelinePath)) {
    if (!isObj(p)) continue;
    const g = geo(p.point);
    if (!g) { invalid += 1; continue; }
    let t = p.time !== undefined ? instant(p.time) : NaN;
    if (p.time === undefined && Number.isFinite(t0)) {
      const m = finite(p.durationMinutesOffsetFromStartTime);
      t = Number.isFinite(m) && m >= 0 ? t0 + m * 60000 : NaN;
    }
    emit(g[0], g[1], t, { alt: g[2] });
  }
  if (isObj(e.visit)) {
    const top = e.visit.topCandidate;
    const g = isObj(top) ? latLngOf(top.placeLocation) : null;
    if (g) emit(g[0], g[1], t0, { alt: g[2] });
  }
  if (isObj(e.activity)) {
    const a = e.activity;
    const mo = isObj(a.topCandidate) ? motionOf(a.topCandidate.type) : undefined;
    const s = latLngOf(a.start), f = latLngOf(a.end);
    if (s) emit(s[0], s[1], t0, { alt: s[2], motion: mo });
    if (f) emit(f[0], f[1], t1, { alt: f[2], motion: mo });
  }
}

function rawSignal(e) {
  const p = e.position;
  if (!isObj(p)) return; // other signals (wifi scans, ...) are not positions
  formats["google-timeline"] = 1;
  const g = latLngOf(p);
  if (!g) { invalid += 1; return; }
  emit(g[0], g[1], instant(p.timestamp), {
    acc: finite(p.accuracyMeters),
    alt: Number.isFinite(finite(p.altitudeMeters)) ? finite(p.altitudeMeters) : g[2],
    speed: finite(p.speedMetersPerSecond),
  });
}

function timesOf(props) {
  if (!isObj(props)) return [];
  if (Array.isArray(props.coordTimes)) return props.coordTimes;
  if (isObj(props.coordinateProperties) && Array.isArray(props.coordinateProperties.times)) return props.coordinateProperties.times;
  if (Array.isArray(props.times)) return props.times;
  return [];
}

function line(coords, times) {
  coords.forEach((c, i) => {
    if (!Array.isArray(c) || c.length < 2) { invalid += 1; return; }
    emit(finite(c[1]), finite(c[0]), instant(times[i]), { alt: c.length > 2 ? finite(c[2]) : NaN });
  });
}

function feature(e) {
  formats["geojson"] = 1;
  const g = e.geometry;
  if (!isObj(g) || !Array.isArray(g.coordinates)) return;
  const times = timesOf(e.properties);
  if (g.type === "LineString") line(g.coordinates, times);
  else if (g.type === "MultiLineString") g.coordinates.forEach((l, i) => line(arr(l), arr(times[i])));
  else if (g.type === "Point") {
    const p = isObj(e.properties) ? e.properties : {};
    const t = instant(p.time !== undefined ? p.time : p.timestamp !== undefined ? p.timestamp : p.when);
    line([g.coordinates], [t]);
  }
}

function dispatch(key, e) {
  if (!isObj(e)) return;
  if (key === "locations") records(e);
  else if (key === "timelineObjects") legacySemantic(e);
  else if (key === "rawSignals") rawSignal(e);
  else if (key === "features") feature(e);
  else deviceSegment(e); // semanticSegments, or the older root array
}

// ---- the scanner ---------------------------------------------------------------
function makeScanner(onElement) {
  let depth = 0, inStr = false, esc = false;
  let rootIsObj = false, rootSeen = false, expectKey = false, keyCollect = false, keyBuf = "";
  let curKey = null, arrKey = null, elemDepth = 0;
  let capturing = false, capStart = 0, capParts = [], capLen = 0;
  let badElements = 0;

  function finishElement(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (err) { badElements += 1; return; }
    onElement(arrKey, parsed);
  }

  function feed(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (inStr) {
        if (esc) { esc = false; if (keyCollect) keyBuf += s[i]; }
        else if (c === 92) { esc = true; }
        else if (c === 34) { inStr = false; if (keyCollect) { curKey = keyBuf; keyCollect = false; } }
        else if (keyCollect) { keyBuf += s[i]; if (keyBuf.length > 64) keyCollect = false; }
        continue;
      }
      if (c === 34) {
        inStr = true;
        if (depth === 1 && rootIsObj && expectKey) { keyCollect = true; keyBuf = ""; expectKey = false; }
      } else if (c === 123) {
        depth += 1;
        if (depth === 1) { rootIsObj = true; rootSeen = true; expectKey = true; }
        if (arrKey !== null && depth === elemDepth && !capturing) { capturing = true; capStart = i; capLen = 0; }
      } else if (c === 91) {
        depth += 1;
        if (depth === 1) { rootSeen = true; arrKey = "(root)"; elemDepth = 2; }
        else if (depth === 2 && rootIsObj && curKey !== null && WANTED[curKey] === 1) { arrKey = curKey; elemDepth = 3; }
      } else if (c === 125 || c === 93) {
        if (depth <= 0) throw new Error("unbalanced");
        if (capturing && depth === elemDepth && c === 125) {
          capParts.push(s.slice(capStart, i + 1));
          const text = capParts.join("");
          capParts = []; capturing = false;
          finishElement(text);
        } else if (c === 93 && arrKey !== null && depth === elemDepth - 1) {
          arrKey = null;
        }
        depth -= 1;
      } else if (c === 44) {
        if (depth === 1 && rootIsObj) expectKey = true;
      }
    }
    if (capturing) {
      const part = s.slice(capStart);
      capLen += part.length;
      if (capLen > MAX_ELEMENT_CHARS) throw new Error("element too large");
      capParts.push(part);
      capStart = 0;
    }
  }
  return { feed, finish: () => rootSeen && depth === 0 && !inStr, bad: () => badElements };
}

async function main(job) {
  max = job.maxPoints;
  const fs = require("fs");
  const fd = fs.openSync(job.path, "r");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const scanner = makeScanner(dispatch);
  try {
    const total = fs.fstatSync(fd).size;
    const slice = Buffer.alloc(SLICE_BYTES);
    for (let done = 0; done < total; ) {
      const n = fs.readSync(fd, slice, 0, SLICE_BYTES, done);
      if (n <= 0) break;
      done += n;
      scanner.feed(decoder.decode(slice.subarray(0, n), { stream: done < total }));
      process.send({ type: "progress", done, total });
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    fs.closeSync(fd);
  }
  if (!scanner.finish() || Object.keys(formats).length === 0) return { type: "error", code: "UNREADABLE" };
  return {
    type: "result",
    lat: Float64Array.from(lat), lon: Float64Array.from(lon), time: Float64Array.from(time),
    acc: Float64Array.from(acc), alt: Float64Array.from(alt), speed: Float64Array.from(speed),
    course: Float64Array.from(course), motion: Int8Array.from(motion),
    invalid: invalid + scanner.bad(), formats: Object.keys(formats),
  };
}

process.once("message", (job) => {
  main(job).then(
    (reply) => process.send(reply, () => process.exit(0)),
    (e) => process.send({ type: "error", code: e instanceof TooMany ? "TOO_MANY" : "UNREADABLE" }, () => process.exit(0))
  );
});
`;
}
