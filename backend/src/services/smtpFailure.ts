/**
 * Why an SMTP connection test failed, as a stable code (settings rebuild,
 * package 6). nodemailer's own message names the server, the address and
 * sometimes the user ("Invalid login: 535 5.7.8 …"); the page words the cause
 * itself, so nothing of the server's text travels to the browser.
 */
export const SMTP_FAILURE_CODES = [
  "SMTP_CONNECTION",
  "SMTP_TLS",
  "SMTP_AUTH",
  "SMTP_TIMEOUT",
  "SMTP_PASSWORD_MISSING",
  "SMTP_UNKNOWN",
] as const;
export type SmtpFailureCode = (typeof SMTP_FAILURE_CODES)[number];

interface NodemailerLikeError {
  code?: unknown;
  responseCode?: unknown;
  message?: unknown;
  cause?: unknown;
}

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

function signature(error: unknown): { codes: string[]; message: string; responseCode: number } {
  const e = (error ?? {}) as NodemailerLikeError;
  const cause = (e.cause ?? {}) as NodemailerLikeError;
  return {
    codes: [asText(e.code), asText(cause.code)].filter(Boolean).map((c) => c.toUpperCase()),
    message: `${asText(e.message)} ${asText(cause.message)}`.toLowerCase(),
    responseCode: typeof e.responseCode === "number" ? e.responseCode : 0,
  };
}

/** Maps a failure of `transporter.verify()` to one code; unknown causes stay `SMTP_UNKNOWN`. */
export function smtpFailureCode(error: unknown): SmtpFailureCode {
  const { codes, message, responseCode } = signature(error);
  const has = (...wanted: string[]): boolean => codes.some((c) => wanted.includes(c));
  const mentions = (...needles: string[]): boolean => needles.some((n) => message.includes(n));

  if (has("EAUTH") || [530, 534, 535].includes(responseCode)) return "SMTP_AUTH";
  // TLS comes before the socket codes: a failed handshake surfaces as ESOCKET.
  if (
    has("ETLS") ||
    codes.some((c) => c.startsWith("ERR_SSL") || c.includes("CERT")) ||
    mentions("ssl", "tls", "certificate", "wrong version number")
  ) {
    return "SMTP_TLS";
  }
  if (has("ETIMEDOUT", "ESOCKETTIMEDOUT") || mentions("timeout", "timed out")) {
    return "SMTP_TIMEOUT";
  }
  if (
    has("ECONNECTION", "ESOCKET", "EDNS", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET")
  ) {
    return "SMTP_CONNECTION";
  }
  return "SMTP_UNKNOWN";
}
