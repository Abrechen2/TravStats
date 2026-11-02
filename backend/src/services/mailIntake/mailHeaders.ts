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
  /** Addresses that could name the forwarding account (From, Return-Path, Sender …). */
  senderCandidates: string[];
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

/**
 * The topmost Authentication-Results: the receiving provider prepends its own,
 * so the first one is the provider's. A header the sender wrote sits further
 * down and is never evidence.
 */
export function dmarcOf(authResults: string | null): "pass" | "fail" | "none" {
  const match = authResults ? /\bdmarc=(\w+)/i.exec(authResults) : null;
  if (!match) return "none";
  const verdict = match[1].toLowerCase();
  if (verdict === "pass") return "pass";
  return verdict === "fail" ? "fail" : "none";
}

export function readHeaders(raw: Buffer): MailHeaders {
  const message = parseMimeMessage(raw);
  const get = (name: string): string | undefined => headerText(message, name);
  const from = firstAddress(get("from"));
  const candidates = [
    from,
    firstAddress(get("return-path")),
    firstAddress(get("sender")),
    firstAddress(get("x-original-sender")),
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);
  const date = get("date") ? new Date(get("date")!) : null;
  const authResults = message.headers.get("authentication-results") ?? null;
  const rawId = get("message-id")?.trim();
  return {
    message,
    messageId: rawId ? rawId.slice(0, 300) : null,
    subject: get("subject")?.trim().slice(0, 300) || null,
    from,
    senderCandidates: candidates,
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
    dmarc: dmarcOf(authResults),
  };
}
