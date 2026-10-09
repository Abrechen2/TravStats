/**
 * The rule shapes of a v2 `extraction` block (plan 2026-10-09 P2, extended in
 * P4b). extraction.ts validates a block built from these; extract.ts reads it.
 *
 * Every shape is `.strict()`: an unknown key is a typo in a template, and a
 * typo that silently does nothing is a field that silently never reads.
 */
import { z } from "zod";
import { TRANSFORM_NAMES } from "./transforms";
import { FLAGS, MAIL_PARTS, regexSpecSchema } from "./regexSpec";

export { FLAGS };

export const transformSpec = z.union([
  z.enum(TRANSFORM_NAMES),
  z.array(z.enum(TRANSFORM_NAMES)).min(1),
]);

/**
 * `[pattern, replacement]` or `[pattern, replacement, flags]` (default `g`),
 * applied to the raw text BEFORE the transforms — "Einzelfahrkarte, 2. Klasse"
 * → "Einzelfahrkarte" with `[",?\\s*[12]\\.\\s*Klasse.*$", "", "i"]`.
 */
export const replaceSchema = z
  .array(
    z.union([
      z.tuple([z.string().min(1), z.string()]),
      z.tuple([z.string().min(1), z.string(), FLAGS]),
    ])
  )
  .min(1);

/**
 * `[pattern, value]` pairs applied AFTER the transforms: the first pattern
 * (case-insensitive) that finds something in the value gives the result;
 * none does → null. "Rückfahrt" → `"return"`, "Seetag" → `true`.
 */
export const mapSchema = z
  .array(z.tuple([z.string().min(1), z.union([z.string(), z.number(), z.boolean()])]))
  .min(1);

const valueSteps = {
  transform: transformSpec.optional(),
  replace: replaceSchema.optional(),
  map: mapSchema.optional(),
};

const groupRef = z.union([z.string().min(1), z.number().int().min(0)]);

export const fieldRuleSchema = z
  .object({
    patterns: z.array(z.string().min(1)).min(1).max(10).optional(),
    flags: FLAGS.optional(),
    value: z.string().optional(),
    /**
     * A label on a line of its own; the value is the next line with content
     * below it, unless that line is one of the extraction's `labels` (then the
     * field is absent — never the neighbour's value). See `readStacked`.
     */
    stacked: z.string().trim().min(1).optional(),
    /**
     * How a match becomes the raw value when one capture is not enough:
     * `{1}`, `{2}` or `{name}` are replaced by the trimmed groups, e.g.
     * `"{1}T{2}"` joins a date and a time printed apart. A pattern whose
     * referenced group is empty does not count as a match.
     */
    format: z.string().min(1).optional(),
    /**
     * Another field of the same scope whose integer value is the year for a
     * date printed without one (Hilton's "Oct 01" under a subject that names
     * the year). Only date transforms read it.
     */
    yearFrom: z.string().min(1).optional(),
    /**
     * Try EVERY match of each pattern, not only the first, until one survives
     * the transforms — a label printed twice whose first value is unreadable.
     */
    scan: z.boolean().optional(),
    /**
     * Read only this part of the mail — `subject`, `from` or `text` — instead
     * of the whole document: an invoice number the subject prints and the body
     * prints differently. Document-level fields only.
     */
    in: z.enum(MAIL_PARTS).optional(),
    ...valueSteps,
  })
  .strict()
  .refine((r) => [r.patterns, r.value, r.stacked].filter((x) => x !== undefined).length === 1, {
    message: "needs exactly one of patterns, value or stacked",
  })
  .refine((r) => r.format === undefined || r.patterns !== undefined, {
    message: "format applies to patterns only",
  })
  .refine((r) => r.scan === undefined || r.patterns !== undefined, {
    message: "scan applies to patterns only",
  });
export type FieldRule = z.infer<typeof fieldRuleSchema>;

/**
 * One value of a `matchAll` item. Exactly one source:
 * - `group` — a capture group of the item's match;
 * - `format` — several groups assembled (`"{dep} {time}"`);
 * - `value` — a constant;
 * - `lastBefore` — the last match of another regex that starts before the
 *   item, in the same scope: the section heading in force ("Rückfahrt").
 * `find` then searches the source text with its own regex (the value is its
 * group `v`, else 1, else the whole match) — a train number somewhere in the
 * lines between a departure and an arrival.
 */
export const itemFieldSchema = z
  .object({
    group: groupRef.optional(),
    format: z.string().min(1).optional(),
    value: z.string().optional(),
    lastBefore: regexSpecSchema.optional(),
    find: regexSpecSchema.optional(),
    ...valueSteps,
  })
  .strict()
  .refine(
    (r) => [r.group, r.format, r.value, r.lastBefore].filter((x) => x !== undefined).length === 1,
    { message: "needs exactly one of group, format, value or lastBefore" }
  );
export type ItemFieldRule = z.infer<typeof itemFieldSchema>;

/**
 * A value derived from the item's other values once they are all read:
 * `{name}` is a value of the same item (a field, a zipped value or an earlier
 * computed one), `{parent.name}` one of the enclosing block or document. A
 * placeholder without a value makes the whole result null — a departure
 * without its date is no departure.
 */
export const computeSchema = z
  .object({ format: z.string().min(1), find: regexSpecSchema.optional(), ...valueSteps })
  .strict();
export type ComputeRule = z.infer<typeof computeSchema>;

/**
 * Merge the i-th item of an EARLIER sibling repeat into the i-th item — the
 * route line printed in a header for the i-th cruise, the i-th product line
 * of a ticket table. `strict`: only when both have the same number of items,
 * otherwise nothing is merged (pairing by position is sound only then). A
 * value the item already holds is never overwritten.
 */
export const zipSchema = z
  .object({ with: z.string().min(1), strict: z.boolean().optional() })
  .strict();

const withinSchema = z
  .object({
    startAfter: z.string().min(1).optional(),
    endBefore: z.string().min(1).optional(),
    /**
     * A `startAfter` that does not occur widens the scope to the whole text
     * instead of emptying it — the fence is a hint about one layout, and a
     * document without the heading is not thereby item-less.
     */
    lenient: z.boolean().optional(),
  })
  .strict();

const repeatCommon = {
  within: withinSchema.optional(),
  flags: FLAGS.optional(),
  minimum: z.number().int().min(0).optional(),
  /**
   * Fields EVERY item must carry. One item without them makes the whole
   * repeat count as unread — a flight leg without its number is not a leg the
   * template understood, and dropping it quietly would answer one leg of two.
   */
  required: z.array(z.string().min(1)).optional(),
  /** Items lacking any of these values are dropped (after `zip` and `compute`). */
  skipItemsWithout: z.array(z.string().min(1)).optional(),
  zip: zipSchema.optional(),
  compute: z.record(z.string().min(1), computeSchema).optional(),
};

const matchAllRepeatSchema = z
  .object({
    ...repeatCommon,
    mode: z.literal("matchAll"),
    pattern: z.string().min(1),
    fields: z.record(z.string().min(1), itemFieldSchema),
  })
  .strict();

/**
 * Columns: a table a PDF extracts column by column — every station, then
 * every date, then every time. Each column's pattern is matched throughout the
 * scope; item i is the i-th match of every column. All columns must match
 * equally often, otherwise the repeat reads NOTHING: a time beside the wrong
 * station is worse than no time.
 */
const columnSchema = z
  .object({ pattern: z.string().min(1), group: groupRef.optional(), ...valueSteps })
  .strict();

const columnsRepeatSchema = z
  .object({
    ...repeatCommon,
    mode: z.literal("columns"),
    columns: z
      .record(z.string().min(1), columnSchema)
      .refine((c) => Object.keys(c).length > 0, "needs at least one column"),
  })
  .strict();

const pairEdgeSchema = z.object({ field: z.string().min(1), pattern: z.string().min(1) }).strict();

/**
 * Pairs: items of an EARLIER sibling repeat walked in order — an item that
 * matches `open` opens a pair (a later `open` replaces it), the next item
 * matching `close` closes it. A departure row and the arrival row after it.
 * `fields` name which side each value comes from.
 */
const pairsRepeatSchema = z
  .object({
    ...repeatCommon,
    mode: z.literal("pairs"),
    of: z.string().min(1),
    open: pairEdgeSchema,
    close: pairEdgeSchema,
    fields: z.record(
      z.string().min(1),
      z.object({ from: z.enum(["open", "close"]), field: z.string().min(1) }).strict()
    ),
  })
  .strict();

const splitCommon = {
  ...repeatCommon,
  mode: z.literal("split"),
  splitPattern: z.string().min(1),
  fields: z.record(z.string().min(1), fieldRuleSchema),
  /**
   * The document text before the first block is put in front of EVERY
   * block (and is no item of its own), so a value printed once in a
   * header — a booking code, the year of a date — is readable per item.
   */
  prependHeader: z.boolean().optional(),
  /**
   * Fewer than two blocks found: read the WHOLE document as the one item,
   * ignoring `within`. For a layout that prints a single item without the
   * separator that divides several.
   */
  wholeTextUnlessSplit: z.boolean().optional(),
  /** The text before the first block is no item (a letterhead that names a ship too). */
  skipPreamble: z.boolean().optional(),
};

const innerSplitSchema = z.object(splitCommon).strict();

export const innerRepeatSchema = z.discriminatedUnion("mode", [
  matchAllRepeatSchema,
  innerSplitSchema,
  columnsRepeatSchema,
  pairsRepeatSchema,
]);

/**
 * A split block may hold repeats of its own (one level deep): the stops of
 * each cruise, the legs of each ticket section. They read the block's text,
 * and their `compute` sees the block's fields as `{parent.name}`. With `emit`
 * the split repeat's items ARE the named nested repeats' items, block after
 * block — ticket sections that matter only for the legs they hold.
 */
const splitRepeatSchema = z
  .object({
    ...splitCommon,
    repeats: z
      .record(z.string().min(1), innerRepeatSchema)
      .refine((r) => Object.keys(r).length <= 20, "at most 20 repeats")
      .optional(),
    emit: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export const repeatRuleSchema = z.discriminatedUnion("mode", [
  matchAllRepeatSchema,
  splitRepeatSchema,
  columnsRepeatSchema,
  pairsRepeatSchema,
]);
export type RepeatRule = z.infer<typeof repeatRuleSchema>;
export type InnerRepeatRule = z.infer<typeof innerRepeatSchema>;
export type MatchAllRepeatRule = z.infer<typeof matchAllRepeatSchema>;
export type SplitRepeatRule = z.infer<typeof splitRepeatSchema>;
export type ColumnsRepeatRule = z.infer<typeof columnsRepeatSchema>;
export type PairsRepeatRule = z.infer<typeof pairsRepeatSchema>;

/**
 * Text clean-ups applied to the document before extraction (never before
 * matching): link targets a mail renders inline, zero-width marks wrapped
 * around numbers, tab runs between label and value, a table's leading pipe.
 */
export const PREPROCESS_STEPS = [
  "stripCarriageReturns",
  "stripZeroWidth",
  "stripLinks",
  "collapseSpaces",
  "stripLeadingPipe",
  "trimLines",
  "dropBlankLines",
] as const;
export type PreprocessStep = (typeof PREPROCESS_STEPS)[number];
