/**
 * Reading the `repeats` of one scope — the document, or one block of a split
 * repeat (plan 2026-10-09 P2, extended in P4b). Domain-agnostic: an item is a
 * record of values, never a flight or a stay.
 *
 * A scope's repeats are read in declaration order, so a later one can build
 * on an earlier one (`zip`, `pairs`). Each repeat's items then go through the
 * same pipeline whatever their mode: zip → compute → skipItemsWithout.
 *
 * Regexes are compiled once per rule object (WeakMap). Every list is capped at
 * {@link MAX_REPEAT_ITEMS} items.
 */
import {
  DEFAULT_SPEC_FLAGS,
  repeatFlags,
  WITHIN_FLAGS,
  type ColumnsRepeatRule,
  type ComputeRule,
  type InnerRepeatRule,
  type ItemFieldRule,
  type MatchAllRepeatRule,
  type PairsRepeatRule,
  type RepeatRule,
  type SplitRepeatRule,
} from "./extraction";
import { compileFields, makeScope, readFields, type CompiledField } from "./fieldReader";
import { compileSpec } from "./regexSpec";
import { applyValueSteps, findIn, type StepValue } from "./valueSteps";

export const MAX_REPEAT_ITEMS = 200;

/** One item of a repeat: values, and the nested repeats of a split block. */
export type Item = Record<string, StepValue | Item[]>;
type AnyRule = RepeatRule | InnerRepeatRule;

export interface ScopeContext {
  readonly labels: readonly string[];
  /** The enclosing scope's field values, for `{parent.name}`. */
  readonly parent: Readonly<Record<string, unknown>>;
}

// ------------------------------------------------------------------ compile

interface CompiledWithin {
  readonly startAfter?: RegExp;
  readonly endBefore?: RegExp;
  readonly lenient: boolean;
}

const withinCache = new WeakMap<object, CompiledWithin>();
const patternCache = new WeakMap<object, RegExp>();
const fieldsCache = new WeakMap<object, Map<string, CompiledField>>();

function withinOf(rule: AnyRule): CompiledWithin {
  const hit = withinCache.get(rule);
  if (hit) return hit;
  const compiled: CompiledWithin = {
    startAfter: rule.within?.startAfter
      ? new RegExp(rule.within.startAfter, WITHIN_FLAGS)
      : undefined,
    endBefore: rule.within?.endBefore ? new RegExp(rule.within.endBefore, WITHIN_FLAGS) : undefined,
    lenient: rule.within?.lenient ?? false,
  };
  withinCache.set(rule, compiled);
  return compiled;
}

/** A pattern of `owner` compiled with the repeat's flags (global). */
function repeatPattern(owner: object, source: string, flags: string | undefined): RegExp {
  const hit = patternCache.get(owner);
  if (hit) return hit;
  const re = new RegExp(source, repeatFlags(flags));
  patternCache.set(owner, re);
  return re;
}

function splitFields(rule: SplitRepeatRule): Map<string, CompiledField> {
  let hit = fieldsCache.get(rule);
  if (!hit) {
    hit = compileFields(rule.fields);
    fieldsCache.set(rule, hit);
  }
  return hit;
}

// ------------------------------------------------------------------ helpers

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

function groupValue(m: RegExpMatchArray, group: string | number | undefined): string | undefined {
  if (group === undefined) {
    if (m.groups && "v" in m.groups) return m.groups.v;
    return m.length > 1 ? m[1] : m[0];
  }
  return typeof group === "number" ? m[group] : m.groups?.[group];
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** `{1}`, `{name}` filled from a match; undefined when a named group is empty. */
function formatFromMatch(m: RegExpMatchArray, format: string): string | undefined {
  let out = format;
  for (const ph of format.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*|\d+)\}/g)) {
    const raw = groupValue(m, /^\d+$/.test(ph[1]) ? Number(ph[1]) : ph[1]);
    if (raw === undefined || raw.trim() === "") return undefined;
    out = out.split(ph[0]).join(raw.trim());
  }
  return out;
}

// ------------------------------------------------------------------ matchAll

function lastBeforeValue(field: ItemFieldRule, scope: string, at: number): string | null {
  if (field.lastBefore === undefined) return null;
  const re = compileSpec(field.lastBefore, DEFAULT_SPEC_FLAGS);
  const global = new RegExp(re.source, `g${re.flags}`);
  let last: string | null = null;
  for (const m of scope.matchAll(global)) {
    if ((m.index ?? 0) >= at) break;
    last = groupValue(m, undefined) ?? null;
  }
  return last;
}

function itemFieldValue(
  field: ItemFieldRule,
  m: RegExpMatchArray,
  scope: string
): { value: StepValue; read: boolean } {
  let raw: string | null;
  let read = false;
  if (field.value !== undefined) raw = field.value;
  else if (field.lastBefore !== undefined) raw = lastBeforeValue(field, scope, m.index ?? 0);
  else {
    const source =
      field.format !== undefined ? formatFromMatch(m, field.format) : groupValue(m, field.group);
    raw = source === undefined || source.trim() === "" ? null : source;
    read = raw !== null;
  }
  if (raw !== null && field.find !== undefined) raw = findIn(raw, field.find);
  return { value: applyValueSteps(raw, field), read };
}

function matchAllItems(rule: MatchAllRepeatRule, scope: string): Item[] {
  const items: Item[] = [];
  for (const m of scope.matchAll(repeatPattern(rule, rule.pattern, rule.flags))) {
    let readAnything = false;
    const item: Item = {};
    for (const [name, field] of Object.entries(rule.fields)) {
      const { value, read } = itemFieldValue(field, m, scope);
      readAnything ||= read;
      item[name] = value;
    }
    // An item the text contributed nothing to is noise and is dropped.
    if (readAnything) items.push(item);
    if (items.length >= MAX_REPEAT_ITEMS) break;
  }
  return items;
}

// ------------------------------------------------------------------ columns / pairs

const columnCache = new WeakMap<object, RegExp>();

function columnItems(rule: ColumnsRepeatRule, scope: string): Item[] {
  const columns = Object.entries(rule.columns).map(([name, column]) => {
    let re = columnCache.get(column);
    if (!re) {
      re = new RegExp(column.pattern, repeatFlags(rule.flags));
      columnCache.set(column, re);
    }
    const values = Array.from(scope.matchAll(re), (m) => {
      const raw = groupValue(m, column.group);
      return applyValueSteps(raw === undefined || raw.trim() === "" ? null : raw, column);
    });
    return [name, values] as const;
  });
  const count = columns[0][1].length;
  // Paired by position, which is only sound while every column is as long.
  if (columns.some(([, values]) => values.length !== count)) return [];
  return Array.from({ length: Math.min(count, MAX_REPEAT_ITEMS) }, (_, i) =>
    Object.fromEntries(columns.map(([name, values]) => [name, values[i]]))
  );
}

function pairItems(rule: PairsRepeatRule, siblings: ReadonlyMap<string, Item[]>): Item[] {
  const opens = new RegExp(rule.open.pattern, "i");
  const closes = new RegExp(rule.close.pattern, "i");
  const text = (item: Item, field: string): string => {
    const value = item[field];
    return value === null || value === undefined || Array.isArray(value) ? "" : String(value);
  };
  const items: Item[] = [];
  let open: Item | null = null;
  for (const item of siblings.get(rule.of) ?? []) {
    if (opens.test(text(item, rule.open.field))) {
      open = item;
    } else if (open && closes.test(text(item, rule.close.field))) {
      const sides = { open, close: item };
      items.push(
        Object.fromEntries(
          Object.entries(rule.fields).map(([name, ref]) => [
            name,
            sides[ref.from][ref.field] ?? null,
          ])
        )
      );
      open = null;
    }
    if (items.length >= MAX_REPEAT_ITEMS) break;
  }
  return items;
}

// ------------------------------------------------------------------ split

/** Block start offsets (absolute in `text`) of every split match inside the region. */
function blockStarts(rule: SplitRepeatRule, text: string, start: number, end: number): number[] {
  const starts: number[] = [];
  for (const m of text
    .slice(start, end)
    .matchAll(repeatPattern(rule, rule.splitPattern, rule.flags))) {
    const at = start + (m.index ?? 0);
    if (starts.length === 0 || at > starts[starts.length - 1]) starts.push(at);
    if (starts.length > MAX_REPEAT_ITEMS) break;
  }
  return starts;
}

/** The block's fields, its nested repeats, and whether it read anything at all. */
function readBlock(rule: SplitRepeatRule, block: string, ctx: ScopeContext): Item[] {
  const { values, readAnything } = readFields(splitFields(rule), makeScope(block, ctx.labels));
  const nested = rule.repeats
    ? readRepeats(rule.repeats, block, { labels: ctx.labels, parent: values })
    : new Map<string, Item[]>();
  if (rule.emit) return rule.emit.flatMap((name) => nested.get(name) ?? []);
  const nestedRead = Array.from(nested.values()).some((items) => items.length > 0);
  return readAnything || nestedRead ? [{ ...values, ...Object.fromEntries(nested) }] : [];
}

/**
 * Split mode: a block starts at each match of `splitPattern` (the match is
 * part of its block, so a header line stays readable) and runs to the next.
 * Text between the region's start and the first match is a block too, unless
 * `skipPreamble` — for a separator-style pattern it is the first item; for a
 * header-style one it usually reads nothing and is dropped. With
 * `prependHeader` the document text before the first match is put in front of
 * every block instead and is no item.
 */
function splitItems(rule: SplitRepeatRule, text: string, ctx: ScopeContext): Item[] {
  const read = (block: string): Item[] => readBlock(rule, block, ctx);
  const bounds = region(text, withinOf(rule));
  const starts = bounds ? blockStarts(rule, text, bounds.start, bounds.end) : [];
  if (rule.wholeTextUnlessSplit && starts.length < 2) return read(text);
  if (!bounds) return [];

  const header = rule.prependHeader && starts.length > 0 ? text.slice(0, starts[0]) : null;
  const cuts = header === null && !rule.skipPreamble ? [bounds.start, ...starts] : starts;
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

// ------------------------------------------------------------------ pipeline

function zipItems(rule: AnyRule, items: Item[], siblings: ReadonlyMap<string, Item[]>): Item[] {
  if (!rule.zip) return items;
  const other = siblings.get(rule.zip.with) ?? [];
  if (rule.zip.strict && other.length !== items.length) return items;
  return items.map((item, i) => {
    const merged: Item = { ...item };
    for (const [key, value] of Object.entries(other[i] ?? {})) {
      if (isBlank(merged[key])) merged[key] = value;
    }
    return merged;
  });
}

/** `{name}` from the item, `{parent.name}` from the enclosing scope; null when one is blank. */
function computeValue(
  compute: ComputeRule,
  item: Item,
  parent: Record<string, unknown>
): StepValue {
  let raw: string | null = compute.format;
  for (const ph of compute.format.matchAll(/\{((?:parent\.)?[A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const key = ph[1];
    const value = key.startsWith("parent.") ? parent[key.slice(7)] : item[key];
    if (isBlank(value) || Array.isArray(value) || typeof value === "object") {
      raw = null;
      break;
    }
    raw = raw.split(ph[0]).join(String(value));
  }
  if (raw !== null && compute.find !== undefined) raw = findIn(raw, compute.find);
  return applyValueSteps(raw, compute);
}

function computeItems(rule: AnyRule, items: Item[], ctx: ScopeContext): Item[] {
  const rules = Object.entries(rule.compute ?? {});
  if (rules.length === 0) return items;
  return items.map((item) => {
    const out: Item = { ...item };
    for (const [name, compute] of rules) out[name] = computeValue(compute, out, { ...ctx.parent });
    return out;
  });
}

function baseItems(
  rule: AnyRule,
  text: string,
  ctx: ScopeContext,
  siblings: ReadonlyMap<string, Item[]>
): Item[] {
  if (rule.mode === "split") return splitItems(rule, text, ctx);
  if (rule.mode === "pairs") return pairItems(rule, siblings);
  const bounds = region(text, withinOf(rule));
  if (!bounds) return [];
  const scope = text.slice(bounds.start, bounds.end);
  if (scope === "") return [];
  return rule.mode === "matchAll" ? matchAllItems(rule, scope) : columnItems(rule, scope);
}

/** Every repeat of a scope, in declaration order; each sees the ones before it. */
export function readRepeats(
  rules: Readonly<Record<string, AnyRule>>,
  text: string,
  ctx: ScopeContext
): Map<string, Item[]> {
  const done = new Map<string, Item[]>();
  for (const [name, rule] of Object.entries(rules)) {
    const zipped = zipItems(rule, baseItems(rule, text, ctx, done), done);
    const computed = computeItems(rule, zipped, ctx);
    const skip = rule.skipItemsWithout ?? [];
    const kept = computed.filter((item) => !skip.some((field) => isBlank(item[field])));
    done.set(name, kept.slice(0, MAX_REPEAT_ITEMS));
  }
  return done;
}
