import vm from "vm";
/**
 * The generic v2 extraction engine (plan 2026-10-09 P2, extended in P4b):
 * reads an `extraction` block against a document's text. Domain-agnostic on
 * purpose — what a value MEANS (a flight leg, a stay) is decided by the
 * consumer, not here.
 *
 * Regexes are compiled once per extraction object and cached in a WeakMap,
 * so a template parsed from JSON pays compilation once for as long as it is
 * active. The engine assumes a VALIDATED extraction: every source compiles
 * and every group exists (extraction.ts refuses anything else).
 *
 * Template regexes are community-written, so the work is bounded: the input
 * is capped at {@link MAX_INPUT_CHARS} characters and each repeat at
 * {@link MAX_REPEAT_ITEMS} items, and the whole run at
 * {@link EXTRACT_TIMEOUT_MS}.
 */
import type { Extraction } from "./extraction";
import { compileFields, makeScope, readFields, type CompiledField } from "./fieldReader";
import { preprocessText } from "./preprocess";
import type { MailPart } from "./regexSpec";
import { MAX_REPEAT_ITEMS, readRepeats, type Item } from "./repeatReaders";

export { MAX_REPEAT_ITEMS };
export const MAX_INPUT_CHARS = 200_000;

export interface ExtractionResult {
  values: Record<string, unknown>;
  missing: string[];
  /** True when the run hit `EXTRACT_TIMEOUT_MS` and was stopped. */
  timedOut?: boolean;
}

const fieldCache = new WeakMap<Extraction, ReadonlyMap<string, CompiledField>>();

function documentFields(extraction: Extraction): ReadonlyMap<string, CompiledField> {
  let hit = fieldCache.get(extraction);
  if (!hit) {
    hit = compileFields(extraction.fields);
    fieldCache.set(extraction, hit);
  }
  return hit;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Reads every field and repeat of `extraction` from `text`, and names what `required` lacks. */
function extractUnbounded(
  extraction: Extraction,
  text: string,
  parts?: Partial<Record<MailPart, string>>
): ExtractionResult {
  const prepare = (raw: string): string =>
    preprocessText(
      raw.length > MAX_INPUT_CHARS ? raw.slice(0, MAX_INPUT_CHARS) : raw,
      extraction.preprocess
    );
  const input = prepare(text);
  const labels = extraction.labels ?? [];
  const preparedParts = parts
    ? Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, prepare(v ?? "")]))
    : undefined;
  const fields = readFields(
    documentFields(extraction),
    makeScope(input, labels, preparedParts)
  ).values;
  const repeats = readRepeats(extraction.repeats ?? {}, input, { labels, parent: fields });
  const values: Record<string, unknown> = { ...fields, ...Object.fromEntries(repeats) };

  const missing = (extraction.required ?? []).filter((name) => {
    const rule = extraction.repeats?.[name];
    if (!rule) return isEmpty(values[name]);
    const items = values[name] as Item[];
    const itemRequired = rule.required ?? [];
    const incomplete = items.some((item) => itemRequired.some((field) => isEmpty(item[field])));
    return incomplete || items.length < (rule.minimum ?? 1);
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
export function extract(
  extraction: Extraction,
  text: string,
  /** The mail's parts, for fields confined to one (`in`). */
  parts?: Partial<Record<MailPart, string>>,
  timeoutMs = EXTRACT_TIMEOUT_MS
): ExtractionResult {
  try {
    return vm.runInNewContext(
      "run()",
      { run: () => extractUnbounded(extraction, text, parts) },
      {
        timeout: Math.max(1, timeoutMs),
      }
    ) as ExtractionResult;
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw err;
    return { values: {}, missing: [...(extraction.required ?? [])], timedOut: true };
  }
}

/**
 * Runs any template-driven regex work under the same bound as `extract` (vm
 * timeout). The caller caps its input. A timed-out run returns `fallback` and
 * says so — used for the matcher's regex conditions, which are remote input
 * like every extraction rule.
 */
export function boundedRun<T>(
  work: () => T,
  fallback: T,
  timeoutMs = EXTRACT_TIMEOUT_MS
): { result: T; timedOut: boolean } {
  try {
    const result = vm.runInNewContext(
      "run()",
      { run: work },
      { timeout: Math.max(1, timeoutMs) }
    ) as T;
    return { result, timedOut: false };
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw err;
    return { result: fallback, timedOut: true };
  }
}

/**
 * Runs a template's own regex tests (not only the extraction rules — also e.g.
 * `match.notBookingIf`) in ONE run under the same bound as `extract`: these
 * are remote input and must never run unbounded, and testing them together
 * keeps a template with many patterns at one budget, not one per pattern.
 * A timed-out run decides nothing (`matched: false`) and says so.
 */
export function boundedAny(
  sources: readonly string[],
  flags: string,
  text: string,
  timeoutMs = EXTRACT_TIMEOUT_MS
): { matched: boolean; timedOut: boolean } {
  if (sources.length === 0) return { matched: false, timedOut: false };
  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  try {
    const matched = vm.runInNewContext(
      "run()",
      { run: () => sources.some((source) => new RegExp(source, flags).test(input)) },
      { timeout: Math.max(1, timeoutMs) }
    ) as boolean;
    return { matched, timedOut: false };
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw err;
    return { matched: false, timedOut: true };
  }
}
