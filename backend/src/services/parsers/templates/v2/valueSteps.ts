/**
 * The steps every v2 value goes through once its raw text is known, in one
 * order for every kind of rule: `replace` on the raw text, then the
 * `transform` chain, then `map`. Kept in one place so a field, an item field,
 * a column and a computed value cannot disagree about it.
 */
import type { z } from "zod";
import type { mapSchema, replaceSchema, transformSpec } from "./extractionRules";
import { applyTransforms, type TransformContext, type TransformValue } from "./transforms";
import { compileSpec, type RegexSpec } from "./regexSpec";
import { DEFAULT_SPEC_FLAGS } from "./extraction";

export interface ValueSteps {
  transform?: z.infer<typeof transformSpec>;
  replace?: z.infer<typeof replaceSchema>;
  map?: z.infer<typeof mapSchema>;
}

/** What a value may be once a `map` has run: a template can map to a flag or a number. */
export type StepValue = TransformValue | boolean;

const replaceCache = new Map<string, RegExp>();

function replaceRegex(pattern: string, flags: string): RegExp {
  const key = `${flags}/${pattern}`;
  let re = replaceCache.get(key);
  if (!re) {
    re = new RegExp(pattern, flags);
    if (replaceCache.size > 2000) replaceCache.clear();
    replaceCache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

function applyReplace(raw: string | null, rules: ValueSteps["replace"]): string | null {
  if (raw === null || !rules) return raw;
  return rules.reduce(
    (text, [pattern, replacement, flags]) =>
      text.replace(replaceRegex(pattern, flags ?? "g"), replacement),
    raw
  );
}

function applyMap(value: TransformValue, rules: ValueSteps["map"]): StepValue {
  if (!rules) return value;
  if (value === null) return null;
  const text = String(value);
  for (const [pattern, result] of rules) {
    if (replaceRegex(pattern, "i").test(text)) return result;
  }
  return null;
}

/** raw → replace → transforms → map. An empty string is no value. */
export function applyValueSteps(
  raw: string | null,
  steps: ValueSteps,
  ctx: TransformContext = {}
): StepValue {
  const replaced = applyReplace(raw, steps.replace);
  const transformed = applyTransforms(replaced === "" ? null : replaced, steps.transform, ctx);
  return applyMap(transformed, steps.map);
}

/** The value a `find` regex picks out of `text`: group `v`, else 1, else the match. */
export function findIn(text: string, spec: RegexSpec): string | null {
  const m = compileSpec(spec, DEFAULT_SPEC_FLAGS).exec(text);
  if (!m) return null;
  const value = m.groups && "v" in m.groups ? m.groups.v : m.length > 1 ? m[1] : m[0];
  return value === undefined || value.trim() === "" ? null : value;
}
