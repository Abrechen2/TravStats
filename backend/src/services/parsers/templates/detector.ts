interface DetectionRule {
  iata: string;
  fromDomains: string[];
  subjectPatterns: RegExp[];
  htmlFingerprints: string[];
}

const DETECTION_RULES: DetectionRule[] = [
  // Old Lufthansa format ("Buchungsdetails" in subject) — no domain match, subject-only detection
  // must come before generic LH rule so it wins on matching subjects
  {
    iata: "LH-old",
    fromDomains: [],
    subjectPatterns: [/buchungsdetails/i],
    htmlFingerprints: [],
  },
  {
    iata: "LH",
    fromDomains: ["@lufthansa.com", "@miles-and-more.com", "@lufthansa.de"],
    subjectPatterns: [
      /buchungsbest.?tigung/i,
      /lufthansa.*booking confirmation/i,
      /ihre buchung/i,
      /m.nchen nach/i,
      /flugbuchung/i,
    ],
    htmlFingerprints: ["lufthansa", "miles-and-more"],
  },
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
  const haystack = `${htmlContent}\n${textContent}`.toLowerCase();
  for (const rule of DETECTION_RULES) {
    const senderDomain = fromAddress.toLowerCase().split("@")[1] ?? "";
    if (
      rule.fromDomains.some((d) => {
        const ruleDomain = d.replace("@", "");
        return senderDomain === ruleDomain || senderDomain.endsWith("." + ruleDomain);
      })
    ) {
      return rule.iata;
    }
    const fingerprinted = rule.htmlFingerprints.some((fp) => haystack.includes(fp));
    if (fingerprinted) {
      return rule.iata;
    }
    const subjectHit = rule.subjectPatterns.some((pattern) => pattern.test(subject));
    if (subjectHit && rule.htmlFingerprints.length === 0) {
      return rule.iata;
    }
  }
  return null;
}
