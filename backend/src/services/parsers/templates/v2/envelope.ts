/**
 * The v2 template envelope — one shape for every domain (parser-system design
 * §5.1, plan 2026-10-09 P1).
 *
 * This schema is the ONE validator: the loader calls it before a template is
 * tested, and the template repository's CI is meant to call the same module,
 * so "valid" cannot mean two things.
 *
 * `extraction` is deliberately opaque here. It is checked to be an object and
 * nothing more; the per-domain extraction specs arrive with the engines that
 * read them (P2/P3). What IS enforced now is the lifecycle a template must
 * carry to be trusted at all: an identity, a version that can be ordered, a
 * matcher, and test cases that prove it both reads AND declines.
 */
import { z } from "zod";
import { isValidVersion } from "./version";

export const TEMPLATE_DOMAINS = ["flight", "lodging", "cruise", "rail", "package"] as const;
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
    // Same semantics as the lodging engine: every marker AND at least one
    // anchor, case-insensitive. Both must be non-empty — an empty anchor list
    // can never match, and an empty marker list matches too cheaply.
    match: z.object({
      markers: z.array(nonEmpty).min(1),
      anchors: z.array(nonEmpty).min(1),
    }),
    extraction: z.record(z.string(), z.unknown()),
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
