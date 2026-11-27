/**
 * A refused body, read field by field.
 *
 * The server answers a body that fails its zod schema with
 * `{ code: "VALIDATION_FAILED", details: [{ field, message }] }` (backend
 * `middleware/errorHandler.ts`). Before this, every form read only the code and
 * showed one generic banner — "some details are not valid" — above a form of
 * thirty fields, and the user was left to find the one. The rc.47 error rule is:
 * a field error shows at its field. This is the half that works out WHICH field.
 *
 * `message` is zod's English prose and is never shown (a server's English string
 * in the German UI is its own defect class). It only decides between two
 * sentences the UI owns: the field is missing, or its value is not valid.
 */
import { apiErrorMachineCode } from "./apiError";

export type ValidationKind = "required" | "invalid";

export interface ValidationIssue {
  /** The zod path as the server sent it: `departureAirport`, `stops.2.name`. */
  field: string;
  kind: ValidationKind;
}

/** zod 4 words a missing value "received undefined"; zod 3 and the custom schemas say "Required". */
const MISSING = /received undefined|^required$|is required|too_small.*(>=|at least) ?1\b/i;

function kindOf(message: unknown): ValidationKind {
  return typeof message === "string" && MISSING.test(message) ? "required" : "invalid";
}

/** The per-field issues of a refused body; empty when it is anything else. */
export function validationIssues(err: unknown): ValidationIssue[] {
  if (apiErrorMachineCode(err) !== "VALIDATION_FAILED") return [];
  const details = (err as { response?: { data?: { details?: unknown } } })?.response?.data?.details;
  if (!Array.isArray(details)) return [];
  const out: ValidationIssue[] = [];
  for (const d of details) {
    const field = (d as { field?: unknown })?.field;
    if (typeof field !== "string" || field === "") continue;
    out.push({ field, kind: kindOf((d as { message?: unknown }).message) });
  }
  return out;
}

const SELECTOR_CONTROL = "input, select, textarea, button, [role='combobox'], [contenteditable]";

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function escape(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

/**
 * The control a server field belongs to, inside `root` — or null.
 *
 * By convention, so a form needs no map: `data-field`, `name`, an `id` equal to
 * the field, or an `id` that ends in `-<field>` (the forms' own
 * `bus-form-price` style), in camelCase or kebab-case. Only the first path
 * segment is tried when the full path finds nothing (`stops.2.name` falls back
 * to `stops`). Null means "no field of mine" and the caller falls back to the
 * banner — an error is never dropped for want of a match.
 */
export function findFieldControl(root: ParentNode, field: string): HTMLElement | null {
  const candidates = [field, field.split(".")[0]];
  for (const name of new Set(candidates)) {
    const ids = new Set([name, kebab(name)]);
    const selectors = [...ids].flatMap((n) => [
      `[data-field="${escape(n)}"]`,
      `[name="${escape(n)}"]`,
      `[id="${escape(n)}"]`,
      `[id$="-${escape(n)}"]`,
    ]);
    for (const sel of selectors) {
      for (const el of root.querySelectorAll<HTMLElement>(sel)) {
        if (el.matches(SELECTOR_CONTROL)) return el;
        const inner = el.querySelector<HTMLElement>(SELECTOR_CONTROL);
        if (inner) return inner;
      }
    }
  }
  return null;
}

export interface RoutedFieldError {
  /** The control's id (assigned when it had none) — the key `FieldErrorsHost` renders under. */
  controlId: string;
  kind: ValidationKind;
}

let anonymousControls = 0;

/**
 * Work out, for a refused body, which controls own which issue.
 * `unmatched` counts the issues that found no control, so the caller can keep
 * the banner for them.
 */
export function routeValidation(
  root: ParentNode | null,
  err: unknown
): { routed: RoutedFieldError[]; unmatched: number } {
  const issues = validationIssues(err);
  if (!root || issues.length === 0) return { routed: [], unmatched: issues.length };
  const routed = new Map<string, RoutedFieldError>();
  let unmatched = 0;
  for (const issue of issues) {
    const control = findFieldControl(root, issue.field);
    if (!control) {
      unmatched += 1;
      continue;
    }
    if (!control.id) control.id = `vf-${(anonymousControls += 1)}`;
    // The first message for a control wins, like the first problem wins focus.
    if (!routed.has(control.id))
      routed.set(control.id, { controlId: control.id, kind: issue.kind });
  }
  return { routed: [...routed.values()], unmatched };
}
