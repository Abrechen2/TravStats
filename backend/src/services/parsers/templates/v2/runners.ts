/**
 * Test-case runners, one per domain.
 *
 * A template is activated only after its own `testCases` pass (design
 * principle 3: community templates must not activate on JSON validity
 * alone). Running a case needs an engine that understands the domain, so the
 * runners are a registry keyed by domain — and a domain with no runner has no
 * way to prove anything, which makes its templates `invalid`, never "loaded,
 * untested".
 *
 * Phase P1 ships ONE runner: the matcher. It decides match vs decline from
 * `match.markers` / `match.anchors` and ignores `expected`. The extraction
 * runners of P2/P3 replace it per domain and compare `expected` as well.
 */
import type {
  TemplateDomain,
  TemplateEnvelope,
  TemplateTestCase,
  TemplateTestInput,
} from "./envelope";
import { TEMPLATE_DOMAINS } from "./envelope";

export type TestDecision = "match" | "decline";

export type TemplateTestRunner = (
  template: TemplateEnvelope,
  input: TemplateTestInput
) => TestDecision;

export type RunnerRegistry = ReadonlyMap<TemplateDomain, TemplateTestRunner>;

/** The text a matcher sees: sender, subject and body, as the lodging engine joins them. */
export function testInputHaystack(input: TemplateTestInput): string {
  if (typeof input === "string") return input;
  return [input.from ?? "", input.subject ?? "", input.text].join("\n");
}

/** Every marker AND at least one anchor, case-insensitive — the lodging engine's rule. */
export function envelopeMatches(template: TemplateEnvelope, haystack: string): boolean {
  const text = haystack.toLowerCase();
  const has = (needle: string): boolean => text.includes(needle.toLowerCase());
  return template.match.markers.every(has) && template.match.anchors.some(has);
}

export const matchOnlyRunner: TemplateTestRunner = (template, input) =>
  envelopeMatches(template, testInputHaystack(input)) ? "match" : "decline";

/** P1 default: every domain is checked by its matcher until an extraction runner exists. */
export const defaultRunners: RunnerRegistry = new Map(
  TEMPLATE_DOMAINS.map((domain) => [domain, matchOnlyRunner] as const)
);

export type TestRunResult =
  { kind: "passed" } | { kind: "no_runner" } | { kind: "failed"; failures: string[] };

function describeFailure(testCase: TemplateTestCase, actual: TestDecision | Error): string {
  if (actual instanceof Error) return `"${testCase.name}": runner threw: ${actual.message}`;
  return `"${testCase.name}": expected ${testCase.expect}, got ${actual}`;
}

export function runTestCases(template: TemplateEnvelope, runners: RunnerRegistry): TestRunResult {
  const runner = runners.get(template.domain);
  if (!runner) return { kind: "no_runner" };
  const failures = template.testCases.flatMap((testCase) => {
    let actual: TestDecision | Error;
    try {
      actual = runner(template, testCase.input);
    } catch (err) {
      actual = err instanceof Error ? err : new Error(String(err));
    }
    return actual === testCase.expect ? [] : [describeFailure(testCase, actual)];
  });
  return failures.length === 0 ? { kind: "passed" } : { kind: "failed", failures };
}
