/**
 * Wire schemas of the mail-intake routes (forgejo#313). Bodies are strict — a
 * typo must not look like a save. A password is never part of a response:
 * `hasPassword` says whether one is stored.
 */
import { z } from "./zod";
import { MESSAGE_REASONS, SOURCE_ERROR_KINDS } from "../services/mailIntake/errors";

const host = z.string().trim().min(1).max(253);
const port = z.number().int().min(1).max(65535);
const folder = z.string().trim().min(1).max(200);

export const personalSourceBodySchema = z.strictObject({
  host,
  port,
  tlsMode: z.enum(["tls", "starttls"]),
  username: z.string().trim().min(1).max(320),
  /** Absent keeps the stored one; required when the source is created. */
  password: z.string().min(1).max(500).optional(),
  folder,
  enabled: z.boolean().optional(),
});

export const instanceSourceBodySchema = z.strictObject({
  host,
  port,
  /** `none` (plain IMAP) is for an admin's own LAN mail server. */
  tlsMode: z.enum(["tls", "starttls", "none"]),
  username: z.string().trim().min(1).max(320),
  address: z.string().trim().email().max(320),
  password: z.string().min(1).max(500).optional(),
  folder: folder.default("INBOX"),
  enabled: z.boolean().optional(),
});

export const senderBodySchema = z.strictObject({
  address: z.string().trim().toLowerCase().email().max(320),
});

export const idParamsSchema = z.strictObject({ id: z.string().uuid() });

export const sourceViewSchema = z.object({
  host: z.string(),
  port: z.number(),
  tlsMode: z.enum(["tls", "starttls", "none"]),
  username: z.string(),
  address: z.string().nullable(),
  folder: z.string(),
  enabled: z.boolean(),
  hasPassword: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastOkAt: z.string().nullable(),
  lastError: z.enum(SOURCE_ERROR_KINDS).nullable(),
  lastErrorAt: z.string().nullable(),
});

export const mailIntakeStatusSchema = z.object({
  /** Why the feature is not usable for this account, or null when it is. */
  off: z.enum(["admin", "account", "forbidden"]).nullable(),
  source: sourceViewSchema.nullable(),
  /** The personal forwarding address (mode B), or null when none is available or issued. */
  address: z.string().nullable(),
  /** Whether the admin has set up and switched on the instance mailbox. */
  forwardingAvailable: z.boolean(),
  senders: z.array(z.object({ id: z.string(), address: z.string() })),
});

export const instanceStatusSchema = z.object({ source: sourceViewSchema.nullable() });

export const testResultSchema = z.object({
  ok: z.boolean(),
  error: z.enum(SOURCE_ERROR_KINDS).nullable(),
});

export const runResultSchema = z.object({
  ran: z.boolean(),
  skipped: z.enum(["disabled", "service_off", "running", "missing"]).nullable(),
  error: z.enum(SOURCE_ERROR_KINDS).nullable(),
  seen: z.number(),
  proposed: z.number(),
});

export const inboxItemSchema = z.object({
  id: z.string(),
  status: z.enum(["proposed", "rejected", "failed", "nothing"]),
  reason: z.enum(MESSAGE_REASONS).nullable(),
  from: z.string().nullable(),
  subject: z.string().nullable(),
  receivedAt: z.string().nullable(),
  domain: z.string().nullable(),
  found: z.number().nullable(),
  documentId: z.string().nullable(),
  /** When the unfiled mail is swept if nobody files it; null when it is not unfiled. */
  deletesAt: z.string().nullable(),
});

export const inboxSchema = z.object({
  items: z.array(inboxItemSchema),
  /** A run of the user's own source failed: the same reason the settings card shows. */
  sourceProblem: z
    .object({ error: z.enum(SOURCE_ERROR_KINDS), at: z.string().nullable() })
    .nullable(),
});

export const okSchema = z.object({ ok: z.literal(true) });
export const addressResponseSchema = z.object({ address: z.string().nullable() });
