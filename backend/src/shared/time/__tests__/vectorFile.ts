import fs from "fs";
import path from "path";
import { z } from "zod";

/**
 * Loads and validates `shared/time/vectors.json` at the repository root —
 * the contract the server, the web mirror and the Companion are all held to
 * (ADR 0002 D5). The file lives OUTSIDE `backend/` and `frontend/` on
 * purpose: neither tree owns it, and it is not copied into the image.
 *
 * The zod schema below restates `shared/time/vectors.schema.json` for this
 * runner. `vectors.test.ts` pins the two against each other (op names and
 * error codes), so a format change that lands in one and not the other fails.
 */

export const VECTORS_PATH = path.resolve(__dirname, "../../../../../shared/time/vectors.json");
export const VECTORS_SCHEMA_PATH = path.resolve(
  __dirname,
  "../../../../../shared/time/vectors.schema.json"
);

const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
const localIn = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
const localOut = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const offset = z.string().regex(/^[+-]\d{2}:\d{2}$/);
const zone = z.string().min(1);

export const VECTOR_ERROR_CODES = [
  "LOCAL_TIME_NONEXISTENT",
  "ZONE_UNKNOWN",
  "VALIDATION_FAILED",
  "TZ_UNRESOLVED",
] as const;
const errorExpect = z.strictObject({ error: z.enum(VECTOR_ERROR_CODES) });

const runner = z.enum(["server", "web", "companion"]);
const base = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  appliesTo: z.array(runner).min(1).optional(),
  note: z.string().optional(),
};
const zonedLocal = z.strictObject({ local: localIn, zone });

const toInstantCase = z.strictObject({
  ...base,
  op: z.literal("toInstant"),
  input: z.strictObject({
    local: localIn,
    zone,
    origin: z.enum(["typed", "machine"]).optional(),
    fold: z.enum(["earlier", "later"]).optional(),
  }),
  expect: z.union([errorExpect, z.strictObject({ utc, offset, ambiguous: z.boolean() })]),
});

const toLocalCase = z.strictObject({
  ...base,
  op: z.literal("toLocal"),
  input: z.strictObject({ utc, zone }),
  expect: z.union([errorExpect, z.strictObject({ local: localOut, offset })]),
});

const localDayCase = z.strictObject({
  ...base,
  op: z.literal("localDay"),
  input: z.strictObject({ utc, zone }),
  expect: z.union([errorExpect, z.strictObject({ day })]),
});

const todayInCase = z.strictObject({
  ...base,
  op: z.literal("todayIn"),
  input: z.strictObject({ now: utc, zone }),
  expect: z.strictObject({ day }),
});

const spanCase = z.strictObject({
  ...base,
  op: z.literal("span"),
  input: z.strictObject({ start: zonedLocal, end: zonedLocal }),
  expect: z.strictObject({
    startUtc: utc,
    endUtc: utc,
    minutes: z.number().int(),
    startDay: day,
    endDay: day,
    dayDiff: z.number().int(),
  }),
});

const floatingDateCase = z.strictObject({
  ...base,
  op: z.literal("floatingDate"),
  input: z.strictObject({ date: z.string() }),
  expect: z.union([errorExpect, z.strictObject({ date: day })]),
});

const displayCase = z.strictObject({
  ...base,
  op: z.literal("display"),
  input: z.strictObject({
    value: z.strictObject({
      utc,
      zone,
      offset,
      local: localOut,
      precision: z.enum(["minute", "day", "month", "year", "unknown"]),
    }),
  }),
  expect: z.strictObject({
    date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable(),
    offset: offset.nullable(),
  }),
});

export const vectorCase = z.discriminatedUnion("op", [
  toInstantCase,
  toLocalCase,
  localDayCase,
  todayInCase,
  spanCase,
  floatingDateCase,
  displayCase,
]);

export const VECTOR_OPS = [
  "toInstant",
  "toLocal",
  "localDay",
  "todayIn",
  "span",
  "floatingDate",
  "display",
] as const;

export const vectorFile = z.strictObject({
  $schema: z.string().optional(),
  version: z.number().int().min(1),
  minTzdata: z.string().regex(/^\d{4}[a-z]$/),
  cases: z.array(vectorCase).min(1),
});

export type VectorCase = z.infer<typeof vectorCase>;
export type VectorFile = z.infer<typeof vectorFile>;

/** Reads and validates the vectors; throws with zod's issues when the file breaks the format. */
export function loadVectors(filePath: string = VECTORS_PATH): VectorFile {
  const parsed = vectorFile.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  const ids = parsed.cases.map((c) => c.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Duplicate vector id: ${duplicate}`);
  return parsed;
}

/** True when this runtime's tzdata is at least the file's `minTzdata` ("2025b" >= "2025a"). */
export function tzdataSatisfies(minTzdata: string, runtime = process.versions.tz): boolean {
  return typeof runtime === "string" && runtime >= minTzdata;
}
