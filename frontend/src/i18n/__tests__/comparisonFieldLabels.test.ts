import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import deEncryptedShare from "../resources/de/encryptedShare.json";
import enEncryptedShare from "../resources/en/encryptedShare.json";
import { DOMAIN_KEYS } from "../../shared/domains";
import { comparisonFieldLabel } from "../../components/encryptedShare/fieldLabel";

/**
 * The consent screen (GrantEditor's record preview) and the record browser
 * label every shared column with `encryptedShare:field.<name>`. Those labels were
 * generated from the column names and read "anchor Stop Kennung", "created am",
 * "Arr icao", "Dep lat" — the one screen where a user decides what a friend may
 * see was the one nobody could read. And one name means different things per
 * domain: a flight's `departureTime` is "Abflug", a train's is "Abfahrt".
 */
const de = deEncryptedShare.field as Record<string, string>;
const en = enEncryptedShare.field as Record<string, string>;
const byDomain = deEncryptedShare.fieldByDomain as Record<string, Record<string, string>>;
const byDomainEn = enEncryptedShare.fieldByDomain as Record<string, Record<string, string>>;

describe("comparison field labels read as written by hand", () => {
  it.each(Object.keys(de))("%s", (key) => {
    // A German noun label starts upper-case; the generated ones began with the
    // raw camelCase head ("anchor", "created", "lodging", "ride").
    expect(de[key]).toMatch(/^[A-ZÄÖÜ0-9]/u);
    expect(en[key]).toMatch(/^[A-Z0-9]/u);
    // The generator's fingerprints: an English camelCase fragment left in the
    // German label ("… Kennung" for "…Id"), an untranslated column
    // abbreviation, a lower-case code.
    expect(de[key]).not.toMatch(/\bKennung$|\b(Arr|Dep|Fx)\b/u);
    expect(en[key]).not.toMatch(/^(Arr|Dep|Fx) |\b(iata|icao|lat|lon|idx|utc)\b|\bid$/u);
  });

  it("names only real fields and real domains in the per-domain wording", () => {
    for (const [domain, fields] of Object.entries(byDomain)) {
      expect(DOMAIN_KEYS as readonly string[]).toContain(domain);
      for (const name of Object.keys(fields)) expect(de).toHaveProperty(name);
      expect(Object.keys(byDomainEn[domain] ?? {}).sort()).toEqual(Object.keys(fields).sort());
    }
  });
});

describe("a field shared by several domains carries each domain's own word", () => {
  const instance = createInstance();
  void instance.init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: { encryptedShare: deEncryptedShare },
      en: { encryptedShare: enEncryptedShare },
    },
  });
  const t = instance.getFixedT("de", "encryptedShare");

  it.each([
    ["flight", "departureTime", "Abflug"],
    ["rail", "departureTime", "Abfahrt"],
    ["ferry", "depStationName", "Abfahrtshafen"],
    ["bus", "depStationName", "Abfahrtsterminal"],
    ["rail", "depStationName", "Abfahrtsbahnhof"],
    ["lodging", "checkIn", "Anreise"],
    ["lodging", "checkOut", "Abreise"],
  ])("%s %s → %s", (domain, name, label) => {
    expect(comparisonFieldLabel(t, domain, name)).toBe(label);
  });
});
