/**
 * The time-shape guard for the OpenAPI spec (ADR 0002 D3/D6, phase 4).
 *
 * Every time a documented response carries must reach a client in the time
 * model's shape: an instant at a place as a `TimeValue`
 * (`{utc, zone, offset, local, precision, zoneSource}`), a calendar day as a
 * `LocalDateValue` (`{date, zone, precision}`). A bare `date-time` string is
 * what made every client guess a zone — the browser's, the device's, UTC —
 * and each guess was a wrong number on somebody's screen.
 *
 * A bare `date-time`/`date` field in a 200/201 response passes when:
 * 1. it sits inside a `TimeValue` or `LocalDateValue` (that is the shape);
 * 2. its object also carries `times` — the field is then the legacy mirror of
 *    a value `times` already hands out, kept until the Companion has moved
 *    (companion#24) and removed in phase 6;
 * 3. its NAME is one of the system's own bookkeeping instants below — when a
 *    row, a token or a job changed. Those happened on no traveller's clock
 *    and at no place; there is no zone to give them;
 * 4. or it is listed in `openapi.timeShape.baseline.json`.
 *
 * The baseline is a ratchet, like its siblings: a new bare field fails, and a
 * listed field that now passes (or no longer exists) fails too until it is
 * removed. It can only shrink.
 */

import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";
import baseline from "./openapi.timeShape.baseline.json";

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null;

/** The components that ARE the time model's shape. */
const TIME_COMPONENTS = new Set(["TimeValue", "LocalDateValue"]);

/** Bookkeeping instants of the system itself — see rule 3 above. */
const BOOKKEEPING_INSTANTS = new Set([
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "dismissedAt",
  "expiresAt",
  "revokedAt",
  "lastUsedAt",
  "completedAt",
  "finishedAt",
  "unlockedAt",
  "fetchedAt",
  "geocodeAttemptedAt",
  "nextApiCheckAt",
  "aerodataboxLastUpdatedUtc",
  "summaryGeneratedAt",
]);

const doc = buildOpenApiDocument() as unknown as { paths: Json; components: { schemas: Json } };
const components = doc.components.schemas;

/**
 * Every bare time field of every documented 200/201 response, as
 * `"<METHOD> <path> <pointer>"`, minus what rules 1–3 let through.
 */
function bareTimeFields(): Set<string> {
  const found = new Set<string>();

  const walk = (
    schema: unknown,
    at: string,
    seen: ReadonlySet<string>,
    siblings: Json | null,
    name: string | null
  ): void => {
    if (!isRecord(schema)) return;
    if (typeof schema.$ref === "string") {
      const ref = schema.$ref.split("/").pop() as string;
      if (TIME_COMPONENTS.has(ref) || seen.has(ref)) return;
      walk(components[ref], at, new Set([...seen, ref]), siblings, name);
      return;
    }
    if (schema.format === "date-time" || schema.format === "date") {
      const legacyMirror = siblings !== null && "times" in siblings;
      if (!legacyMirror && !(name !== null && BOOKKEEPING_INSTANTS.has(name))) found.add(at);
    }
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      const parts = schema[key];
      if (Array.isArray(parts)) parts.forEach((p) => walk(p, at, seen, siblings, name));
    }
    if (isRecord(schema.properties)) {
      const props = schema.properties;
      for (const [key, value] of Object.entries(props))
        walk(value, `${at}.${key}`, seen, props, key);
    }
    if (schema.items) walk(schema.items, `${at}[]`, seen, null, null);
    if (isRecord(schema.additionalProperties)) {
      walk(schema.additionalProperties, `${at}{}`, seen, null, null);
    }
  };

  for (const [path, operations] of Object.entries(doc.paths)) {
    if (!isRecord(operations)) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!isRecord(operation) || !isRecord(operation.responses)) continue;
      for (const status of ["200", "201"]) {
        const response = operation.responses[status];
        if (!isRecord(response) || !isRecord(response.content)) continue;
        for (const media of Object.values(response.content)) {
          if (isRecord(media)) {
            walk(media.schema, `${method.toUpperCase()} ${path} `, new Set(), null, null);
          }
        }
      }
    }
  }
  return found;
}

describe("OpenAPI time shape ratchet", () => {
  const found = bareTimeFields();
  const listed = new Set<string>(baseline.fields);

  it("publishes TimeValue and LocalDateValue as non-nullable components with every field", () => {
    const timeValue = components.TimeValue as Json;
    const localDate = components.LocalDateValue as Json;
    // The generator once named a nullable wrapper the component — every member
    // pointing at it then lost its own nullability (registry.ts).
    expect(timeValue.nullable).toBeUndefined();
    expect(localDate.nullable).toBeUndefined();
    expect(timeValue.required).toEqual(
      expect.arrayContaining(["utc", "zone", "offset", "local", "precision", "zoneSource"])
    );
    expect(localDate.required).toEqual(expect.arrayContaining(["date", "zone", "precision"]));
  });

  it("adds no new bare time field to a documented response", () => {
    const added = [...found].filter((f) => !listed.has(f)).sort();
    // A new time field goes out as a TimeValue / LocalDateValue under `times`.
    expect(added).toEqual([]);
  });

  it("keeps no baseline entry for a field that now has the shape or is gone", () => {
    const stale = [...listed].filter((f) => !found.has(f)).sort();
    // Remove these from openapi.timeShape.baseline.json — the list only shrinks.
    expect(stale).toEqual([]);
  });

  it("covers every entity the Companion reads with a times object", () => {
    const withTimes = [
      "Flight",
      "RailJourney",
      "Stay",
      "PlaceVisit",
      "Place",
      "Cruise",
      "CruiseStop",
      "Trip",
      "TripStop",
      "TripJournalEntry",
      "RoadtripStation",
    ];
    for (const name of withTimes) {
      const properties = (components[name] as Json | undefined)?.properties as Json | undefined;
      expect({ name, hasTimes: properties !== undefined && "times" in properties }).toEqual({
        name,
        hasTimes: true,
      });
    }
  });
});
