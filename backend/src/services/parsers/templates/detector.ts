interface DetectionRule {
  iata: string;
  fromDomains: string[];
  subjectPatterns: RegExp[];
  htmlFingerprints: string[];
}

/**
 * Detection for the v1 airline templates only — the HTML-selector templates
 * the template repository's v1 index still serves (LX, OS, FR, U2, EW, W6,
 * SN). Since plan 2026-10-09 P4a the airlines with v2 template files
 * (Lufthansa in both layouts, Germanwings, Emirates in both layouts, Air
 * Berlin) recognise their own mail through the file's `match` block, and their
 * rules no longer live in code. A v1 template whose name a v2 file carries is
 * skipped by the parser even if a rule here named it.
 */
const DETECTION_RULES: DetectionRule[] = [
  {
    iata: "LX",
    fromDomains: ["@swiss.com", "@newsletter.swiss.com"],
    subjectPatterns: [/buchungsbest.?tigung/i, /your swiss booking/i],
    htmlFingerprints: ["swiss.com", "swiss international"],
  },
  {
    iata: "OS",
    fromDomains: ["@austrian.com", "@newsletter.austrian.com"],
    subjectPatterns: [/austrian booking/i, /ihre buchung bei austrian/i],
    htmlFingerprints: ["austrian.com", "austrian airlines"],
  },
  {
    iata: "FR",
    fromDomains: ["@ryanair.com", "@info.ryanair.com"],
    subjectPatterns: [/ryanair.*booking/i, /your booking confirmation/i],
    htmlFingerprints: ["ryanair"],
  },
  {
    iata: "U2",
    fromDomains: ["@easyjet.com", "@email.easyjet.com"],
    subjectPatterns: [/easyjet.*confirmation/i, /your easyjet booking/i],
    htmlFingerprints: ["easyjet"],
  },
  {
    iata: "EW",
    fromDomains: ["@eurowings.com", "@newsletter.eurowings.com"],
    subjectPatterns: [/eurowings.*buchung/i, /eurowings.*booking/i],
    htmlFingerprints: ["eurowings"],
  },
  {
    iata: "W6",
    fromDomains: ["@wizzair.com", "@info.wizzair.com"],
    subjectPatterns: [/wizz air.*booking/i, /buchungsbest.?tigung.*wizz/i],
    htmlFingerprints: ["wizzair", "wizz air"],
  },
  {
    iata: "SN",
    fromDomains: ["@brusselsairlines.com"],
    subjectPatterns: [/brussels airlines.*booking/i],
    htmlFingerprints: ["brusselsairlines", "brussels airlines"],
  },
];

/**
 * Which airline's template a mail should get.
 *
 * Three kinds of evidence, in order of strength: the sender's domain, an
 * airline fingerprint anywhere in the HTML or text, and the subject line. A
 * subject alone is accepted only for a rule that has no fingerprints to ask
 * for (the old Lufthansa "Buchungsdetails" mails carry none) — otherwise the
 * fingerprint must be there too. Measured 2026-09-05: a forwarded Emirates
 * confirmation whose subject read "Ihre Buchung ist bestätigt" was detected as
 * Lufthansa on the subject rule alone, the Lufthansa template then read one
 * leg out of two with the generic patterns that fit any airline, and its
 * confidence was high enough to win over the regex parser that had read both.
 *
 * `textContent` is the cleaned body; fingerprints are checked against it as
 * well as the HTML because a plain-text export has no HTML at all.
 */
export function detectAirline(
  fromAddress: string,
  subject: string,
  htmlContent: string,
  textContent = ""
): string | null {
  return detectAirlines(fromAddress, subject, htmlContent, textContent)[0] ?? null;
}

/**
 * Every template a mail could belong to, strongest rule first.
 *
 * `detectAirline` answers the first of these, and for a long time that was
 * the only answer: the first rule that matched decided the template, and when
 * that template declined the mail went straight to the generic regex. Measured
 * 2026-10-01 on a private mailbox: twenty Germanwings confirmations mention
 * "Lufthansa AirPlus" in their tax note, so the Lufthansa rule claimed every
 * one, its template found no Lufthansa leg and declined, and the regex then
 * read the airline's VAT number as a flight. The parser now walks this
 * list until a template reads the mail, so a later rule gets its turn exactly
 * when every earlier one has declined — and a mail an earlier template reads
 * keeps that reading.
 */
export function detectAirlines(
  fromAddress: string,
  subject: string,
  htmlContent: string,
  textContent = ""
): string[] {
  const haystack = `${htmlContent}\n${textContent}`.toLowerCase();
  const senderDomain = fromAddress.toLowerCase().split("@")[1] ?? "";
  return DETECTION_RULES.filter((rule) => {
    const fromSender = rule.fromDomains.some((d) => {
      const ruleDomain = d.replace("@", "");
      return senderDomain === ruleDomain || senderDomain.endsWith("." + ruleDomain);
    });
    if (fromSender) return true;
    if (rule.htmlFingerprints.some((fp) => haystack.includes(fp))) return true;
    const subjectHit = rule.subjectPatterns.some((pattern) => pattern.test(subject));
    return subjectHit && rule.htmlFingerprints.length === 0;
  }).map((rule) => rule.iata);
}
