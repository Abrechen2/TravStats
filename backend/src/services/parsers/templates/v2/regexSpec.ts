/**
 * A regex a template names outside a field's `patterns` list — a matcher
 * condition, a `find`, a `lastBefore` — either as a bare source string (the
 * owner's default flags apply) or as `{ pattern, flags }` when the default is
 * wrong for it: a case-sensitive train category ("ICE" is a train, "ice" is a
 * word) cannot be written under the `i` flag every matcher regex defaults to.
 *
 * Matcher conditions may also say which PART of a mail they look at (`in`):
 * the sender, the subject or the body. Without it they look at all three, in
 * the order the runners join them.
 */
import { z } from "zod";

export const FLAGS = z
  .string()
  .regex(/^[gimsu]*$/, "flags must be drawn from gimsu")
  .refine((f) => new Set(f).size === f.length, "flags must not repeat");

export const MAIL_PARTS = ["from", "subject", "text"] as const;
export type MailPart = (typeof MAIL_PARTS)[number];

/** True when `source` compiles with `flags` and does not match the empty string. */
export function isUsableRegex(source: string, flags = "im"): boolean {
  try {
    return !new RegExp(source, flags.replace("g", "")).test("");
  } catch {
    return false;
  }
}

const REGEX_MESSAGE = "must be a valid regex that does not match the empty string";

export type RegexSpec = string | { pattern: string; flags?: string };
export type MatchRegex = string | { pattern: string; flags?: string; in?: MailPart };

export const regexSpecSchema = z.union([
  z.string().min(1),
  z.object({ pattern: z.string().min(1), flags: FLAGS.optional() }).strict(),
]);

/** A matcher condition: a regex that must find something, optionally in one part of the mail. */
export const matchRegexSchema: z.ZodType<MatchRegex> = z
  .union([
    z.string().min(1),
    z
      .object({
        pattern: z.string().min(1),
        flags: FLAGS.optional(),
        in: z.enum(MAIL_PARTS).optional(),
      })
      .strict(),
  ])
  .refine((spec) => isUsableRegex(specSource(spec), specFlags(spec, "im")), REGEX_MESSAGE);

export function specSource(spec: RegexSpec | MatchRegex): string {
  return typeof spec === "string" ? spec : spec.pattern;
}

export function specFlags(spec: RegexSpec | MatchRegex, fallback: string): string {
  return typeof spec === "string" ? fallback : (spec.flags ?? fallback);
}

export function specPart(spec: MatchRegex): MailPart | undefined {
  return typeof spec === "string" ? undefined : spec.in;
}

const compiledSpecs = new WeakMap<object, RegExp>();
const compiledStrings = new Map<string, RegExp>();
const MAX_STRING_CACHE = 2000;

/** Compiles a spec once (non-global); assumes it was validated. */
export function compileSpec(spec: RegexSpec | MatchRegex, fallbackFlags: string): RegExp {
  const flags = specFlags(spec, fallbackFlags).replace("g", "");
  if (typeof spec !== "string") {
    const hit = compiledSpecs.get(spec);
    if (hit) return hit;
    const re = new RegExp(spec.pattern, flags);
    compiledSpecs.set(spec, re);
    return re;
  }
  const key = `${flags}/${spec}`;
  const hit = compiledStrings.get(key);
  if (hit) return hit;
  const re = new RegExp(spec, flags);
  if (compiledStrings.size >= MAX_STRING_CACHE) compiledStrings.clear();
  compiledStrings.set(key, re);
  return re;
}
