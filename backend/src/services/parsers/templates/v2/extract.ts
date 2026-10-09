import vm from "vm";
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
import { repeatFlags, WITHIN_FLAGS, type Extraction, type RepeatRule } from "./extraction";
import { compileFields, makeScope, readFields, type CompiledField } from "./fieldReader";
import { applyTransforms, type TransformValue } from "./transforms";

export const MAX_INPUT_CHARS = 200_000;
export const MAX_REPEAT_ITEMS = 200;

export interface ExtractionResult {
  values: Record<string, unknown>;
  missing: string[];
  /** True when the run hit `EXTRACT_TIMEOUT_MS` and was stopped. */
  timedOut?: boolean;
}

interface CompiledWithin {
  readonly startAfter?: RegExp;
  readonly endBefore?: RegExp;
  readonly lenient: boolean;
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
  readonly labels: readonly string[];
}

const compiledCache = new WeakMap<Extraction, Compiled>();

function compileRepeat(rule: RepeatRule): CompiledRepeat {
  const within: CompiledWithin = {
    startAfter: rule.within?.startAfter
      ? new RegExp(rule.within.startAfter, WITHIN_FLAGS)
      : undefined,
    endBefore: rule.within?.endBefore ? new RegExp(rule.within.endBefore, WITHIN_FLAGS) : undefined,
    lenient: rule.within?.lenient ?? false,
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
    labels: extraction.labels ?? [],
  };
  compiledCache.set(extraction, compiled);
  return compiled;
}

// ------------------------------------------------------------------ repeats

/** Where in `text` a repeat looks: [start, end), or null when a strict `startAfter` is absent. */
function region(text: string, within: CompiledWithin): { start: number; end: number } | null {
  let start = 0;
  if (within.startAfter) {
    const m = within.startAfter.exec(text);
    if (m) start = m.index + m[0].length;
    else if (!within.lenient) return null;
  }
  let end = text.length;
  if (within.endBefore) {
    const m = within.endBefore.exec(text.slice(start));
    if (m) end = start + m.index;
  }
  return { start, end };
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

/** Block start offsets (absolute in `text`) of every split match inside the region. */
function blockStarts(
  repeat: Extract<CompiledRepeat, { mode: "split" }>,
  text: string,
  start: number,
  end: number
): number[] {
  const starts: number[] = [];
  for (const m of text.slice(start, end).matchAll(repeat.splitPattern)) {
    const at = start + m.index;
    if (starts.length === 0 || at > starts[starts.length - 1]) starts.push(at);
    if (starts.length > MAX_REPEAT_ITEMS) break;
  }
  return starts;
}

/**
 * Split mode: a block starts at each match of `splitPattern` (the match is
 * part of its block, so a header line stays readable) and runs to the next.
 * Text between the region's start and the first match is a block too — for a
 * separator-style pattern it is the first item; for a header-style one it
 * reads nothing and is dropped. With `prependHeader` the document text before
 * the first match is put in front of every block instead and is no item.
 */
function splitItems(
  repeat: Extract<CompiledRepeat, { mode: "split" }>,
  text: string,
  labels: readonly string[]
): Item[] {
  const { rule } = repeat;
  const read = (block: string): Item[] => {
    const { values, readAnything } = readFields(repeat.fields, makeScope(block, labels));
    return keep(values, readAnything);
  };
  const bounds = region(text, repeat.within);
  const starts = bounds ? blockStarts(repeat, text, bounds.start, bounds.end) : [];
  if (rule.wholeTextUnlessSplit && starts.length < 2) return read(text);
  if (!bounds) return [];

  const header = rule.prependHeader && starts.length > 0 ? text.slice(0, starts[0]) : null;
  const cuts = header === null ? [bounds.start, ...starts] : starts;
  const items: Item[] = [];
  for (const [i, at] of cuts.entries()) {
    const next = cuts[i + 1] ?? bounds.end;
    if (next <= at && i + 1 < cuts.length) continue;
    const block = text.slice(at, next);
    items.push(...read(header === null ? block : `${header}\n${block}`));
    if (items.length >= MAX_REPEAT_ITEMS) break;
  }
  return items;
}

function readRepeat(repeat: CompiledRepeat, text: string, labels: readonly string[]): Item[] {
  if (repeat.mode === "split") return splitItems(repeat, text, labels);
  const bounds = region(text, repeat.within);
  if (!bounds) return [];
  const scope = text.slice(bounds.start, bounds.end);
  return scope === "" ? [] : matchAllItems(repeat, scope);
}

// ------------------------------------------------------------------ entry

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Reads every field and repeat of `extraction` from `text`, and names what `required` lacks. */
function extractUnbounded(extraction: Extraction, text: string): ExtractionResult {
  const compiled = compile(extraction);
  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  const values: Record<string, unknown> = {
    ...readFields(compiled.fields, makeScope(input, compiled.labels)).values,
  };
  for (const [name, repeat] of compiled.repeats) {
    values[name] = readRepeat(repeat, input, compiled.labels);
  }

  const missing = (extraction.required ?? []).filter((name) => {
    const repeat = compiled.repeats.get(name);
    if (!repeat) return isEmpty(values[name]);
    const items = values[name] as Item[];
    const itemRequired = repeat.rule.required ?? [];
    const incomplete = items.some((item) => itemRequired.some((field) => isEmpty(item[field])));
    return incomplete || items.length < (repeat.rule.minimum ?? 1);
  });
  return { values, missing };
}

/** Wall-clock budget for one extraction; a document never needs more than a few ms. */
export const EXTRACT_TIMEOUT_MS = 1000;

/**
 * Runs the extraction under a hard time bound. A `vm` timeout terminates
 * execution even inside a backtracking regex, so a pathological pattern from the
 * template repo costs one second, not the server. A timed-out run
 * extracts nothing and reports every required name as missing, so the
 * template declines the document (and fails its own test cases at load).
 */
export function extract(extraction: Extraction, text: string): ExtractionResult {
  try {
    return vm.runInNewContext(
      "run()",
      { run: () => extractUnbounded(extraction, text) },
      {
        timeout: EXTRACT_TIMEOUT_MS,
      }
    ) as ExtractionResult;
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw err;
    return { values: {}, missing: [...(extraction.required ?? [])], timedOut: true };
  }
}

/**
 * Runs any template-supplied regex test under the same bound as `extract`.
 * Every regex a template brings (not only the extraction rules — also e.g.
 * `match.notBookingIf`) is remote input and must never run unbounded. A
 * timed-out test answers false: the pattern decided nothing.
 */
export function boundedTest(source: string, flags: string, text: string): boolean {
  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  try {
    return vm.runInNewContext(
      "run()",
      { run: () => new RegExp(source, flags).test(input) },
      {
        timeout: EXTRACT_TIMEOUT_MS,
      }
    ) as boolean;
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw err;
    return false;
  }
}
