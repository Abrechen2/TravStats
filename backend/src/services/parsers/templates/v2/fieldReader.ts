/**
 * Reading the scalar fields of one scope — the document, or one block of a
 * split repeat. extract.ts owns scopes and repeats; this file owns what a
 * single `FieldRule` means: patterns (with an optional `format`), a constant
 * `value`, or a `stacked` label, then the transforms, with the year a
 * `yearFrom` sibling read.
 */
import { fieldFlags, formatPlaceholders, type FieldRule } from "./extraction";
import { applyTransforms, type TransformContext, type TransformValue } from "./transforms";

export interface CompiledField {
  readonly rule: FieldRule;
  readonly patterns: readonly RegExp[];
}

export function compileField(rule: FieldRule): CompiledField {
  const flags = fieldFlags(rule.flags);
  return { rule, patterns: (rule.patterns ?? []).map((p) => new RegExp(p, flags)) };
}

export function compileFields(
  fields: Record<string, FieldRule> | undefined
): Map<string, CompiledField> {
  return new Map(Object.entries(fields ?? {}).map(([name, rule]) => [name, compileField(rule)]));
}

export interface FieldRead {
  readonly value: TransformValue;
  /** Whether the text contributed anything — a constant or a defaulted transform does not. */
  readonly read: boolean;
}

/** What a scope offers every field in it: its lines (for `stacked`) and the label stop list. */
export interface Scope {
  readonly text: string;
  readonly lines: readonly string[];
  readonly labels: ReadonlySet<string>;
}

const normLabel = (s: string): string => s.trim().toLowerCase().replace(/:$/, "");

export function makeScope(text: string, labels: readonly string[] | undefined): Scope {
  return {
    text,
    lines: text.split("\n").map((l) => l.replace(/\r$/, "")),
    labels: new Set((labels ?? []).map(normLabel)),
  };
}

/**
 * The value under a label that sits on a line of its own.
 *
 * Walks rather than matches, because neither regex shape is safe: a loose one
 * crosses blank lines into the NEXT label's value, a tight one cannot cross the
 * blank line some senders put between label and value. The first line with
 * content wins — unless it is another label, in which case the field is absent.
 */
function readStacked(scope: Scope, label: string): string | null {
  const wanted = normLabel(label);
  const index = scope.lines.findIndex((line) => normLabel(line) === wanted);
  if (index < 0) return null;
  const value = scope.lines.slice(index + 1).find((line) => line.trim() !== "");
  if (value === undefined || scope.labels.has(normLabel(value))) return null;
  return value.trim();
}

/** The raw value of a match: `format` assembled from the groups, else group "v", else group 1, else the match. */
function captured(m: RegExpExecArray, format: string | undefined): string | undefined {
  if (format !== undefined) {
    let out = format;
    for (const name of formatPlaceholders(format)) {
      const group = /^\d+$/.test(name) ? m[Number(name)] : m.groups?.[name];
      if (group === undefined || group.trim() === "") return undefined;
      out = out.split(`{${name}}`).join(group.trim());
    }
    return out;
  }
  if (m.groups && "v" in m.groups) return m.groups.v;
  return m.length > 1 ? m[1] : m[0];
}

/** First pattern whose capture survives the transforms wins; otherwise the transforms see null. */
function readField(field: CompiledField, scope: Scope, ctx: TransformContext): FieldRead {
  const { rule } = field;
  if (rule.value !== undefined) {
    return { value: applyTransforms(rule.value, rule.transform, ctx), read: false };
  }
  if (rule.stacked !== undefined) {
    const raw = readStacked(scope, rule.stacked);
    const value = applyTransforms(raw, rule.transform, ctx);
    return { value, read: raw !== null && value !== null };
  }
  for (const re of field.patterns) {
    const m = re.exec(scope.text);
    const raw = m ? captured(m, rule.format) : undefined;
    if (raw === undefined || raw.trim() === "") continue;
    const value = applyTransforms(raw, rule.transform, ctx);
    if (value !== null) return { value, read: true };
  }
  return { value: applyTransforms(null, rule.transform, ctx), read: false };
}

/** The year a `yearFrom` sibling read: a number, or the first four-digit run of a string. */
function yearOf(value: TransformValue | undefined): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  const m = typeof value === "string" ? /\d{4}/.exec(value) : null;
  return m ? Number(m[0]) : undefined;
}

/**
 * Every field of a scope, in the template's own order. A field with
 * `yearFrom` is read after the field it names (validation guarantees that
 * one has no `yearFrom` of its own, so one pass suffices).
 */
export function readFields(
  fields: ReadonlyMap<string, CompiledField>,
  scope: Scope
): { values: Record<string, TransformValue>; readAnything: boolean } {
  const reads = new Map<string, FieldRead>();
  for (const [name, field] of fields) {
    if (field.rule.yearFrom === undefined) reads.set(name, readField(field, scope, {}));
  }
  for (const [name, field] of fields) {
    const from = field.rule.yearFrom;
    if (from === undefined) continue;
    reads.set(name, readField(field, scope, { year: yearOf(reads.get(from)?.value) }));
  }
  const values: Record<string, TransformValue> = {};
  let readAnything = false;
  for (const name of fields.keys()) {
    const read = reads.get(name);
    values[name] = read?.value ?? null;
    readAnything ||= read?.read ?? false;
  }
  return { values, readAnything };
}
