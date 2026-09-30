import type { ZodType } from "zod";
import { createStopSchema, createTripSchema, updateStopSchema, updateTripSchema } from "../trip";
import { createRouteSchema, createTourSchema, tourPointsSchema, updateRouteSchema } from "../tour";
import { registerVerifySchema, renamePasskeySchema } from "../webauthn";
import { mergeTripsSchema, reviewProposalSchema } from "../../routes/trips";
import { createAircraftSchema } from "../../routes/aircraft";
import { createAirlineSchema } from "../../routes/airlines";
import { createPortSchema } from "../../routes/ports";
import { createShipSchema } from "../../routes/ships";

/**
 * A name made of whitespace is no name. `z.string().min(1)` counts "   " as
 * three characters, so a trip, a tour section or a catalogue ship could be
 * saved with a blank name and then listed as an empty row — found beside the
 * cruise-validation fix (2026-09-26), where lodging, places, rail and
 * roadtrips already trimmed before counting and these did not.
 *
 * Each case builds a body the schema accepts, then swaps the named field for
 * whitespace: the refusal is therefore about that field and nothing else.
 */
const FLIGHT_A = "11111111-1111-4111-8111-111111111111";
const FLIGHT_B = "22222222-2222-4222-8222-222222222222";
const BLANK = " \t  ";

interface Case {
  label: string;
  schema: ZodType;
  valid: Record<string, unknown>;
  set: (body: Record<string, unknown>, value: string) => Record<string, unknown>;
  read: (data: unknown) => unknown;
}

const field =
  (key: string) =>
  (body: Record<string, unknown>, value: string): Record<string, unknown> => ({
    ...body,
    [key]: value,
  });
const readField = (key: string) => (data: unknown) => (data as Record<string, unknown>)[key];

const CASES: Case[] = [
  {
    label: "trip name (create)",
    schema: createTripSchema,
    valid: { name: "Sommer" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "trip name (update)",
    schema: updateTripSchema,
    valid: { name: "Sommer" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "trip stop title (create)",
    schema: createStopSchema,
    valid: { title: "Rom" },
    set: field("title"),
    read: readField("title"),
  },
  {
    label: "trip stop title (update)",
    schema: updateStopSchema,
    valid: { title: "Rom" },
    set: field("title"),
    read: readField("title"),
  },
  {
    label: "trip tag",
    schema: createTripSchema,
    valid: { name: "Sommer", tags: ["Strand"] },
    set: (body, value) => ({ ...body, tags: [value] }),
    read: (data) => (data as { tags: string[] }).tags[0],
  },
  {
    label: "trip companion",
    schema: createTripSchema,
    valid: { name: "Sommer", companions: ["Anna"] },
    set: (body, value) => ({ ...body, companions: [value] }),
    read: (data) => (data as { companions: string[] }).companions[0],
  },
  {
    label: "detected trip name",
    schema: reviewProposalSchema,
    valid: { flightIds: [FLIGHT_A, FLIGHT_B], name: "Lissabon" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "merged trip name",
    schema: mergeTripsSchema,
    valid: { tripIds: [FLIGHT_A, FLIGHT_B], name: "Lissabon" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "tour section name (create)",
    schema: createRouteSchema,
    valid: { name: "Tag 1", mode: "foot" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "standalone tour name",
    schema: createTourSchema,
    valid: { name: "Tag 1", mode: "foot" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "tour section name (update)",
    schema: updateRouteSchema,
    valid: { name: "Tag 1" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "tour point title",
    schema: tourPointsSchema,
    valid: { points: [{ title: "Gipfel", lat: 47, lon: 11 }] },
    set: (_body, value) => ({ points: [{ title: value, lat: 47, lon: 11 }] }),
    read: (data) => (data as { points: Array<{ title: string }> }).points[0].title,
  },
  {
    label: "passkey name (register)",
    schema: registerVerifySchema,
    valid: { name: "Laptop", response: {} },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "passkey name (rename)",
    schema: renamePasskeySchema,
    valid: { name: "Laptop" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "catalogue aircraft name",
    schema: createAircraftSchema,
    valid: { name: "Airbus A320" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "catalogue airline name",
    schema: createAirlineSchema,
    valid: { iata: "LH", name: "Lufthansa" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "catalogue port name",
    schema: createPortSchema,
    valid: { name: "Kiel", country: "DE", lat: 54.3, lon: 10.1 },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "catalogue ship name",
    schema: createShipSchema,
    valid: { name: "AIDAprima", cruiseLine: "AIDA" },
    set: field("name"),
    read: readField("name"),
  },
  {
    label: "catalogue ship cruise line",
    schema: createShipSchema,
    valid: { name: "AIDAprima", cruiseLine: "AIDA" },
    set: field("cruiseLine"),
    read: readField("cruiseLine"),
  },
];

describe("a name of only whitespace is refused", () => {
  it.each(CASES.map((c) => [c.label, c] as const))("%s: the valid body passes", (_l, c) => {
    const result = c.schema.safeParse(c.valid);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(CASES.map((c) => [c.label, c] as const))("%s: whitespace is refused", (_l, c) => {
    const result = c.schema.safeParse(c.set(c.valid, BLANK));
    expect(result.success).toBe(false);
  });

  it.each(CASES.map((c) => [c.label, c] as const))(
    "%s: surrounding whitespace is not stored",
    (_l, c) => {
      const result = c.schema.safeParse(c.set(c.valid, "  Kiel  "));
      expect(result.success).toBe(true);
      expect(c.read(result.data)).toBe("Kiel");
    }
  );
});
