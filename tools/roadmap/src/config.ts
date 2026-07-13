import { parse } from "yaml";
import { z } from "zod";
import { BACKLOG, type RoadmapConfig } from "./types.js";

const sourceSchema = z.object({
  type: z.enum(["github", "discord", "audit", "owner"]),
  ref: z.number().int().positive().optional(),
  url: z.string().url().optional(),
});

const itemSchema = z
  .object({
    id: z.string().min(1),
    source: sourceSchema,
    title: z.string().min(1).optional(),
    version: z.string().min(1),
    status: z.enum(["planned", "active", "blocked", "parked", "fixed-awaiting-release", "done"]),
    branch: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((item, ctx) => {
    // The whole point of the two-layer design: a github item's title is LIVE.
    // A transcribed copy is the drift this tool exists to prevent, so refuse it.
    if (item.source.type === "github") {
      if (item.title !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `item "${item.id}": a github item must not carry a title — it is read live from issue #${item.source.ref ?? "?"}`,
        });
      }
      if (item.source.ref === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `item "${item.id}": a github source needs a "ref" (the issue number)`,
        });
      }
    } else if (item.title === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `item "${item.id}": a ${item.source.type} item has no live anchor and therefore needs a title`,
      });
    }
  });

const configSchema = z.object({
  instances: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        role: z.string().min(1),
        node: z.string().min(1),
        ct: z.number().int().positive(),
        container: z.string().min(1),
        expect: z.string().optional(),
      })
    )
    .default([]),
  discord: z
    .array(z.object({ channel: z.string().min(1), triagedUpTo: z.string().datetime() }))
    .default([]),
  versions: z
    .array(
      z.object({
        id: z.string().min(1),
        state: z.enum(["released", "rc", "awaiting-merge", "planned"]),
        branch: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .default([]),
  items: z.array(itemSchema).default([]),
});

/**
 * Parse and validate the curated layer. Throws with a readable message rather
 * than returning a partial config — a half-understood roadmap is worse than no
 * page at all, because it looks complete.
 */
export function loadConfig(yamlText: string): RoadmapConfig {
  const parsed = configSchema.safeParse(parse(yamlText));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`roadmap.local.yaml is invalid:\n${detail.join("\n")}`);
  }

  const known = new Set([...parsed.data.versions.map((v) => v.id), BACKLOG]);
  const orphan = parsed.data.items.find((item) => !known.has(item.version));
  if (orphan) {
    throw new Error(
      `roadmap.local.yaml is invalid:\n  - item "${orphan.id}": version "${orphan.version}" is not declared under versions:`
    );
  }

  return parsed.data;
}
