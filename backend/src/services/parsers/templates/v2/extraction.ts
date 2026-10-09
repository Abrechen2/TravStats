/**
 * The `extraction` block of a v2 template — one generic, domain-agnostic
 * shape (plan 2026-10-09 P2, extended in P4b). The rule shapes live in
 * extractionRules.ts; this file validates a whole block.
 *
 *   fields     name → FieldRule   one scalar per name
 *   repeats    name → RepeatRule  an array of objects per name (flight lines,
 *                                 hotel stays, rail legs …), read in order
 *   required   names that must be non-empty (fields) or reach their minimum
 *              (repeats) for the template to count as a match
 *   labels     the stop list of a `stacked` read
 *   preprocess text clean-ups applied before extraction
 *
 * Everything that can be checked without a document is checked HERE, at
 * validation, so a template that loads cannot fail at parse time for a
 * reason it could have been refused for: every regex source compiles with
 * its flags, a repeat pattern cannot match the empty string (it would match
 * everywhere), every group a rule names exists in its pattern, every
 * transform is known, a repeat names only EARLIER siblings (`zip`, `pairs`),
 * and `required` names only what is defined.
 */
import { z } from "zod";
import {
  fieldRuleSchema,
  PREPROCESS_STEPS,
  repeatRuleSchema,
  type ComputeRule,
  type FieldRule,
  type InnerRepeatRule,
  type ItemFieldRule,
  type RepeatRule,
} from "./extractionRules";
import { specFlags, specSource, type RegexSpec } from "./regexSpec";

export type {
  ColumnsRepeatRule,
  ComputeRule,
  FieldRule,
  InnerRepeatRule,
  ItemFieldRule,
  MatchAllRepeatRule,
  PairsRepeatRule,
  RepeatRule,
  SplitRepeatRule,
} from "./extractionRules";

// ------------------------------------------------------------------ flags

export const DEFAULT_FIELD_FLAGS = "im";
export const DEFAULT_REPEAT_FLAGS = "gim";
/** `within` anchors are located once, case-insensitively, across lines. */
export const WITHIN_FLAGS = "im";
/** `find`, `lastBefore` and `map` patterns without flags of their own. */
export const DEFAULT_SPEC_FLAGS = "im";

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

function hasGroup(re: RegExp, group: string | number): boolean {
  const groups = groupsOf(re);
  return typeof group === "number" ? group <= groups.count : groups.names.includes(group);
}

// ------------------------------------------------------------------ validation

type Path = (string | number)[];
type Issue = { path: Path; message: string };

function checkRegex(
  source: string,
  flags: string,
  path: Path,
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

function checkSpec(spec: RegexSpec | undefined, path: Path, nonEmpty = false): Issue[] {
  if (spec === undefined) return [];
  const flags = specFlags(spec, DEFAULT_SPEC_FLAGS).replace("g", "");
  return checkRegex(specSource(spec), flags, path, { nonEmpty }).issues;
}

/** `{1}`, `{name}`, `{parent.name}` — the placeholders a format string names. */
export function formatPlaceholders(format: string): string[] {
  return Array.from(format.matchAll(/\{((?:parent\.)?[A-Za-z_][A-Za-z0-9_]*|\d+)\}/g), (m) => m[1]);
}

function checkFormat(re: RegExp, format: string, path: Path, i: number): Issue[] {
  return formatPlaceholders(format).flatMap((name) =>
    hasGroup(re, /^\d+$/.test(name) ? Number(name) : name)
      ? []
      : [{ path: [...path, "format"], message: `{${name}} is not a group of pattern ${i}` }]
  );
}

/** `replace` and `map` regexes compile. */
function checkValueSteps(
  rule: Pick<FieldRule, "replace" | "map"> | Pick<ComputeRule, "replace" | "map">,
  path: Path
): Issue[] {
  const issues: Issue[] = [];
  (rule.replace ?? []).forEach(([pattern, , flags], i) => {
    issues.push(...checkRegex(pattern, flags ?? "g", [...path, "replace", i]).issues);
  });
  (rule.map ?? []).forEach(([pattern], i) => {
    issues.push(...checkRegex(pattern, "i", [...path, "map", i]).issues);
  });
  return issues;
}

function checkField(rule: FieldRule, path: Path): Issue[] {
  const flags = fieldFlags(rule.flags);
  const patternIssues = (rule.patterns ?? []).flatMap((p, i) => {
    const { re, issues } = checkRegex(p, flags, [...path, "patterns", i]);
    if (!re || rule.format === undefined) return issues;
    return [...issues, ...checkFormat(re, rule.format, path, i)];
  });
  return [...patternIssues, ...checkValueSteps(rule, path)];
}

/** `yearFrom` must name a sibling field that is not itself year-dependent. */
function checkYearFrom(fields: Record<string, FieldRule>, path: Path): Issue[] {
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

function checkWithin(rule: InnerRepeatRule | RepeatRule, path: Path): Issue[] {
  const within = rule.within ?? {};
  return (["startAfter", "endBefore"] as const).flatMap((key) => {
    const source = within[key];
    return source === undefined
      ? []
      : checkRegex(source, WITHIN_FLAGS, [...path, "within", key], { nonEmpty: true }).issues;
  });
}

function checkItemField(
  field: ItemFieldRule,
  pattern: RegExp | undefined,
  path: Path,
  hasPattern: boolean
): Issue[] {
  const issues = [
    ...checkSpec(field.find, [...path, "find"]),
    ...checkSpec(field.lastBefore, [...path, "lastBefore"], true),
    ...checkValueSteps(field, path),
  ];
  if (!pattern) return issues;
  if (field.group !== undefined && !hasGroup(pattern, field.group)) {
    issues.push({
      path: [...path, "group"],
      message: `group ${JSON.stringify(field.group)} is not in the pattern`,
    });
  }
  if (field.format !== undefined && hasPattern) {
    for (const name of formatPlaceholders(field.format)) {
      if (!hasGroup(pattern, /^\d+$/.test(name) ? Number(name) : name)) {
        issues.push({ path: [...path, "format"], message: `{${name}} is not in the pattern` });
      }
    }
  }
  return issues;
}

/** The value names an item of `rule` can carry, before zipping. */
function itemNames(rule: InnerRepeatRule | RepeatRule): Set<string> {
  const own =
    rule.mode === "columns" ? Object.keys(rule.columns) : Object.keys(rule.fields as object);
  const nested = rule.mode === "split" && "repeats" in rule ? Object.keys(rule.repeats ?? {}) : [];
  return new Set([...own, ...nested, ...Object.keys(rule.compute ?? {})]);
}

function checkItemNames(
  rule: InnerRepeatRule | RepeatRule,
  siblings: ReadonlyMap<string, InnerRepeatRule | RepeatRule>,
  path: Path
): Issue[] {
  const names = itemNames(rule);
  const zipped = rule.zip ? siblings.get(rule.zip.with) : undefined;
  if (zipped) for (const n of itemNames(zipped)) names.add(n);
  const check = (key: "required" | "skipItemsWithout"): Issue[] =>
    (rule[key] ?? []).flatMap((name, i) =>
      names.has(name)
        ? []
        : [{ path: [...path, key, i], message: `"${name}" is not a field of this repeat` }]
    );
  return [...check("required"), ...check("skipItemsWithout")];
}

function checkModeSpecific(
  rule: InnerRepeatRule | RepeatRule,
  siblings: ReadonlyMap<string, InnerRepeatRule | RepeatRule>,
  path: Path
): Issue[] {
  const flags = repeatFlags(rule.flags);
  switch (rule.mode) {
    case "split": {
      const issues = checkRegex(rule.splitPattern, flags, [...path, "splitPattern"], {
        nonEmpty: true,
      }).issues;
      for (const [name, field] of Object.entries(rule.fields)) {
        issues.push(...checkField(field, [...path, "fields", name]));
      }
      issues.push(...checkYearFrom(rule.fields, [...path, "fields"]));
      const nested = "repeats" in rule ? (rule.repeats ?? {}) : {};
      issues.push(...checkRepeats(nested, [...path, "repeats"]));
      const emit = "emit" in rule ? (rule.emit ?? []) : [];
      emit.forEach((name, i) => {
        if (!(name in nested)) {
          issues.push({ path: [...path, "emit", i], message: `"${name}" is no nested repeat` });
        }
      });
      return issues;
    }
    case "matchAll": {
      const { re, issues } = checkRegex(rule.pattern, flags, [...path, "pattern"], {
        nonEmpty: true,
      });
      for (const [name, field] of Object.entries(rule.fields)) {
        issues.push(...checkItemField(field, re, [...path, "fields", name], true));
      }
      return issues;
    }
    case "columns":
      return Object.entries(rule.columns).flatMap(([name, column]) => {
        const at = [...path, "columns", name];
        const { re, issues } = checkRegex(column.pattern, flags, [...at, "pattern"], {
          nonEmpty: true,
        });
        if (re && column.group !== undefined && !hasGroup(re, column.group)) {
          issues.push({ path: [...at, "group"], message: "group is not in the pattern" });
        }
        return [...issues, ...checkValueSteps(column, at)];
      });
    case "pairs": {
      const source = siblings.get(rule.of);
      if (!source) {
        return [{ path: [...path, "of"], message: `"${rule.of}" is no earlier sibling repeat` }];
      }
      const names = itemNames(source);
      const issues = (["open", "close"] as const).flatMap((edge) => [
        ...checkRegex(rule[edge].pattern, "i", [...path, edge, "pattern"]).issues,
        ...(names.has(rule[edge].field)
          ? []
          : [{ path: [...path, edge, "field"], message: `"${rule[edge].field}" is not a value` }]),
      ]);
      for (const [name, field] of Object.entries(rule.fields)) {
        if (!names.has(field.field)) {
          issues.push({
            path: [...path, "fields", name, "field"],
            message: `"${field.field}" is not a value of "${rule.of}"`,
          });
        }
      }
      return issues;
    }
  }
}

function checkRepeat(
  rule: InnerRepeatRule | RepeatRule,
  siblings: ReadonlyMap<string, InnerRepeatRule | RepeatRule>,
  path: Path
): Issue[] {
  const issues = [
    ...checkWithin(rule, path),
    ...checkModeSpecific(rule, siblings, path),
    ...checkItemNames(rule, siblings, path),
  ];
  if (rule.zip && !siblings.has(rule.zip.with)) {
    issues.push({
      path: [...path, "zip", "with"],
      message: `"${rule.zip.with}" is no earlier sibling repeat`,
    });
  }
  for (const [name, compute] of Object.entries(rule.compute ?? {})) {
    const at = [...path, "compute", name];
    issues.push(...checkSpec(compute.find, [...at, "find"]), ...checkValueSteps(compute, at));
  }
  return issues;
}

/** Repeats in declaration order: each may only name the ones before it. */
function checkRepeats(repeats: Record<string, InnerRepeatRule | RepeatRule>, path: Path): Issue[] {
  const before = new Map<string, InnerRepeatRule | RepeatRule>();
  const issues: Issue[] = [];
  for (const [name, rule] of Object.entries(repeats)) {
    issues.push(...checkRepeat(rule, before, [...path, name]));
    before.set(name, rule);
  }
  return issues;
}

export const extractionSchema = z
  .object({
    fields: z.record(z.string().min(1), fieldRuleSchema).optional(),
    repeats: z.record(z.string().min(1), repeatRuleSchema).optional(),
    required: z.array(z.string().min(1)).optional(),
    /**
     * Every label the sender puts on a line of its own — the stop list of a
     * `stacked` read, so an empty field never reports the next field's value.
     */
    labels: z.array(z.string().trim().min(1)).optional(),
    preprocess: z.array(z.enum(PREPROCESS_STEPS)).optional(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const fields = x.fields ?? {};
    const repeats = x.repeats ?? {};
    const issues: Issue[] = [
      ...Object.entries(fields).flatMap(([name, rule]) => checkField(rule, ["fields", name])),
      ...checkRepeats(repeats, ["repeats"]),
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
