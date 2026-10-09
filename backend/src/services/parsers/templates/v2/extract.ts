/**
 * The generic v2 extraction engine (plan 2026-10-09 P2): reads an
 * `extraction` block against a document's text. Domain-agnostic on purpose —
 * what a value MEANS (a flight leg, a stay) is decided by the consumer (P3),
 * not here.
 *
 * Regexes are compiled once per extraction object and cached in a WeakMap,
 * so a template parsed from JSON pays compilation once for as long as it is
 * active. The engine assumes a VALIDATED extraction: every source compiles
 * and every group exists (extraction.ts refuses anything else).
 *
 * Template regexes are community-written, so the work is bounded: the input
 * is capped at {@link MAX_INPUT_CHARS} characters and each repeat at
 * {@link MAX_REPEAT_ITEMS} items. A regex can still backtrack badly on the
 * capped input; the cap bounds how bad.
 */
import {
  fieldFlags,
  repeatFlags,
  WITHIN_FLAGS,
  type Extraction,
  type FieldRule,
  type RepeatRule,
} from "./extraction";
import { applyTransforms, type TransformValue } from "./transforms";

export const MAX_INPUT_CHARS = 200_000;
export const MAX_REPEAT_ITEMS = 200;

export interface ExtractionResult {
  values: Record<string, unknown>;
  missing: string[];
}

interface CompiledField {
  readonly rule: FieldRule;
  readonly patterns: readonly RegExp[];
}

interface CompiledWithin {
  readonly startAfter?: RegExp;
  readonly endBefore?: RegExp;
}

type CompiledRepeat =
  | {
      readonly mode: "matchAll";
      readonly rule: Extract<RepeatRule, { mode: "matchAll" }>;
      readonly within: CompiledWithin;
      readonly pattern: RegExp;
    }
  | {
      readonly mode: "split";
      readonly rule: Extract<RepeatRule, { mode: "split" }>;
      readonly within: CompiledWithin;
      readonly splitPattern: RegExp;
      readonly fields: ReadonlyMap<string, CompiledField>;
    };

interface Compiled {
  readonly fields: ReadonlyMap<string, CompiledField>;
  readonly repeats: ReadonlyMap<string, CompiledRepeat>;
}

const compiledCache = new WeakMap<Extraction, Compiled>();

function compileField(rule: FieldRule): CompiledField {
  const flags = fieldFlags(rule.flags);
  return { rule, patterns: (rule.patterns ?? []).map((p) => new RegExp(p, flags)) };
}

function compileFields(fields: Record<string, FieldRule> | undefined): Map<string, CompiledField> {
  return new Map(Object.entries(fields ?? {}).map(([name, rule]) => [name, compileField(rule)]));
}

function compileRepeat(rule: RepeatRule): CompiledRepeat {
  const within: CompiledWithin = {
    startAfter: rule.within?.startAfter
      ? new RegExp(rule.within.startAfter, WITHIN_FLAGS)
      : undefined,
    endBefore: rule.within?.endBefore ? new RegExp(rule.within.endBefore, WITHIN_FLAGS) : undefined,
  };
  const flags = repeatFlags(rule.flags);
  if (rule.mode === "matchAll") {
    return { mode: "matchAll", rule, within, pattern: new RegExp(rule.pattern, flags) };
  }
  return {
    mode: "split",
    rule,
    within,
    splitPattern: new RegExp(rule.splitPattern, flags),
    fields: compileFields(rule.fields),
  };
}

function compile(extraction: Extraction): Compiled {
  const cached = compiledCache.get(extraction);
  if (cached) return cached;
  const compiled: Compiled = {
    fields: compileFields(extraction.fields),
    repeats: new Map(
      Object.entries(extraction.repeats ?? {}).map(([name, rule]) => [name, compileRepeat(rule)])
    ),
  };
  compiledCache.set(extraction, compiled);
  return compiled;
}

// ------------------------------------------------------------------ fields

/** The value of a match: named group "v" when present, else group 1, else the whole match. */
function captured(m: RegExpExecArray): string | undefined {
  if (m.groups && "v" in m.groups) return m.groups.v;
  return m.length > 1 ? m[1] : m[0];
}

interface FieldRead {
  readonly value: TransformValue;
  /** Whether the text contributed anything — a constant or a defaulted transform does not. */
  readonly read: boolean;
}

/** First pattern whose capture survives the transforms wins; otherwise the transforms see null. */
function readField(field: CompiledField, text: string): FieldRead {
  const { rule } = field;
  if (rule.value !== undefined) {
    return { value: applyTransforms(rule.value, rule.transform), read: false };
  }
  for (const re of field.patterns) {
    const m = re.exec(text);
    const raw = m ? captured(m) : undefined;
    if (raw === undefined || raw.trim() === "") continue;
    const value = applyTransforms(raw, rule.transform);
    if (value !== null) return { value, read: true };
  }
  return { value: applyTransforms(null, rule.transform), read: false };
}

// ------------------------------------------------------------------ repeats

function slice(text: string, within: CompiledWithin): string {
  let out = text;
  if (within.startAfter) {
    const m = within.startAfter.exec(out);
    if (!m) return "";
    out = out.slice(m.index + m[0].length);
  }
  if (within.endBefore) {
    const m = within.endBefore.exec(out);
    if (m) out = out.slice(0, m.index);
  }
  return out;
}

type Item = Record<string, TransformValue>;

/** An item the text contributed nothing to is noise (a blank block, a preamble) and is dropped. */
function keep(item: Item, readAnything: boolean): Item[] {
  return readAnything ? [item] : [];
}

function matchAllItems(repeat: Extract<CompiledRepeat, { mode: "matchAll" }>, text: string) {
  const items: Item[] = [];
  for (const m of text.matchAll(repeat.pattern)) {
    let readAnything = false;
    const item: Item = {};
    for (const [name, field] of Object.entries(repeat.rule.fields)) {
      const raw = typeof field.group === "number" ? m[field.group] : m.groups?.[field.group];
      const hasRaw = raw !== undefined && raw.trim() !== "";
      readAnything ||= hasRaw;
      item[name] = applyTransforms(hasRaw ? raw : null, field.transform);
    }
    items.push(...keep(item, readAnything));
    if (items.length >= MAX_REPEAT_ITEMS) break;
  }
  return items;
}

/**
 * Split mode: a block starts at each match of `splitPattern` (the match is
 * part of its block, so a header line stays readable) and runs to the next.
 * Text before the first match is a block too — for a separator-style
 * pattern it is the first item; for a header-style one it reads nothing and
 * is dropped.
 */
function splitItems(repeat: Extract<CompiledRepeat, { mode: "split" }>, text: string) {
  const starts = [0];
  for (const m of text.matchAll(repeat.splitPattern)) {
    if (m.index > starts[starts.length - 1]) starts.push(m.index);
    if (starts.length > MAX_REPEAT_ITEMS + 1) break;
  }
  const items: Item[] = [];
  for (const [i, start] of starts.entries()) {
    const block = text.slice(start, starts[i + 1] ?? text.length);
    let readAnything = false;
    const item: Item = {};
    for (const [name, field] of repeat.fields) {
      const read = readField(field, block);
      readAnything ||= read.read;
      item[name] = read.value;
    }
    items.push(...keep(item, readAnything));
    if (items.length >= MAX_REPEAT_ITEMS) break;
  }
  return items;
}

function readRepeat(repeat: CompiledRepeat, text: string): Item[] {
  const scope = slice(text, repeat.within);
  if (scope === "") return [];
  return repeat.mode === "matchAll" ? matchAllItems(repeat, scope) : splitItems(repeat, scope);
}

// ------------------------------------------------------------------ entry

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Reads every field and repeat of `extraction` from `text`, and names what `required` lacks. */
export function extract(extraction: Extraction, text: string): ExtractionResult {
  const compiled = compile(extraction);
  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  const values: Record<string, unknown> = {};
  for (const [name, field] of compiled.fields) values[name] = readField(field, input).value;
  for (const [name, repeat] of compiled.repeats) values[name] = readRepeat(repeat, input);

  const missing = (extraction.required ?? []).filter((name) => {
    const repeat = compiled.repeats.get(name);
    if (!repeat) return isEmpty(values[name]);
    const items = values[name] as unknown[];
    return items.length < (repeat.rule.minimum ?? 1);
  });
  return { values, missing };
}
