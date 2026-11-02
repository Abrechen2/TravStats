/**
 * What the pipeline reads from a fetched mail's header block, and the
 * authorisation decision built on it (spec §5).
 */
import { headerText, parseMimeMessage, type MimeMessage } from "../email/mimeMessage";

export interface MailHeaders {
  message: MimeMessage;
  messageId: string | null;
  subject: string | null;
  from: string | null;
  /** Header values a plus-address can appear in. */
  recipientValues: string[];
  sentAt: Date | null;
  authResults: string | null;
  dmarc: "pass" | "fail" | "none";
}

const ADDRESS = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function firstAddress(value: string | undefined): string | null {
  const match = value ? ADDRESS.exec(value) : null;
  return match ? match[0].toLowerCase() : null;
}

/** The header block of a raw mail, unfolded, as lines. */
function headerLines(raw: Buffer): string[] {
  const text = raw.toString("latin1");
  const end = text.search(/\r?\n\r?\n/);
  const block = end === -1 ? text : text.slice(0, end);
  return block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
}

/**
 * The Authentication-Results value to believe. The receiving provider PREPENDS
 * its own, so the topmost is the provider's and any further down was written by
 * someone upstream — a header the sender wrote is not evidence. With a
 * configured authserv-id only a header carrying exactly that id counts, so a
 * forged one cannot win even by being first.
 */
export function authResultsOf(raw: Buffer, authservId: string | null): string | null {
  for (const line of headerLines(raw)) {
    const match = /^authentication-results:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[1];
    const id = value.split(";")[0].trim().split(/\s+/)[0].toLowerCase();
    if (!authservId || id === authservId.trim().toLowerCase()) return value;
  }
  return null;
}

/**
 * DMARC's verdict FOR THE FROM ADDRESS. `pass` only when the clause says pass
 * and, where it names `header.from`, that domain is the From address's own —
 * a pass for some other domain authorises nothing.
 */
export function dmarcOf(
  authResults: string | null,
  fromAddress: string | null
): "pass" | "fail" | "none" {
  const clause = authResults ? /\bdmarc=(\w+)([^;]*)/i.exec(authResults) : null;
  if (!clause) return "none";
  const verdict = clause[1].toLowerCase();
  if (verdict === "fail") return "fail";
  if (verdict !== "pass") return "none";
  const aligned = /header\.from=([^\s;]+)/i.exec(clause[2]);
  if (!aligned) return "pass";
  const domain = fromAddress?.split("@")[1]?.toLowerCase();
  return domain && aligned[1].toLowerCase() === domain ? "pass" : "none";
}

export function readHeaders(raw: Buffer, authservId: string | null = null): MailHeaders {
  const message = parseMimeMessage(raw);
  const get = (name: string): string | undefined => headerText(message, name);
  const from = firstAddress(get("from"));
  const date = get("date") ? new Date(get("date")!) : null;
  const authResults = authResultsOf(raw, authservId);
  const rawId = get("message-id")?.trim();
  return {
    message,
    messageId: rawId ? rawId.slice(0, 300) : null,
    subject: get("subject")?.trim().slice(0, 300) || null,
    from,
    recipientValues: [
      get("delivered-to"),
      get("x-original-to"),
      get("envelope-to"),
      get("x-envelope-to"),
      get("to"),
      get("cc"),
    ].filter((v): v is string => !!v),
    sentAt: date && !Number.isNaN(date.getTime()) ? date : null,
    authResults,
    dmarc: dmarcOf(authResults, from),
  };
}
