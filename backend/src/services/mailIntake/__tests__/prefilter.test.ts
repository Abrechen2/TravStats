import { describe, it, expect } from "@jest/globals";

import catalogue from "../bookingSenders.json";
import {
  buildRules,
  defaultKeywords,
  defaultSenderDomains,
  judge,
  normalizeText,
  type HeaderInfo,
  type PrefilterSettings,
} from "../prefilter";

const none: PrefilterSettings = {
  senderDomains: [],
  removedSenderDomains: [],
  subjectKeywords: [],
  removedSubjectKeywords: [],
};
const mail = (over: Partial<HeaderInfo>): HeaderInfo => ({
  uid: 1,
  from: "friend@private.example",
  subject: "Grillen am Samstag?",
  date: null,
  messageId: null,
  hasListId: false,
  ...over,
});

describe("mail intake header pre-filter", () => {
  it("leaves a private mail out", () => {
    expect(judge(mail({}), buildRules(none, [])).take).toBe(false);
  });

  it("takes a mail from a booking domain and its subdomains, with the brand", () => {
    const rules = buildRules(none, []);
    expect(judge(mail({ from: "noreply@lufthansa.com", subject: "Hallo" }), rules)).toEqual({
      take: true,
      brand: "Lufthansa",
      kind: "flight",
    });
    expect(judge(mail({ from: "x@mail.booking.com", subject: "Hi" }), rules).take).toBe(true);
    // a look-alike is not a subdomain
    expect(judge(mail({ from: "x@notlufthansa.com", subject: "Hi" }), rules).take).toBe(false);
  });

  it("the default keywords are German AND English, both always active", () => {
    const rules = buildRules(none, []);
    const langs = new Set(defaultKeywords().map((k) => k.lang));
    expect(langs).toEqual(new Set(["de", "en"]));
    expect(catalogue.keywords.de.length).toBeGreaterThan(5);
    expect(catalogue.keywords.en.length).toBeGreaterThan(5);
    for (const subject of [
      "Ihre Buchungsbestätigung 4711",
      "Reservierungsbestätigung Hotel Adler",
      "Ihre Bordkarte für LH 400",
      "Mietwagen: Ihre Abholung",
      "Your booking confirmation",
      "Itinerary for your trip",
      "Your boarding pass",
      "Car rental voucher",
    ]) {
      expect({ subject, take: judge(mail({ subject }), rules).take }).toEqual({
        subject,
        take: true,
      });
    }
  });

  it("matches case-insensitively, as a substring, with ä/ae and ß/ss alike", () => {
    const rules = buildRules(none, []);
    expect(judge(mail({ subject: "BUCHUNGSBESTAETIGUNG Nr. 1" }), rules).take).toBe(true);
    expect(judge(mail({ subject: "Online Check in jetzt möglich" }), rules).take).toBe(true);
    expect(normalizeText("Straße Fähre")).toBe(normalizeText("STRASSE faehre"));
  });

  it("a custom word lets a mail through; a switched-off default does not", () => {
    const custom = buildRules({ ...none, subjectKeywords: ["Reisebüro Sonnenschein"] }, []);
    expect(judge(mail({ subject: "Neues vom Reisebuero Sonnenschein" }), custom).take).toBe(true);

    const off = buildRules({ ...none, removedSubjectKeywords: ["Reservierung"] }, []);
    expect(judge(mail({ subject: "Reservierung Tisch Freitag" }), off).take).toBe(false);
    // the others stay on
    expect(judge(mail({ subject: "Buchungsbestätigung" }), off).take).toBe(true);
  });

  it("a removed default domain stops matching; an added one matches", () => {
    const rules = buildRules(
      { ...none, removedSenderDomains: ["ryanair.com"], senderDomains: ["my-agency.example"] },
      []
    );
    expect(judge(mail({ from: "a@ryanair.com", subject: "x" }), rules).take).toBe(false);
    expect(judge(mail({ from: "a@my-agency.example", subject: "x" }), rules).take).toBe(true);
  });

  it("an allowlisted sender address counts", () => {
    const rules = buildRules(none, ["me@forward.example"]);
    expect(judge(mail({ from: "me@forward.example", subject: "fwd" }), rules).take).toBe(true);
  });

  it("a newsletter (List-Id) from a booking domain needs a keyword too", () => {
    const rules = buildRules(none, []);
    expect(
      judge(mail({ from: "news@lufthansa.com", subject: "Sale!", hasListId: true }), rules).take
    ).toBe(false);
    expect(
      judge(
        mail({ from: "news@lufthansa.com", subject: "Your boarding pass", hasListId: true }),
        rules
      ).take
    ).toBe(true);
  });

  it("the default domain list includes the template senders", () => {
    const domains = defaultSenderDomains().map((d) => d.domain);
    expect(domains).toEqual(expect.arrayContaining(["booking.com", "bahn.de", "sixt.com"]));
    expect(new Set(domains).size).toBe(domains.length);
  });
});
