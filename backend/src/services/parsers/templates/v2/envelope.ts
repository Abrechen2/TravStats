/**
 * The v2 template envelope — one shape for every domain (parser-system design
 * §5.1, plan 2026-10-09 P1).
 *
 * This schema is the ONE validator: the loader calls it before a template is
 * tested, and the template repository's CI is meant to call the same module,
 * so "valid" cannot mean two things.
 *
 * `extraction` is the generic, domain-agnostic block of extraction.ts (P2):
 * fields, repeats and required names, every regex compiled at validation.
 * Beyond it, the envelope enforces the lifecycle a template must carry to be
 * trusted at all: an identity, a version that can be ordered, a matcher, and
 * test cases that prove it both reads AND declines.
 */
import { z } from "zod";
import { extractionSchema } from "./extraction";
import { OUTPUT_SCHEMAS } from "./outputSchemas";
import { matchRegexSchema } from "./regexSpec";
import { isValidVersion } from "./version";

export const TEMPLATE_DOMAINS = [
  "flight",
  "lodging",
  "cruise",
  "rail",
  "rental",
  "package",
] as const;
export type TemplateDomain = (typeof TEMPLATE_DOMAINS)[number];

export const ISSUER_KINDS = [
  "airline",
  "hotel-chain",
  "portal",
  "rail",
  "cruise-line",
  "tour-operator",
  "other",
] as const;

const SLUG = "[A-Za-z0-9][A-Za-z0-9._-]*";
const ID_RE = new RegExp(`^(${TEMPLATE_DOMAINS.join("|")}):${SLUG}$`);

const nonEmpty = z.string().trim().min(1);

export const versionSchema = z
  .string()
  .refine(isValidVersion, "must be a version like 2.7.0 or 2026.10.01");

const issuerSchema = z.object({
  name: nonEmpty,
  kind: z.enum(ISSUER_KINDS),
  keys: z
    .object({
      senderDomains: z.array(nonEmpty).optional(),
      iata: z
        .string()
        .regex(/^[A-Z0-9]{2}$/)
        .optional(),
    })
    .catchall(z.union([z.string(), z.array(z.string())]))
    .optional(),
});

/**
 * A test case reads either plain text, or a mail split into its parts — the
 * repository's rail draft already writes `{ subject, text }`, and a matcher
 * that keys on the subject must be testable on one.
 */
const testInputSchema = z.union([
  z.string().min(1),
  z.object({
    text: z.string().min(1),
    subject: z.string().optional(),
    from: z.string().optional(),
  }),
]);
export type TemplateTestInput = z.infer<typeof testInputSchema>;

const testCaseSchema = z.object({
  name: nonEmpty,
  input: testInputSchema,
  expect: z.enum(["match", "decline"]),
  expected: z.record(z.string(), z.unknown()).optional(),
});
export type TemplateTestCase = z.infer<typeof testCaseSchema>;

export const templateEnvelopeSchema = z
  .object({
    id: z.string().regex(ID_RE, "must be <domain>:<slug>"),
    domain: z.enum(TEMPLATE_DOMAINS),
    version: versionSchema,
    issuer: issuerSchema,
    // Empty means global. Order, never filter (owner ruling 3, 2026-10-09).
    markets: z.array(z.string().regex(/^[A-Z]{2}$/, "must be ISO 3166-1 alpha-2")),
    // Every marker AND every `allOf` regex, at least one anchor or `anyOf`
    // regex, and no `noneOf` regex — markers and anchors case-insensitive
    // substrings, the regexes with their own flags (default `im`). Something
    // positive must identify the issuer: anchors and `anyOf` may not both be
    // empty. Markers may be, for an issuer one of several names identifies.
    match: z
      .object({
        markers: z.array(nonEmpty),
        anchors: z.array(nonEmpty),
        /** Regexes that must ALL find something — a sentence substrings cannot pin. */
        allOf: z.array(matchRegexSchema).optional(),
        /** Regexes of which at least one must find something, alongside the anchors. */
        anyOf: z.array(matchRegexSchema).optional(),
        /**
         * Regexes that make the template decline outright — a document of the
         * issuer this template is not for (a ticket where it reads
         * reservations). Unlike `notBookingIf` it says nothing about whether
         * the document is a booking.
         */
        noneOf: z.array(matchRegexSchema).optional(),
        /**
         * Regexes (flags `im`) that mark a document from this issuer as NOT a
         * booking — a cancellation, a schedule change, a points receipt. They
         * print the same lines as the booking they refer to, so a template that
         * reads lines would propose the cancelled trip as a new one. A hit makes
         * the template answer "not a booking" (`nonBooking`), which a consumer
         * may treat as the end of the search.
         */
        notBookingIf: z.array(matchRegexSchema).optional(),
      })
      .refine((m) => m.anchors.length + (m.anyOf?.length ?? 0) > 0, {
        message: "needs at least one anchor or anyOf regex",
      }),
    extraction: extractionSchema,
    /**
     * Options for the DOMAIN consumer — what the app makes of the values, not
     * how they are read: e.g. a lodging template's confidence figures and the
     * fields whose absence it reports. Each domain's consumer validates the
     * keys it reads (and its README in the template repository lists them);
     * the engine never looks inside.
     */
    output: z.record(z.string(), z.unknown()).optional(),
    testCases: z.array(testCaseSchema),
    minAppVersion: versionSchema.optional(),
  })
  .superRefine((t, ctx) => {
    if (!t.id.startsWith(`${t.domain}:`)) {
      ctx.addIssue({ code: "custom", path: ["id"], message: `must start with "${t.domain}:"` });
    }
    // A suite of one happy path is not a gate (CONTRIBUTING rule 2).
    if (!t.testCases.some((c) => c.expect === "match")) {
      ctx.addIssue({ code: "custom", path: ["testCases"], message: "needs a match case" });
    }
    if (!t.testCases.some((c) => c.expect === "decline")) {
      ctx.addIssue({ code: "custom", path: ["testCases"], message: "needs a decline case" });
    }
    if (t.output !== undefined) {
      const schema = OUTPUT_SCHEMAS[t.domain];
      const result = schema ? schema.safeParse(t.output) : null;
      if (!schema) {
        ctx.addIssue({ code: "custom", path: ["output"], message: `${t.domain} takes no output` });
      } else if (result && !result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({ code: "custom", path: ["output", ...issue.path], message: issue.message });
        }
      }
    }
  });

export type TemplateEnvelope = z.infer<typeof templateEnvelopeSchema>;

export type EnvelopeValidation =
  { ok: true; template: TemplateEnvelope } | { ok: false; errors: string[] };

export function validateEnvelope(raw: unknown): EnvelopeValidation {
  const result = templateEnvelopeSchema.safeParse(raw);
  if (result.success) return { ok: true, template: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

// ------------------------------------------------------------------ index

/**
 * `index.json` at the repository root. Each entry is validated on its own, so
 * one malformed line rejects one template rather than the whole catalogue.
 */
export const templateIndexSchema = z.object({
  version: z.literal(2),
  templates: z.array(z.unknown()),
});

export const templateIndexEntrySchema = z.object({
  id: z.string().regex(ID_RE, "must be <domain>:<slug>"),
  domain: z.enum(TEMPLATE_DOMAINS),
  version: versionSchema,
  // Relative to the repository root, and never able to climb out of it.
  path: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/, "must be a relative .json path")
    .refine((p) => !p.split("/").includes(".."), "must not contain .."),
});
export type TemplateIndexEntry = z.infer<typeof templateIndexEntrySchema>;
