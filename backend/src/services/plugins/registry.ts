/**
 * An account's suggestion plugins (spec 2026-11-23-plugins-and-calendar.md,
 * "Registration"): at most five, each a connection like Immich's. The secret is
 * made here (32 bytes), shown once on create and on rotate, stored encrypted and
 * never sent back. The URL follows forgejo#411: an ordinary account's must be a
 * public https address, an admin's own may name a container on the LAN.
 */
import { prisma } from "../../db";
import type { SuggestionPlugin } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { z } from "../../schemas/zod";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import {
  PrivateTargetError,
  accountMayReachPrivate,
  assertTargetAllowed,
  type TargetPolicy,
} from "../egress/privateTargets";
import { newSecret } from "./signing";
import type { PluginTarget } from "./client";

export const MAX_PLUGINS = 5;
export const PLUGIN_SERVICE_ID = "suggestionPlugins";
export const PRECISIONS = ["exact", "100m", "1km"] as const;
export type Precision = (typeof PRECISIONS)[number];

export const pluginCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    url: z.string().trim().min(1).max(2000),
    precision: z.enum(PRECISIONS).default("100m"),
    enabled: z.boolean().default(true),
    backfillAllowed: z.boolean().default(false),
  })
  .strict();
export const pluginUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    url: z.string().trim().min(1).max(2000).optional(),
    precision: z.enum(PRECISIONS).optional(),
    enabled: z.boolean().optional(),
    backfillAllowed: z.boolean().optional(),
  })
  .strict();

export const pluginViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  precision: z.enum(PRECISIONS),
  enabled: z.boolean(),
  backfillAllowed: z.boolean(),
  secretSet: z.boolean(),
  lastVersion: z.number().int().nullable(),
  lastOutcome: z.string().nullable(),
  lastCalledAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  retryAt: z.string().nullable(),
});
export type PluginView = z.infer<typeof pluginViewSchema>;

export function pluginView(p: SuggestionPlugin): PluginView {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    precision: (PRECISIONS as readonly string[]).includes(p.precision)
      ? (p.precision as Precision)
      : "100m",
    enabled: p.enabled,
    backfillAllowed: p.backfillAllowed,
    secretSet: Boolean(p.secretEncrypted),
    lastVersion: p.lastVersion,
    lastOutcome: p.lastOutcome,
    lastCalledAt: p.lastCalledAt?.toISOString() ?? null,
    lastErrorAt: p.lastErrorAt?.toISOString() ?? null,
    retryAt: p.retryAt?.toISOString() ?? null,
  };
}

export async function pluginPolicy(userId: string): Promise<TargetPolicy> {
  return { allowPrivate: await accountMayReachPrivate(userId) };
}

/** A plugin URL as stored: https (http only for an admin's LAN target), no credentials. */
export function normalisePluginUrl(raw: string, policy: TargetPolicy): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError("invalidUrl", 400);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new AppError("invalidUrl", 400);
  try {
    assertTargetAllowed(url.toString(), policy);
  } catch (error) {
    if (error instanceof PrivateTargetError)
      throw new AppError("invalidUrl", 400, "PRIVATE_TARGET");
    throw error;
  }
  if (url.protocol === "http:" && !policy.allowPrivate)
    throw new AppError("invalidUrl", 400, "CALENDAR_HTTPS_REQUIRED");
  return url.toString();
}

export async function listPlugins(userId: string): Promise<SuggestionPlugin[]> {
  return prisma.suggestionPlugin.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function ownPlugin(userId: string, id: string): Promise<SuggestionPlugin> {
  const p = await prisma.suggestionPlugin.findFirst({ where: { id, userId } });
  if (!p) throw new AppError("Plugin not found", 404);
  return p;
}

export async function createPlugin(
  userId: string,
  input: z.infer<typeof pluginCreateSchema>
): Promise<{ plugin: SuggestionPlugin; secret: string }> {
  if ((await prisma.suggestionPlugin.count({ where: { userId } })) >= MAX_PLUGINS)
    throw new AppError("Too many plugins", 409, "PLUGIN_LIMIT");
  const url = normalisePluginUrl(input.url, await pluginPolicy(userId));
  const secret = newSecret();
  const plugin = await prisma.suggestionPlugin.create({
    data: {
      userId,
      name: input.name,
      url,
      precision: input.precision,
      enabled: input.enabled,
      backfillAllowed: input.backfillAllowed,
      secretEncrypted: encryptApiKey(secret)!,
    },
  });
  return { plugin, secret };
}

export async function updatePlugin(
  userId: string,
  id: string,
  input: z.infer<typeof pluginUpdateSchema>
): Promise<SuggestionPlugin> {
  const p = await ownPlugin(userId, id);
  const data: Record<string, unknown> = { ...input };
  if (input.url !== undefined) {
    data.url = normalisePluginUrl(input.url, await pluginPolicy(userId));
    // A new address is a new plugin as far as its record goes.
    Object.assign(data, { lastVersion: null, lastOutcome: null, retryAt: null, failures: 0 });
  }
  return prisma.suggestionPlugin.update({ where: { id: p.id }, data });
}

export async function rotateSecret(userId: string, id: string): Promise<string> {
  const p = await ownPlugin(userId, id);
  const secret = newSecret();
  await prisma.suggestionPlugin.update({
    where: { id: p.id },
    data: { secretEncrypted: encryptApiKey(secret)! },
  });
  return secret;
}

export async function deletePlugin(userId: string, id: string): Promise<void> {
  const p = await ownPlugin(userId, id);
  // Its suggestions on open findings go with it; answered findings keep what the user chose.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM dawarich_stays
       WHERE user_id = ${userId} AND status = 'pending'
         AND evidence->>'createdFrom' = ${`plugin:${p.id}`}`;
    await tx.$executeRaw`
      UPDATE dawarich_stays
         SET evidence = jsonb_set(evidence, '{plugins}', COALESCE((
               SELECT jsonb_agg(e) FROM jsonb_array_elements(evidence->'plugins') e
                WHERE e->>'pluginId' <> ${p.id}), '[]'::jsonb))
       WHERE user_id = ${userId} AND status = 'pending'
         AND jsonb_typeof(evidence->'plugins') = 'array'`;
    await tx.suggestionPlugin.delete({ where: { id: p.id } });
  });
}

/** The address and key a call needs, the reach decided now (a demoted admin loses the LAN). */
export async function targetOf(p: SuggestionPlugin): Promise<PluginTarget> {
  const policy = await pluginPolicy(p.userId);
  return { url: p.url, secret: decryptApiKey(p.secretEncrypted) ?? "", policy };
}
