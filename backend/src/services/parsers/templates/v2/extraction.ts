/**
 * The `extraction` block of a v2 template — one generic, domain-agnostic
 * shape (plan 2026-10-09 P2). It replaces the opaque record of P1.
 *
 *   fields   name → FieldRule   one scalar per name
 *   repeats  name → RepeatRule  an array of objects per name (flight lines,
 *                               hotel stays, rail legs …)
 *   required names that must be non-empty (fields) or reach their minimum
 *            (repeats) for the template to count as a match
 *
 * Everything that can be checked without a document is checked HERE, at
 * validation, so a template that loads cannot fail at parse time for a
 * reason it could have been refused for: every regex source compiles with
 * its flags, a repeat pattern cannot match the empty string (it would match
 * everywhere), every matchAll group a field names exists in its pattern,
 * every transform is known, and `required` names only what is defined.
 */
import { z } from "zod";
import { TRANSFORM_NAMES } from "./transforms";

const FLAGS = z
  .string()
  .regex(/^[gimsu]*$/, "flags must be drawn from gimsu")
  .refine((f) => new Set(f).size === f.length, "flags must not repeat");

const transformSpec = z.union([z.enum(TRANSFORM_NAMES), z.array(z.enum(TRANSFORM_NAMES)).min(1)]);

const fieldRuleSchema = z
  .object({
    patterns: z.array(z.string().min(1)).min(1).max(10).optional(),
    flags: FLAGS.optional(),
    transform: transformSpec.optional(),
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
  })
  .strict()
  .refine((r) => [r.patterns, r.value, r.stacked].filter((x) => x !== undefined).length === 1, {
    message: "needs exactly one of patterns, value or stacked",
  })
  .refine((r) => r.format === undefined || r.patterns !== undefined, {
    message: "format applies to patterns only",
  });
export type FieldRule = z.infer<typeof fieldRuleSchema>;

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
};

const matchAllRepeatSchema = z
  .object({
    ...repeatCommon,
    mode: z.literal("matchAll"),
    pattern: z.string().min(1),
    fields: z.record(
      z.string().min(1),
      z
        .object({
          group: z.union([z.string().min(1), z.number().int().min(0)]),
          transform: transformSpec.optional(),
        })
        .strict()
    ),
  })
  .strict();

const splitRepeatSchema = z
  .object({
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
  })
  .strict();

const repeatRuleSchema = z.discriminatedUnion("mode", [matchAllRepeatSchema, splitRepeatSchema]);
export type RepeatRule = z.infer<typeof repeatRuleSchema>;
export type MatchAllRepeatRule = z.infer<typeof matchAllRepeatSchema>;
export type SplitRepeatRule = z.infer<typeof splitRepeatSchema>;

// ------------------------------------------------------------------ flags

export const DEFAULT_FIELD_FLAGS = "im";
export const DEFAULT_REPEAT_FLAGS = "gim";
/** `within` anchors are located once, case-insensitively, across lines. */
export const WITHIN_FLAGS = "im";

/** A field reads one value: a global flag would only make `exec` stateful. */
export function fieldFlags(flags: string | undefined): string {
  return (flags ?? DEFAULT_FIELD_FLAGS).replace("g", "");
}

/** A repeat walks every occurrence, so `g` is always on. */
export function repeatFlags(flags: string | undefined): string {
  const f = flags ?? DEFAULT_REPEAT_FLAGS;
  return f.includes("g") ? f : `g${f}`;
}

/** Compiles a template regex; returns the error message instead of throwing. */
export function tryCompile(source: string, flags: string): RegExp | string {
  try {
    return new RegExp(source, flags);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Number of capture groups and the named ones, read off a match against "". */
function groupsOf(re: RegExp): { count: number; names: string[] } {
  const probe = new RegExp(`(?:${re.source})|`, re.flags.replace("g", "")).exec("");
  return { count: probe ? probe.length - 1 : 0, names: Object.keys(probe?.groups ?? {}) };
}

// ------------------------------------------------------------------ validation

type Issue = { path: (string | number)[]; message: string };

function checkRegex(
  source: string,
  flags: string,
  path: (string | number)[],
  opts: { nonEmpty?: boolean } = {}
): { re?: RegExp; issues: Issue[] } {
  const compiled = tryCompile(source, flags);
  if (typeof compiled === "string") {
    return { issues: [{ path, message: `invalid regex: ${compiled}` }] };
  }
  if (opts.nonEmpty && new RegExp(compiled.source, flags.replace("g", "")).test("")) {
    return { re: compiled, issues: [{ path, message: "pattern matches the empty string" }] };
  }
  return { re: compiled, issues: [] };
}

/** `{1}`, `{name}` — the groups a `format` string names. */
export function formatPlaceholders(format: string): string[] {
  return Array.from(format.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*|\d+)\}/g), (m) => m[1]);
}

function checkFormat(re: RegExp, format: string, path: (string | number)[], i: number): Issue[] {
  const groups = groupsOf(re);
  return formatPlaceholders(format).flatMap((name) => {
    const exists = /^\d+$/.test(name)
      ? Number(name) >= 1 && Number(name) <= groups.count
      : groups.names.includes(name);
    return exists
      ? []
      : [{ path: [...path, "format"], message: `{${name}} is not a group of pattern ${i}` }];
  });
}

function checkField(rule: FieldRule, path: (string | number)[]): Issue[] {
  const flags = fieldFlags(rule.flags);
  return (rule.patterns ?? []).flatMap((p, i) => {
    const { re, issues } = checkRegex(p, flags, [...path, "patterns", i]);
    if (!re || rule.format === undefined) return issues;
    return [...issues, ...checkFormat(re, rule.format, path, i)];
  });
}

/** `yearFrom` must name a sibling field that is not itself year-dependent. */
function checkYearFrom(fields: Record<string, FieldRule>, path: (string | number)[]): Issue[] {
  return Object.entries(fields).flatMap(([name, rule]) => {
    if (rule.yearFrom === undefined) return [];
    const target = fields[rule.yearFrom];
    if (rule.yearFrom !== name && target && target.yearFrom === undefined) return [];
    return [
      {
        path: [...path, name, "yearFrom"],
        message: `"${rule.yearFrom}" is not a sibling field without its own yearFrom`,
      },
    ];
  });
}

function checkWithin(rule: RepeatRule, path: (string | number)[]): Issue[] {
  const within = rule.within ?? {};
  return (["startAfter", "endBefore"] as const).flatMap((key) => {
    const source = within[key];
    return source === undefined
      ? []
      : checkRegex(source, WITHIN_FLAGS, [...path, "within", key], { nonEmpty: true }).issues;
  });
}

function checkItemRequired(rule: RepeatRule, path: (string | number)[]): Issue[] {
  return (rule.required ?? []).flatMap((name, i) =>
    name in rule.fields
      ? []
      : [{ path: [...path, "required", i], message: `"${name}" is not a field of this repeat` }]
  );
}

function checkRepeat(rule: RepeatRule, path: (string | number)[]): Issue[] {
  const flags = repeatFlags(rule.flags);
  const issues = [...checkWithin(rule, path), ...checkItemRequired(rule, path)];
  if (rule.mode === "split") {
    issues.push(
      ...checkRegex(rule.splitPattern, flags, [...path, "splitPattern"], { nonEmpty: true }).issues
    );
    for (const [name, field] of Object.entries(rule.fields)) {
      issues.push(...checkField(field, [...path, "fields", name]));
    }
    issues.push(...checkYearFrom(rule.fields, [...path, "fields"]));
    return issues;
  }
  const { re, issues: patternIssues } = checkRegex(rule.pattern, flags, [...path, "pattern"], {
    nonEmpty: true,
  });
  issues.push(...patternIssues);
  if (!re) return issues;
  const groups = groupsOf(re);
  for (const [name, field] of Object.entries(rule.fields)) {
    const exists =
      typeof field.group === "number"
        ? field.group <= groups.count
        : groups.names.includes(field.group);
    if (!exists) {
      issues.push({
        path: [...path, "fields", name, "group"],
        message: `group ${JSON.stringify(field.group)} is not in the pattern`,
      });
    }
  }
  return issues;
}

export const extractionSchema = z
  .object({
    fields: z
      .record(z.string().min(1), fieldRuleSchema)
      .refine((r) => Object.keys(r).length <= 60, "at most 60 fields")
      .optional(),
    repeats: z
      .record(z.string().min(1), repeatRuleSchema)
      .refine((r) => Object.keys(r).length <= 20, "at most 20 repeats")
      .optional(),
    required: z.array(z.string().min(1)).optional(),
    /**
     * Every label the sender puts on a line of its own — the stop list of a
     * `stacked` read, so an empty field never reports the next field's value.
     */
    labels: z.array(z.string().trim().min(1)).optional(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const fields = x.fields ?? {};
    const repeats = x.repeats ?? {};
    const issues: Issue[] = [
      ...Object.entries(fields).flatMap(([name, rule]) => checkField(rule, ["fields", name])),
      ...Object.entries(repeats).flatMap(([name, rule]) => checkRepeat(rule, ["repeats", name])),
      ...checkYearFrom(fields, ["fields"]),
    ];
    for (const name of Object.keys(repeats)) {
      if (name in fields) {
        issues.push({ path: ["repeats", name], message: `"${name}" is both a field and a repeat` });
      }
    }
    (x.required ?? []).forEach((name, i) => {
      if (!(name in fields) && !(name in repeats)) {
        issues.push({ path: ["required", i], message: `"${name}" names no field or repeat` });
      }
    });
    for (const issue of issues) ctx.addIssue({ code: "custom", ...issue });
  });

export type Extraction = z.infer<typeof extractionSchema>;
