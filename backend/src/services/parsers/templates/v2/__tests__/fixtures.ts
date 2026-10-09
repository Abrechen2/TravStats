import type { TemplateEnvelope } from "../envelope";

/**
 * A lodging template whose matcher reads its own positive case and declines
 * the negative one. Invented values only, as the template repository requires.
 */
export function validTemplate(overrides: Partial<TemplateEnvelope> = {}): TemplateEnvelope {
  return {
    id: "lodging:examplechain",
    domain: "lodging",
    version: "2026.10.01",
    issuer: {
      name: "Example Hotels",
      kind: "hotel-chain",
      keys: { senderDomains: ["example.com"] },
    },
    markets: ["DE"],
    match: { markers: ["example hotels"], anchors: ["reservierung nr."] },
    extraction: { domain: "lodging", fields: {} },
    testCases: [
      {
        name: "a confirmation is read",
        input: { subject: "Ihre Buchung", text: "Example Hotels\nReservierung Nr. ABC123" },
        expect: "match",
      },
      {
        name: "a newsletter is declined",
        input: "Example Hotels newsletter: autumn offers",
        expect: "decline",
      },
    ],
    ...overrides,
  };
}
