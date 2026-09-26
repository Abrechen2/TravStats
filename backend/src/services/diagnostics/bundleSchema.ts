import { z } from "zod";
import { DIAGNOSTIC_BUNDLE_SCHEMA } from "../../shared/logContract";

/**
 * The diagnostic bundle, as a STRICT schema: an object key that is not listed
 * here fails validation. The builder's output is parsed through it before it
 * leaves the server (`buildDiagnosticBundle`), so a field slipped into a
 * section by a later change is refused at runtime rather than published.
 * The same schema documents the endpoint in OpenAPI.
 */

const section = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), data }).strict(),
    z.object({ status: z.literal("failed"), errorCode: z.string().max(60) }).strict(),
  ]);

const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/);

export const diagnosticLogEventSchema = z
  .object({
    time: z.string(),
    level: z.string().max(10),
    category: key.nullable(),
    event: key.nullable(),
    errorCode: z.string().max(40).nullable(),
    errorName: z.string().max(60).nullable(),
    stack: z.array(z.string().regex(/^[\w.-]+:\d+$/)).max(10),
  })
  .strict();

export const diagnosticBundleSchema = z
  .object({
    schema: z.literal(DIAGNOSTIC_BUNDLE_SCHEMA),
    generatedAt: z.string(),
    app: z.object({ version: z.string(), buildVersion: z.string() }).strict(),
    runtime: z
      .object({
        node: z.string(),
        os: z.string(),
        arch: z.string(),
        uptimeSeconds: z.number().int(),
      })
      .strict(),
    domains: section(z.record(key, z.number().int())),
    settings: section(z.record(key, z.union([z.boolean(), z.number(), key, z.null()]))),
    counts: section(z.record(key, z.number().int())),
    database: section(
      z
        .object({
          appliedMigrations: z.number().int(),
          failedMigrations: z.number().int(),
          latestMigration: z
            .string()
            .regex(/^[0-9a-z_]{1,120}$/)
            .nullable(),
        })
        .strict()
    ),
    logs: section(
      z
        .object({
          files: z.array(
            z
              .object({
                stream: key,
                rotated: z.boolean(),
                sizeBytes: z.number().int(),
                modifiedAt: z.string(),
              })
              .strict()
          ),
          recent: z.array(diagnosticLogEventSchema),
          errors: z.array(diagnosticLogEventSchema),
          unreadableFiles: z.number().int(),
          truncated: z.boolean(),
        })
        .strict()
    ),
  })
  .strict();
