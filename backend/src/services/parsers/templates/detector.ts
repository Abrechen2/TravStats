interface DetectionRule {
  iata: string;
  fromDomains: string[];
  subjectPatterns: RegExp[];
  htmlFingerprints: string[];
}

const DETECTION_RULES: DetectionRule[] = [
  {
    iata: "LH",
    fromDomains: ["@lufthansa.com", "@miles-and-more.com"],
    subjectPatterns: [/buchungsbest.?tigung/i, /lufthansa.*booking confirmation/i, /ihre buchung/i],
    htmlFingerprints: ["lufthansa.com", "miles-and-more.com"],
  },
  {
    iata: "LX",
    fromDomains: ["@swiss.com", "@newsletter.swiss.com"],
    subjectPatterns: [/buchungsbest.?tigung/i, /your swiss booking/i],
    htmlFingerprints: ["swiss.com"],
  },
  {
    iata: "OS",
    fromDomains: ["@austrian.com", "@newsletter.austrian.com"],
    subjectPatterns: [/austrian booking/i, /ihre buchung bei austrian/i],
    htmlFingerprints: ["austrian.com"],
  },
  {
    iata: "FR",
    fromDomains: ["@ryanair.com", "@info.ryanair.com"],
    subjectPatterns: [/ryanair.*booking/i, /your booking confirmation/i],
    htmlFingerprints: ["ryanair.com"],
  },
  {
    iata: "U2",
    fromDomains: ["@easyjet.com", "@email.easyjet.com"],
    subjectPatterns: [/easyjet.*confirmation/i, /your easyjet booking/i],
    htmlFingerprints: ["easyjet.com"],
  },
  {
    iata: "EW",
    fromDomains: ["@eurowings.com", "@newsletter.eurowings.com"],
    subjectPatterns: [/eurowings.*buchung/i, /eurowings.*booking/i],
    htmlFingerprints: ["eurowings.com"],
  },
  {
    iata: "W6",
    fromDomains: ["@wizzair.com", "@info.wizzair.com"],
    subjectPatterns: [/wizz air.*booking/i, /buchungsbest.?tigung.*wizz/i],
    htmlFingerprints: ["wizzair.com"],
  },
  {
    iata: "SN",
    fromDomains: ["@brusselsairlines.com"],
    subjectPatterns: [/brussels airlines.*booking/i],
    htmlFingerprints: ["brusselsairlines.com"],
  },
];

export function detectAirline(
  fromAddress: string,
  subject: string,
  htmlContent: string
): string | null {
  for (const rule of DETECTION_RULES) {
    if (rule.fromDomains.some((domain) => fromAddress.toLowerCase().includes(domain))) {
      return rule.iata;
    }
    if (rule.subjectPatterns.some((pattern) => pattern.test(subject))) {
      return rule.iata;
    }
    if (rule.htmlFingerprints.some((fp) => htmlContent.toLowerCase().includes(fp))) {
      return rule.iata;
    }
  }
  return null;
}
