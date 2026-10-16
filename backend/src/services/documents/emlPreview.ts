import PostalMime, { type Address } from "postal-mime";
import { parse as parseHtml } from "node-html-parser";

/**
 * A kept mail, shown as text (`GET /documents/:id/file?view=text`).
 *
 * An `.eml` is served as a download, never rendered in the app's origin: its
 * HTML would run there with the user's cookie. This turns it into what a
 * reader needs — who sent it, when, the subject, the body, and what was
 * attached — as plain text the browser shows and cannot execute. The HTML part
 * is reduced to its text; no image, link or script of the mail is fetched.
 *
 * A mail restored from a PST is stored WITHOUT its attachments (each is kept as
 * its own document beside it, so a ticket PDF is not held twice). Such a mail
 * names each one in an `X-TravStats-Detached` header; it is listed with the
 * attachments so the reader knows the file exists.
 */

export const DETACHED_HEADER = "x-travstats-detached";

export type PreviewLanguage = "de" | "en";

const LABELS: Record<PreviewLanguage, Record<string, string>> = {
  de: {
    from: "Von",
    to: "An",
    date: "Datum",
    subject: "Betreff",
    attachments: "Anhänge",
    detached: "separat abgelegt",
    noBody: "(Diese Nachricht hat keinen lesbaren Text.)",
  },
  en: {
    from: "From",
    to: "To",
    date: "Date",
    subject: "Subject",
    attachments: "Attachments",
    detached: "kept separately",
    noBody: "(This message has no readable text.)",
  },
};

function addressText(address: Address | undefined): string | null {
  if (!address) return null;
  if (address.group) return address.group.map((m) => addressText(m)).join(", ");
  if (address.name && address.address) return `${address.name} <${address.address}>`;
  return address.address || address.name || null;
}

/** U+00A0, which HTML mail uses for every visual gap. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** The text of an HTML body, one block per line — what a reader sees, nothing that runs. */
export function htmlToText(html: string): string {
  const root = parseHtml(html, { blockTextElements: { script: false, style: false } });
  root.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  root
    .querySelectorAll("p, div, tr, li, h1, h2, h3, h4, h5, h6, table")
    .forEach((block) => block.insertAdjacentHTML("afterend", "\n"));
  return root.textContent
    .replaceAll(NO_BREAK_SPACE, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function contentSize(content: ArrayBuffer | Uint8Array | string): number {
  if (typeof content === "string") return Buffer.byteLength(content);
  return content.byteLength;
}

export async function renderEmlAsText(bytes: Buffer, language: PreviewLanguage): Promise<string> {
  const mail = await PostalMime.parse(bytes);
  const label = LABELS[language];

  const head: string[] = [];
  const from = addressText(mail.from);
  if (from) head.push(`${label.from}: ${from}`);
  const to = (mail.to ?? []).map((a) => addressText(a)).filter(Boolean);
  if (to.length > 0) head.push(`${label.to}: ${to.join(", ")}`);
  if (mail.date) head.push(`${label.date}: ${mail.date}`);
  if (mail.subject) head.push(`${label.subject}: ${mail.subject}`);

  const body = mail.text?.trim() || (mail.html ? htmlToText(mail.html) : "") || label.noBody;

  const attached = mail.attachments
    .filter((a) => a.disposition !== "inline" || a.filename)
    .map((a) => `- ${a.filename ?? a.mimeType} (${formatBytes(contentSize(a.content))})`);
  const detached = mail.headers
    .filter((h) => h.key === DETACHED_HEADER)
    .map((h) => `- ${h.value.split(";")[0].trim()} (${label.detached})`);
  const list = [...attached, ...detached];

  return [
    head.join("\n"),
    body,
    ...(list.length > 0 ? [`${label.attachments}:\n${list.join("\n")}`] : []),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .concat("\n");
}
