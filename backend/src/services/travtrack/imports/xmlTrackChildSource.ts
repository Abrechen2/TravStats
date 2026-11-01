/**
 * The program of the KML / TCX reader (forgejo#394), run by
 * `trackFileChild.ts`. Plain CommonJS in a string; no backtick or dollar-brace
 * may appear inside it. Like the GPX reader it refuses any document type
 * declaration before the parser sees the text (entity expansion, XXE), and the
 * file is capped at the GPX size.
 *
 * KML (Google Earth / My Maps / Maps exports): a `gx:Track` is a list of
 * `<when>` instants and `<gx:coord>lon lat alt</gx:coord>` positions, paired
 * by index (OGC KML 2.2 extension, developers.google.com/kml/documentation/
 * kmlreference#gxtrack); a `Placemark` with a `Point` and a `TimeStamp` is one
 * fix. A `LineString` carries no times, so it is not history and is not read.
 *
 * TCX (Garmin Training Center): `Trackpoint` with `Time`,
 * `Position/LatitudeDegrees|LongitudeDegrees`, `AltitudeMeters`; a trackpoint
 * without a `Position` (an indoor lap) is skipped silently.
 *
 * Namespace prefixes are removed by the parser, so `gx:Track` is `Track`.
 */
export function xmlTrackSource(fastXmlParserPath: string): string {
  return (
    `const { XMLParser, XMLValidator } = require(${JSON.stringify(fastXmlParserPath)});\n` +
    String.raw`
const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.trim()); return Number.isFinite(n) ? n : NaN; }
  return NaN;
};
// A time without an offset is not guessed: it reads as "no time".
const instant = (v) =>
  typeof v === "string" && /(Z|[+-]\d{2}:?\d{2})$/i.test(v.trim()) && /^\d{4}-\d{2}-\d{2}T/.test(v.trim())
    ? Date.parse(v.trim()) : NaN;
const text = (v) => (typeof v === "string" ? v : isObj(v) && typeof v["#text"] === "string" ? v["#text"] : "");

const lat = [], lon = [], time = [], alt = [];
let invalid = 0, max = 0;
const formats = {};

function emit(la, lo, t, a) {
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { invalid += 1; return; }
  if (lat.length + invalid >= max) throw new Error("too many");
  lat.push(la); lon.push(lo); time.push(t); alt.push(a);
}

function walk(node, visit, depth) {
  if (depth > 64) throw new Error("too deep");
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, depth + 1); return; }
  if (!isObj(node)) return;
  for (const key of Object.keys(node)) {
    visit(key, node[key], node);
    walk(node[key], visit, depth + 1);
  }
}

function main(job) {
  max = job.maxPoints;
  let xml = Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength).toString("utf8");
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (/<!\s*(doctype|entity)/i.test(xml)) return { type: "error", code: "UNREADABLE" };
  if (XMLValidator.validate(xml) !== true) return { type: "error", code: "UNREADABLE" };
  const parsed = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true }).parse(xml);
  xml = null;
  if (isObj(parsed.kml)) {
    formats.kml = 1;
    walk(parsed.kml, (key, value) => {
      if (key === "Track") {
        for (const track of arr(value)) {
          if (!isObj(track)) continue;
          const when = arr(track.when).map(text), coord = arr(track.coord).map(text);
          coord.forEach((c, i) => {
            const p = c.trim().split(/\s+/);
            if (p.length < 2) { invalid += 1; return; }
            emit(num(p[1]), num(p[0]), instant(when[i]), p.length > 2 ? num(p[2]) : NaN);
          });
        }
      } else if (key === "Placemark") {
        for (const pm of arr(value)) {
          if (!isObj(pm) || !isObj(pm.Point) || !isObj(pm.TimeStamp)) continue;
          const p = text(pm.Point.coordinates).trim().split(",");
          if (p.length < 2) { invalid += 1; continue; }
          emit(num(p[1]), num(p[0]), instant(text(pm.TimeStamp.when)), p.length > 2 ? num(p[2]) : NaN);
        }
      }
    }, 0);
  } else if (isObj(parsed.TrainingCenterDatabase)) {
    formats.tcx = 1;
    walk(parsed.TrainingCenterDatabase, (key, value) => {
      if (key !== "Trackpoint") return;
      for (const tp of arr(value)) {
        if (!isObj(tp) || !isObj(tp.Position)) continue;
        emit(num(tp.Position.LatitudeDegrees), num(tp.Position.LongitudeDegrees), instant(text(tp.Time)), num(tp.AltitudeMeters));
      }
    }, 0);
  } else return { type: "error", code: "UNREADABLE" };
  if (lat.length + invalid === 0) return { type: "error", code: "UNREADABLE" };
  const n = lat.length;
  return {
    type: "result",
    lat: Float64Array.from(lat), lon: Float64Array.from(lon), time: Float64Array.from(time),
    acc: new Float64Array(n).fill(NaN), alt: Float64Array.from(alt),
    speed: new Float64Array(n).fill(NaN), course: new Float64Array(n).fill(NaN),
    motion: new Int8Array(n).fill(-1), invalid, formats: Object.keys(formats),
  };
}

process.once("message", (job) => {
  let reply;
  try { reply = main(job); } catch (e) { reply = { type: "error", code: e && e.message === "too many" ? "TOO_MANY" : "UNREADABLE" }; }
  process.send(reply, () => process.exit(0));
});
`
  );
}
