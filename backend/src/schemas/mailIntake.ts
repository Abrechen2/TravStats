/**
 * Wire schemas of the mail-intake routes (forgejo#313). Bodies are strict — a
 * typo must not look like a save. A password is never part of a response:
 * `hasPassword` says whether one is stored.
 */
import { z } from "./zod";
import { MESSAGE_REASONS, SOURCE_ERROR_KINDS } from "../services/mailIntake/errors";
import { FETCH_FROM_OPTIONS } from "../services/mailIntake/constants";
import { isValidDomain } from "../services/mailIntake/prefilter";

const host = z.string().trim().min(1).max(253);
const port = z.number().int().min(1).max(65535);
const folder = z.string().trim().min(1).max(200);
const MAX_LIST = 300;
const domainList = z
  .array(z.string().trim().toLowerCase().refine(isValidDomain, "must be a domain like example.com"))
  .max(MAX_LIST);
const keywordList = z.array(z.string().trim().min(2).max(100)).max(MAX_LIST);

/** The pre-filter and cursor settings a personal folder takes (privacy for a private INBOX). */
const prefilterFields = {
  prefilter: z.boolean().optional(),
  keepUnread: z.boolean().optional(),
  fetchFrom: z.enum(FETCH_FROM_OPTIONS).optional(),
  senderDomains: domainList.optional(),
  removedSenderDomains: domainList.optional(),
  subjectKeywords: keywordList.optional(),
  removedSubjectKeywords: keywordList.optional(),
};

export const personalSourceBodySchema = z.strictObject({
  host,
  port,
  tlsMode: z.enum(["tls", "starttls"]),
  username: z.string().trim().min(1).max(320),
  /** Absent keeps the stored one; required when the source is created. */
  password: z.string().min(1).max(500).optional(),
  folder,
  enabled: z.boolean().optional(),
  ...prefilterFields,
});

export const instanceSourceBodySchema = z.strictObject({
  host,
  port,
  /** `none` (plain IMAP) is for an admin's own LAN mail server. */
  tlsMode: z.enum(["tls", "starttls", "none"]),
  username: z.string().trim().min(1).max(320),
  address: z.string().trim().email().max(320),
  /** The receiving provider's authserv-id; set, only its Authentication-Results is believed. */
  authservId: z.string().trim().max(253).nullable().optional(),
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
  authservId: z.string().nullable(),
  folder: z.string(),
  enabled: z.boolean(),
  hasPassword: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastOkAt: z.string().nullable(),
  lastError: z.enum(SOURCE_ERROR_KINDS).nullable(),
  lastErrorAt: z.string().nullable(),
  prefilter: z.boolean(),
  keepUnread: z.boolean(),
  fetchFrom: z.enum(FETCH_FROM_OPTIONS),
  senderDomains: z.array(z.string()),
  removedSenderDomains: z.array(z.string()),
  subjectKeywords: z.array(z.string()),
  removedSubjectKeywords: z.array(z.string()),
  /** Mails the header pre-filter left untouched, and mails read — counts only. */
  skippedCount: z.number(),
  processedCount: z.number(),
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
  /** The built-in pre-filter lists: shown read-only, each entry can be switched off per source. */
  prefilterDefaults: z.object({
    senderDomains: z.array(
      z.object({ domain: z.string(), brand: z.string(), kind: z.string().nullable() })
    ),
    keywords: z.object({ de: z.array(z.string()), en: z.array(z.string()) }),
  }),
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
  filtered: z.number(),
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

export const fileOriginalBodySchema = z.strictObject({
  /** When the user opened the proposal; entries created from then on are the ones it produced. */
  openedAt: z.string().datetime(),
});

export const fileOriginalResultSchema = z.object({
  entry: z.object({ type: z.string(), id: z.string() }).nullable(),
});

// ---- "Postfach durchsuchen": the one-off header scan and its candidate list ----------------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const scanBodySchema = z.strictObject({
  /** First day to look at; absent: the whole folder from its first mail. */
  since: day.optional(),
  /** Day after the last one (exclusive), as IMAP SEARCH BEFORE reads it. */
  before: day.optional(),
  /** Continue an interrupted or cancelled scan from its cursor. */
  resume: z.boolean().optional(),
});

export const candidateIdsBodySchema = z.strictObject({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const jobStartedBareSchema = z.object({ jobId: z.string().uuid() });

export const scanViewSchema = z.object({
  status: z.enum(["running", "done", "cancelled", "interrupted", "failed"]),
  since: z.string().nullable(),
  before: z.string().nullable(),
  total: z.number(),
  scanned: z.number(),
  /** Mails the pre-filter left untouched: counted, nothing else kept. */
  skipped: z.number(),
  /** Booking mails already in TravStats (reference or Message-ID). */
  matched: z.number(),
  candidates: z.number(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const candidateListSchema = z.object({
  scan: scanViewSchema.nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      receivedAt: z.string().nullable(),
      from: z.string().nullable(),
      subject: z.string().nullable(),
      brand: z.string().nullable(),
      guessedDomain: z.string().nullable(),
      /** `likely_present`: the brand has an entry near this date — maybe already recorded. */
      matchHint: z.enum(["likely_present"]).nullable(),
      status: z.enum(["open", "failed"]),
      /** Why an import failed: `mail_gone` or `mail_too_large`. */
      reason: z.string().nullable(),
    })
  ),
  ignoredCount: z.number(),
});

export const ignoredResultSchema = z.object({ ignored: z.number() });
