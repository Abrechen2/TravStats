/**
 * The two contracts a data-quality flag makes about itself.
 *
 * 1. **`kind` and `details` are one fact, not two.** The schema used to be a
 *    bare `z.union` of the three detail shapes, so it checked that `details`
 *    was SOME known shape and never that it was the shape `kind` names. A flag
 *    saying `stay_dates_reversed` over an address-mismatch payload validated
 *    cleanly, which is why the frontend carried three hand-written guards to
 *    re-derive the pairing at runtime. Every "rejects" case below passes under
 *    the old union — that is the defect, stated as a test.
 *
 * 2. **`subject.label` means exactly one thing.** It is display text the user
 *    wrote. A country has none — its name is localised in the browser — so a
 *    country subject carries `countryCode` and no label at all, rather than
 *    putting the raw ISO code in a field every other subject fills with a name.
 */
import { describe, it, expect } from "@jest/globals";

import {
  dataQualityFlagPayloadSchema,
  dataQualityFlagSchema,
  dataQualityFlagSubjectSchema,
} from "../dataQualityFlag";

const addressMismatchDetails = {
  claimedCountryCode: "RO",
  claimedCountryText: "Rumänien",
  addressCountryCode: "SI",
  addressCountryText: "Slovenia",
  address: "Grajska cesta 2, Otočec, Slovenia",
};

const undatedCountryDetails = {
  countryCode: "CZ",
  records: [{ entityType: "lodging", entityId: "l1", label: "Pension Prag" }],
};

const stayDatesReversedDetails = {
  stays: [{ stayId: "s1", checkIn: "2024-09-03T00:00:00.000Z", checkOut: "2024-03-09T00:00:00.000Z" }],
};

describe("dataQualityFlagPayloadSchema — details must be the shape its kind names", () => {
  it("accepts each kind with its own details", () => {
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "address_country_mismatch",
        details: addressMismatchDetails,
      }).success
    ).toBe(true);
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "undated_country_evidence",
        details: undatedCountryDetails,
      }).success
    ).toBe(true);
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "stay_dates_reversed",
        details: stayDatesReversedDetails,
      }).success
    ).toBe(true);
  });

  it("rejects a kind carrying another kind's details", () => {
    // The case the old `z.union` waved through: a well-formed payload of the
    // WRONG kind. Both directions, because a union is symmetrically blind.
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "stay_dates_reversed",
        details: addressMismatchDetails,
      }).success
    ).toBe(false);
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "address_country_mismatch",
        details: undatedCountryDetails,
      }).success
    ).toBe(false);
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "undated_country_evidence",
        details: stayDatesReversedDetails,
      }).success
    ).toBe(false);
  });

  it("rejects a kind it does not know, however well-formed the details are", () => {
    expect(
      dataQualityFlagPayloadSchema.safeParse({
        kind: "some_future_check",
        details: addressMismatchDetails,
      }).success
    ).toBe(false);
  });

  it("narrows details to the matching type once parsed", () => {
    const parsed = dataQualityFlagPayloadSchema.parse({
      kind: "undated_country_evidence",
      details: undatedCountryDetails,
    });

    // The property the frontend guards existed to fake: reading `details` off
    // `kind` with no further checking, and the compiler agreeing.
    if (parsed.kind !== "undated_country_evidence") throw new Error("wrong variant");
    expect(parsed.details.countryCode).toBe("CZ");
    expect(parsed.details.records).toHaveLength(1);
  });
});

describe("dataQualityFlagSubjectSchema — a label is a name, never a code", () => {
  it("accepts a row subject with the user's own text", () => {
    expect(
      dataQualityFlagSubjectSchema.safeParse({
        entityType: "lodging",
        entityId: "l1",
        label: "Hotel Sport",
      }).success
    ).toBe(true);
  });

  it("accepts a country subject that carries only its ISO code", () => {
    const parsed = dataQualityFlagSubjectSchema.parse({ entityType: "country", countryCode: "CZ" });
    if (parsed.entityType !== "country") throw new Error("wrong variant");
    expect(parsed.countryCode).toBe("CZ");
  });

  it("rejects the old shape, where a country put its code in `label`", () => {
    // `{entityType: "country", entityId: "CZ", label: "CZ"}` is what made
    // `label` mean a name for a lodging and a code for a country. It no longer
    // parses, so no consumer can be handed one and print it as a name.
    expect(
      dataQualityFlagSubjectSchema.safeParse({
        entityType: "country",
        entityId: "CZ",
        label: "CZ",
      }).success
    ).toBe(false);
  });

  it("rejects a row subject with no label", () => {
    expect(
      dataQualityFlagSubjectSchema.safeParse({ entityType: "place", entityId: "p1" }).success
    ).toBe(false);
  });
});

describe("dataQualityFlagSchema — the whole flag as it goes over the wire", () => {
  const flagBase = {
    id: "11111111-1111-4111-8111-111111111111",
    entityType: "lodging",
    entityId: "l1",
    status: "open",
    subject: { entityType: "lodging", entityId: "l1", label: "Hotel Sport" },
    createdAt: "2026-09-02T10:00:00.000Z",
    resolvedAt: null,
  };

  it("accepts a flag whose details match its kind", () => {
    expect(
      dataQualityFlagSchema.safeParse({
        ...flagBase,
        kind: "address_country_mismatch",
        details: addressMismatchDetails,
      }).success
    ).toBe(true);
  });

  it("rejects a flag whose details do not match its kind", () => {
    expect(
      dataQualityFlagSchema.safeParse({
        ...flagBase,
        kind: "stay_dates_reversed",
        details: addressMismatchDetails,
      }).success
    ).toBe(false);
  });

  it("rejects a country flag whose subject is a labelled record", () => {
    expect(
      dataQualityFlagSchema.safeParse({
        ...flagBase,
        entityType: "country",
        entityId: "CZ",
        kind: "undated_country_evidence",
        details: undatedCountryDetails,
        subject: { entityType: "country", entityId: "CZ", label: "CZ" },
      }).success
    ).toBe(false);
  });
});
