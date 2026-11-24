import { api } from "./client";

/**
 * Mail intake (forgejo#313): booking mails read from a mailbox and proposed in
 * the inbox. Mirrors `backend/src/schemas/mailIntake.ts`; the router answers
 * bare (ADR 0001). A password is never part of a response.
 */

export const MAIL_SOURCE_ERRORS = [
  "connection_refused",
  "host_not_found",
  "timeout",
  "tls_error",
  "auth_failed",
  "folder_missing",
  "credentials_missing",
  "plain_not_allowed",
  "blocked_host",
  "unreachable",
  "protocol_error",
] as const;
export type MailSourceError = (typeof MAIL_SOURCE_ERRORS)[number];

export const MAIL_REASONS = [
  "mail_too_large",
  "unknown_token",
  "sender_not_allowed",
  "dmarc_failed",
  "dmarc_unverified",
  "from_invalid",
  "unreadable_mail",
  "nothing_found",
  "parser_timeout",
  "llm_not_allowed",
  "parse_failed",
  "document_not_kept",
  "service_off",
] as const;
export type MailReason = (typeof MAIL_REASONS)[number];

export type MailTlsMode = "tls" | "starttls" | "none";

export const MAIL_FETCH_FROM = ["now", "days_30", "days_90", "days_365"] as const;
export type MailFetchFrom = (typeof MAIL_FETCH_FROM)[number];

/** The per-source pre-filter settings of a personal folder (a private INBOX). */
export interface MailPrefilterSettings {
  prefilter: boolean;
  keepUnread: boolean;
  fetchFrom: MailFetchFrom;
  senderDomains: string[];
  removedSenderDomains: string[];
  subjectKeywords: string[];
  removedSubjectKeywords: string[];
}

export interface MailPrefilterDefaults {
  senderDomains: Array<{ domain: string; brand: string; kind: string | null }>;
  keywords: { de: string[]; en: string[] };
}

export interface MailSourceView {
  host: string;
  port: number;
  tlsMode: MailTlsMode;
  username: string;
  address: string | null;
  authservId: string | null;
  folder: string;
  enabled: boolean;
  hasPassword: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: MailSourceError | null;
  lastErrorAt: string | null;
  prefilter: boolean;
  keepUnread: boolean;
  fetchFrom: MailFetchFrom;
  senderDomains: string[];
  removedSenderDomains: string[];
  subjectKeywords: string[];
  removedSubjectKeywords: string[];
  skippedCount: number;
  processedCount: number;
}

export interface MailIntakeStatus {
  off: "admin" | "account" | "forbidden" | null;
  source: MailSourceView | null;
  address: string | null;
  forwardingAvailable: boolean;
  senders: Array<{ id: string; address: string }>;
  prefilterDefaults: MailPrefilterDefaults;
}

export interface MailSourceInput extends Partial<MailPrefilterSettings> {
  host: string;
  port: number;
  tlsMode: MailTlsMode;
  username: string;
  password?: string;
  folder: string;
  enabled?: boolean;
}

export interface MailInstanceInput extends MailSourceInput {
  address: string;
  authservId?: string | null;
}

export interface MailInboxItem {
  id: string;
  status: "proposed" | "rejected" | "failed" | "nothing";
  reason: MailReason | null;
  from: string | null;
  subject: string | null;
  receivedAt: string | null;
  domain: string | null;
  found: number | null;
  documentId: string | null;
  deletesAt: string | null;
}

export interface MailInbox {
  items: MailInboxItem[];
  sourceProblem: { error: MailSourceError; at: string | null } | null;
}

export interface MailRunResult {
  ran: boolean;
  skipped: "disabled" | "service_off" | "running" | "missing" | null;
  error: MailSourceError | null;
  seen: number;
  proposed: number;
  filtered: number;
}

export type MailScanStatus = "running" | "done" | "cancelled" | "interrupted" | "failed";

export interface MailScanView {
  status: MailScanStatus;
  since: string | null;
  before: string | null;
  total: number;
  scanned: number;
  skipped: number;
  matched: number;
  candidates: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface MailCandidate {
  id: string;
  receivedAt: string | null;
  from: string | null;
  subject: string | null;
  brand: string | null;
  guessedDomain: string | null;
  matchHint: "likely_present" | null;
  status: "open" | "failed";
  reason: string | null;
}

export interface MailCandidateList {
  scan: MailScanView | null;
  items: MailCandidate[];
  ignoredCount: number;
}

export interface MailImportResult {
  imported: number;
  proposed: number;
  failed: number;
}

const base = "/mail-intake";

/** The `code` a refused request carries (`MAIL_HOST_BLOCKED`, …), or null. */
export function mailIntakeErrorCode(err: unknown): string | null {
  const code = (err as { response?: { data?: { code?: unknown } } } | undefined)?.response?.data
    ?.code;
  return typeof code === "string" ? code : null;
}

export const mailIntakeApi = {
  status: async (): Promise<MailIntakeStatus> => (await api.get<MailIntakeStatus>(base)).data,
  saveSource: async (input: MailSourceInput): Promise<MailSourceView> =>
    (await api.put<MailSourceView>(`${base}/source`, input)).data,
  removeSource: async (): Promise<void> => {
    await api.delete(`${base}/source`);
  },
  testSource: async (): Promise<{ ok: boolean; error: MailSourceError | null }> =>
    (await api.post(`${base}/source/test`)).data,
  runNow: async (): Promise<MailRunResult> =>
    (await api.post<MailRunResult>(`${base}/source/run`)).data,
  issueAddress: async (): Promise<string | null> =>
    (await api.post<{ address: string | null }>(`${base}/address`)).data.address,
  revokeAddress: async (): Promise<void> => {
    await api.delete(`${base}/address`);
  },
  addSender: async (address: string): Promise<MailIntakeStatus> =>
    (await api.post<MailIntakeStatus>(`${base}/senders`, { address })).data,
  removeSender: async (id: string): Promise<MailIntakeStatus> =>
    (await api.delete<MailIntakeStatus>(`${base}/senders/${id}`)).data,
  inbox: async (): Promise<MailInbox> => (await api.get<MailInbox>(`${base}/inbox`)).data,
  dismiss: async (id: string): Promise<void> => {
    await api.post(`${base}/messages/${id}/dismiss`);
  },
  retry: async (id: string): Promise<void> => {
    await api.post(`${base}/messages/${id}/retry`);
  },
  /** Files the proposal's original mail with the entry created from it since `openedAt`. */
  fileOriginal: async (
    id: string,
    openedAt: string
  ): Promise<{ entry: { type: string; id: string } | null }> =>
    (await api.post(`${base}/messages/${id}/file-original`, { openedAt })).data,
  allowSender: async (id: string): Promise<void> => {
    await api.post(`${base}/messages/${id}/allow-sender`);
  },
  /** Starts (or resumes) "Postfach durchsuchen"; poll the job id with `waitForJob`. */
  startScan: async (input: {
    since?: string;
    before?: string;
    resume?: boolean;
  }): Promise<string> => (await api.post<{ jobId: string }>(`${base}/scan`, input)).data.jobId,
  cancelScan: async (): Promise<void> => {
    await api.post(`${base}/scan/cancel`);
  },
  candidates: async (): Promise<MailCandidateList> =>
    (await api.get<MailCandidateList>(`${base}/candidates`)).data,
  importCandidates: async (ids: string[]): Promise<string> =>
    (await api.post<{ jobId: string }>(`${base}/candidates/import`, { ids })).data.jobId,
  ignoreCandidates: async (ids: string[]): Promise<number> =>
    (await api.post<{ ignored: number }>(`${base}/candidates/ignore`, { ids })).data.ignored,
  instance: async (): Promise<{ source: MailSourceView | null }> =>
    (await api.get(`${base}/instance`)).data,
  saveInstance: async (input: MailInstanceInput): Promise<{ source: MailSourceView }> =>
    (await api.put(`${base}/instance`, input)).data,
  removeInstance: async (): Promise<void> => {
    await api.delete(`${base}/instance`);
  },
  testInstance: async (): Promise<{ ok: boolean; error: MailSourceError | null }> =>
    (await api.post(`${base}/instance/test`)).data,
};
