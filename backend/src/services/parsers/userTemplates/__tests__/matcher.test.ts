import { matchesFingerprint } from "../matcher";
import type { TemplateFingerprint } from "../types";

const FP: TemplateFingerprint = {
  senderDomains: ["noti.swiss.com"],
  subjectPatterns: ["Buchungsbestätigung"],
  bodyMarkers: ["Buchungsübersicht", "IATA-Code des Abflughafens"],
};

describe("matchesFingerprint", () => {
  it("matches when all body markers present and sender domain matches", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "noreply@noti.swiss.com";
    expect(matchesFingerprint(FP, from, "irrelevant", body)).toBe(true);
  });

  it("matches via subject pattern when sender domain misses", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "other@somemail.com";
    expect(matchesFingerprint(FP, from, "Buchungsbestätigung LX123", body)).toBe(true);
  });

  it("does not match when a body marker is missing", () => {
    const body = "Buchungsübersicht only";
    const from = "noreply@noti.swiss.com";
    expect(matchesFingerprint(FP, from, "Buchungsbestätigung", body)).toBe(false);
  });

  it("does not match when neither sender nor subject matches", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "noreply@other.com";
    const subject = "Your trip";
    expect(matchesFingerprint(FP, from, subject, body)).toBe(false);
  });

  it("matches subdomain of senderDomain", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "noreply@mail.noti.swiss.com";
    expect(matchesFingerprint(FP, from, "irrelevant", body)).toBe(true);
  });

  it("matches subject case-insensitively", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "other@somemail.com";
    expect(matchesFingerprint(FP, from, "BUCHUNGSBESTÄTIGUNG", body)).toBe(true);
  });
});
