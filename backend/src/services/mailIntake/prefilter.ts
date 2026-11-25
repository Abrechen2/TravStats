/**
 * The header-only pre-filter of the mail intake. A mail is downloaded only when
 * its From domain is a known booking sender (built-in, template or added for the
 * source) or its subject carries a booking keyword. Everything else is never
 * opened, parsed, stored, logged or flagged — the run counts it, nothing more.
 *
 * The forwarding allowlist (`mail_intake_senders`) deliberately does NOT count
 * here: it names the user's own addresses, and on a private INBOX every note to
 * self would pass. It serves the forwarding-address path only.
 *
 * Built for a private INBOX of ~12,800 mails where a few hundred are bookings:
 * the decision reads From, Subject and List-Id from an ENVELOPE fetch, never a
 * body part.
 *
 * The lists are data (`bookingSenders.json`), merged at run time with the
 * sender domains of the parser templates, then the user's own additions and
 * switched-off defaults per source.
 */
import catalogue from "./bookingSenders.json";
import { templateRegistry } from "../parsers/templates/registry";
import logger from "../../utils/logger";

export type BookingKind =
  "flight" | "lodging" | "rail" | "bus" | "ferry" | "cruise" | "rental" | "package";

export interface HeaderInfo {
  uid: number;
  /** The first From address, lowercased; null when the envelope has none. */
  from: string | null;
  subject: string | null;
  date: Date | null;
  messageId: string | null;
  /** True when the mail carries a List-Id (a mailing list / newsletter). */
  hasListId: boolean;
}

export interface SenderDomain {
  domain: string;
  brand: string;
  /** null for a domain the user added: we know it books, not what. */
  kind: BookingKind | null;
}

export interface Keyword {
  word: string;
  lang: "de" | "en";
  domain?: BookingKind;
}

export interface PrefilterSettings {
  senderDomains: string[];
  removedSenderDomains: string[];
  subjectKeywords: string[];
  removedSubjectKeywords: string[];
}

export interface PrefilterRules {
  domains: Map<string, SenderDomain>;
  keywords: Array<{ norm: string; domain?: BookingKind }>;
}

export interface Verdict {
  take: boolean;
  brand: string | null;
  kind: BookingKind | null;
}

/**
 * Case-insensitive, and ä/ae, ö/oe, ü/ue, ß/ss alike; hyphens, underscores and
 * runs of space count as one space ("Check-in" = "check in").
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function isValidDomain(value: string): boolean {
  return DOMAIN_RE.test(normalizeDomain(value));
}

const BUILTIN: SenderDomain[] = Object.entries(catalogue.senders).flatMap(([kind, brands]) =>
  Object.entries(brands as Record<string, string[]>).flatMap(([brand, domains]) =>
    domains.map((domain) => ({ domain: normalizeDomain(domain), brand, kind: kind as BookingKind }))
  )
);

/** The built-in keywords, German and English, always active together. */
export function defaultKeywords(): Keyword[] {
  const out: Keyword[] = [];
  for (const lang of ["de", "en"] as const) {
    for (const entry of catalogue.keywords[lang] as Array<{ word: string; domain?: string }>) {
      out.push({
        word: entry.word,
        lang,
        ...(entry.domain ? { domain: entry.domain as BookingKind } : {}),
      });
    }
  }
  return out;
}

/** Sender domains named by the parser templates (v1 `from`, v2 `issuer.keys.senderDomains`). */
function templateDomains(): SenderDomain[] {
  const out: SenderDomain[] = [];
  try {
    for (const t of templateRegistry.getAll()) {
      for (const from of t.from ?? []) {
        out.push({ domain: normalizeDomain(from), brand: t.airline, kind: "flight" });
      }
    }
    for (const t of templateRegistry.getActiveV2()) {
      const kind = (
        t.domain === "lodging" ||
        t.domain === "flight" ||
        t.domain === "rail" ||
        t.domain === "cruise" ||
        t.domain === "rental" ||
        t.domain === "package"
          ? t.domain
          : "package"
      ) as BookingKind;
      for (const domain of t.issuer.keys?.senderDomains ?? []) {
        out.push({ domain: normalizeDomain(domain), brand: t.issuer.name, kind });
      }
    }
  } catch (err) {
    // The built-in list still applies; a template store that cannot be read only narrows it.
    logger.warn({ operation: "mail_intake_template_senders_unreadable", err });
  }
  return out.filter((d) => isValidDomain(d.domain));
}

/** Built-in and template sender domains, one entry per domain (built-in wins). */
export function defaultSenderDomains(): SenderDomain[] {
  const byDomain = new Map<string, SenderDomain>();
  for (const entry of [...BUILTIN, ...templateDomains()]) {
    if (!byDomain.has(entry.domain)) byDomain.set(entry.domain, entry);
  }
  return [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

export function buildRules(settings: PrefilterSettings): PrefilterRules {
  const removed = new Set(settings.removedSenderDomains.map(normalizeDomain));
  const domains = new Map<string, SenderDomain>();
  for (const entry of defaultSenderDomains()) {
    if (!removed.has(entry.domain)) domains.set(entry.domain, entry);
  }
  for (const raw of settings.senderDomains) {
    const domain = normalizeDomain(raw);
    if (domain && !domains.has(domain)) domains.set(domain, { domain, brand: domain, kind: null });
  }
  const off = new Set(settings.removedSubjectKeywords.map(normalizeText));
  const keywords = [
    ...defaultKeywords()
      .filter((k) => !off.has(normalizeText(k.word)))
      .map((k) => ({ norm: normalizeText(k.word), ...(k.domain ? { domain: k.domain } : {}) })),
    ...settings.subjectKeywords.map((w) => ({ norm: normalizeText(w) })),
  ].filter((k) => k.norm.length > 0);
  return {
    domains,
    keywords,
  };
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  return at > 0 ? normalizeDomain(address.slice(at + 1)) : null;
}

/** The listed domain `domain` falls under: itself or a parent (mail.lufthansa.com → lufthansa.com). */
function lookupDomain(domain: string, rules: PrefilterRules): SenderDomain | null {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i += 1) {
    const hit = rules.domains.get(labels.slice(i).join("."));
    if (hit) return hit;
  }
  return null;
}

/** The brand a sender domain belongs to, for the scan's "probably missing" list. */
export function brandOf(from: string | null, rules: PrefilterRules): SenderDomain | null {
  const domain = from ? domainOf(from) : null;
  return domain ? lookupDomain(domain, rules) : null;
}

/**
 * Takes a mail on its headers alone. A mailing-list mail (List-Id) from a
 * booking domain is the airline's newsletter, not a confirmation: it needs a
 * keyword as well.
 */
export function judge(header: HeaderInfo, rules: PrefilterRules): Verdict {
  const sender = brandOf(header.from, rules);
  const subject = header.subject ? normalizeText(header.subject) : "";
  const keyword = subject ? rules.keywords.find((k) => subject.includes(k.norm)) : undefined;
  const take = !!keyword || (!!sender && !header.hasListId);
  return {
    take,
    brand: take ? (sender?.brand ?? null) : null,
    kind: take ? (sender?.kind ?? keyword?.domain ?? null) : null,
  };
}
