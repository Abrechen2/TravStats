/**
 * Why a mailbox run or a single mail failed, as a stable code the client words
 * in its own language (spec 2026-10-17-mail-intake-design.md §4). A poller that
 * fails is a red status with the last error and its time, never a log line.
 */

/** A whole run could not talk to the mailbox. */
export const SOURCE_ERROR_KINDS = [
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
export type SourceErrorKind = (typeof SOURCE_ERROR_KINDS)[number];

/** One mail was not turned into a proposal. */
export const MESSAGE_REASONS = [
  "mail_too_large",
  "unknown_token",
  "sender_not_allowed",
  "dmarc_failed",
  "dmarc_unverified",
  "unreadable_mail",
  "nothing_found",
  "parser_timeout",
  "llm_not_allowed",
  "parse_failed",
  "document_not_kept",
  "service_off",
] as const;
export type MessageReason = (typeof MESSAGE_REASONS)[number];

export class MailIntakeError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message?: string
  ) {
    super(message ?? kind);
    this.name = "MailIntakeError";
  }
}

interface ImapLikeError {
  code?: unknown;
  authenticationFailed?: unknown;
  serverResponseCode?: unknown;
  mailboxMissing?: unknown;
  responseText?: unknown;
  message?: unknown;
}

const TLS_CODES = /(CERT|SSL|TLS|EPROTO|DEPTH_ZERO|SELF_SIGNED|WRONG_VERSION)/i;

/**
 * imapflow throws plain Errors decorated with `code`, `authenticationFailed`,
 * `serverResponseCode` — map them to one of our kinds. Anything unrecognised is
 * `protocol_error`, which the UI words generically; the raw text stays in the log.
 */
export function classifyImapError(error: unknown): SourceErrorKind {
  if (error instanceof MailIntakeError) return error.kind;
  const e = (error ?? {}) as ImapLikeError;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  const response = typeof e.responseText === "string" ? e.responseText : "";

  if (e.authenticationFailed === true || /AUTHENTICATIONFAILED/i.test(String(e.serverResponseCode)))
    return "auth_failed";
  if (
    e.mailboxMissing === true ||
    /^(NONEXISTENT|TRYCREATE)$/i.test(String(e.serverResponseCode)) ||
    /nonexistent|doesn'?t exist|does not exist|unknown mailbox|no such mailbox/i.test(
      `${response} ${message}`
    )
  )
    return "folder_missing";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host_not_found";
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "TIMEOUT" ||
    /timed? ?out|timeout/i.test(message)
  )
    return "timeout";
  if (TLS_CODES.test(code) || TLS_CODES.test(message)) return "tls_error";
  if (/command failed/i.test(message) && /login|auth|credentials/i.test(`${response} ${message}`))
    return "auth_failed";
  return "protocol_error";
}

/**
 * A personal folder's host is typed by an account on a multi-user instance, so
 * a failure must not tell it which port of which machine answered: every way of
 * not reaching an IMAP server collapses to `unreachable`. What stays distinct
 * (`auth_failed`, `folder_missing`) needs a real IMAP server to have answered,
 * and `blocked_host` is decided from the address alone, before any connection.
 */
export function collapseForPersonal(kind: SourceErrorKind): SourceErrorKind {
  switch (kind) {
    case "connection_refused":
    case "host_not_found":
    case "timeout":
    case "tls_error":
    case "protocol_error":
      return "unreachable";
    default:
      return kind;
  }
}
