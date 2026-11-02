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

const ADDR_SPEC = /^[^\s@<>()[\]",;:\\]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/**
 * The addr-spec of a From header value, or null unless there is EXACTLY one
 * mailbox. Quoted strings (display names) and comments are skipped, not
 * scanned: `"a@b.example" <c@d.example>` is c@d.example, and a list or a group
 * is refused rather than reduced to its first entry. Works on the RAW value —
 * a decoded encoded-word could otherwise smuggle `<` and `@` into the name.
 */
export function singleAddress(value: string): string | null {
  let name = "";
  let angle = "";
  // 0 = no angle-addr yet, 1 = inside <…>, 2 = closed. Only one is ever allowed.
  let state: 0 | 1 | 2 = 0;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quoted) {
      if (ch === "\\") i += 1;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (depth > 0) {
      if (ch === "\\") i += 1;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      continue;
    }
    if (ch === '"') {
      if (state === 2) return null;
      quoted = true;
    } else if (ch === "(") depth += 1;
    else if (ch === "<") {
      // A second "<", also inside the first, makes the address ambiguous.
      if (state !== 0) return null;
      state = 1;
    } else if (ch === ">") {
      if (state !== 1) return null;
      state = 2;
    } else if (ch === "," || ch === ";" || (ch === ":" && state === 0)) {
      // A list, or a group ("name: a, b;") — more than one mailbox, or none we can trust.
      return null;
    } else if (state === 1) angle += ch;
    else if (state === 2) {
      // Anything but whitespace after the closing ">" is a second thing in the header.
      if (!/\s/.test(ch)) return null;
    } else name += ch;
  }
  if (quoted || depth > 0 || state === 1) return null;
  const candidate = (state === 2 ? angle : name).trim();
  return ADDR_SPEC.test(candidate) ? candidate.toLowerCase() : null;
}

/** The From address of a raw mail: one From header, one mailbox, else null. */
export function fromAddressOf(raw: Buffer): string | null {
  const values = headerLines(raw)
    .map((line) => /^from:\s*(.*)$/i.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]);
  return values.length === 1 ? singleAddress(values[0]) : null;
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
  // A pass that does not say WHICH domain it is for authorises nothing.
  const aligned = /header\.from=([^\s;]+)/i.exec(clause[2]);
  if (!aligned) return "none";
  const domain = fromAddress?.split("@")[1]?.toLowerCase();
  return domain && aligned[1].toLowerCase() === domain ? "pass" : "none";
}

export function readHeaders(raw: Buffer, authservId: string | null = null): MailHeaders {
  const message = parseMimeMessage(raw);
  const get = (name: string): string | undefined => headerText(message, name);
  const from = fromAddressOf(raw);
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
