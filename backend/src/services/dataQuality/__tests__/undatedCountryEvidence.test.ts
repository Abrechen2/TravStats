/**
 * A country whose entire case is undated.
 *
 * The rule the owner accepted on 2026-09-02 — an undated house counts as a
 * night — is what makes this check necessary rather than pedantic: under it, one
 * wrongly imported house IS a country. The check does not undo the rule; it
 * names what the rule is resting on.
 */
import { describe, it, expect } from "@jest/globals";

import { findUndatedCountryEvidence, type CountryTouch } from "../checks/undatedCountryEvidence";

const undatedHouse = (country: string, id: string, label: string): CountryTouch => ({
  country,
  at: null,
  record: { entityType: "lodging", entityId: id, label },
});

const datedTouch = (country: string, at: Date): CountryTouch => ({ country, at, record: null });

describe("findUndatedCountryEvidence", () => {
  it("flags a country proved only by a house with no date", () => {
    const findings = findUndatedCountryEvidence([
      undatedHouse("Slovenia", "l1", "Hotel Sport"),
      datedTouch("Germany", new Date("2024-05-01")),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "country",
      entityId: "SI",
      kind: "undated_country_evidence",
    });
  });

  it("names every record behind the country, so the inbox can link to them", () => {
    // Design §3.4: a country row carries record IDs, not just counts —
    // "kinds: ['lodging']" says what sort of thing, not WHICH thing.
    const findings = findUndatedCountryEvidence([
      undatedHouse("Slovenia", "l1", "Hotel Sport"),
      undatedHouse("SI", "l2", "Penzion Otočec"),
    ]);

    expect(findings[0].details).toEqual({
      countryCode: "SI",
      records: [
        { entityType: "lodging", entityId: "l1", label: "Hotel Sport" },
        { entityType: "lodging", entityId: "l2", label: "Penzion Otočec" },
      ],
    });
  });

  it("stays silent when the same country also has one dated record", () => {
    // A single dated flight settles the question — the country is not resting
    // on the undated decision at all.
    expect(
      findUndatedCountryEvidence([
        undatedHouse("Slovenia", "l1", "Hotel Sport"),
        datedTouch("SI", new Date("2019-08-02")),
      ])
    ).toEqual([]);
  });

  it("joins on the ISO code, never on the spelling", () => {
    // "Deutschland" and "Germany" are one country, and only the code knows it.
    expect(
      findUndatedCountryEvidence([
        undatedHouse("Deutschland", "l1", "Pension Nord"),
        datedTouch("Germany", new Date("2021-03-04")),
      ])
    ).toEqual([]);
  });

  it("ignores a touch whose country cannot be resolved", () => {
    // "Dubai" is a city. A flag naming a country nothing counts would be worse
    // than a missing one.
    expect(findUndatedCountryEvidence([undatedHouse("Dubai", "l1", "Hotel X")])).toEqual([]);
  });

  it("ignores an undated touch with no record to link to", () => {
    expect(findUndatedCountryEvidence([{ country: "Slovenia", at: null, record: null }])).toEqual(
      []
    );
  });

  it("returns one flag per country, in a stable order", () => {
    const findings = findUndatedCountryEvidence([
      undatedHouse("Slovenia", "l2", "B"),
      undatedHouse("Austria", "l1", "A"),
      undatedHouse("Slovenia", "l3", "C"),
    ]);

    expect(findings.map((f) => f.entityId)).toEqual(["AT", "SI"]);
  });
});
