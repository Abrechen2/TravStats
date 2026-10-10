import { describe, expect, it } from "vitest";
import {
  applyBookingDraft,
  bookingDraftFrom,
  draftProblems,
  isEdited,
  parseDraftPrice,
  unreadFields,
} from "../railImportBookingDraft";
import { booking } from "./railImportFixture";

describe("railImportBookingDraft (forgejo#161)", () => {
  it("reads amounts in both notations and refuses what is not one", () => {
    expect(parseDraftPrice("59,90")).toBe(59.9);
    expect(parseDraftPrice("59.90")).toBe(59.9);
    expect(parseDraftPrice("1.084,50")).toBe(1084.5);
    expect(parseDraftPrice("1,084.50")).toBe(1084.5);
    expect(parseDraftPrice(" ")).toBeNull();
    // Ambiguous or not an amount: blocked, never guessed.
    expect(parseDraftPrice("1.084")).toBeUndefined();
    expect(parseDraftPrice("12 EUR")).toBeUndefined();
    expect(parseDraftPrice("-5")).toBeUndefined();
  });

  it("names exactly the facts the document did not carry", () => {
    expect(unreadFields(booking())).toEqual(["operator"]);
    expect(
      unreadFields(booking({ bookingReference: " ", travelClass: null, price: null }))
    ).toEqual(["operator", "bookingReference", "travelClass", "price"]);
  });

  it("starts from the parse and invents nothing for a gap", () => {
    const b = booking({ operator: null, price: null, currency: null });
    const draft = bookingDraftFrom(b);
    expect(draft).toMatchObject({ operator: "", price: "", currency: "" });
    expect(draftProblems(draft)).toEqual([]);
    expect(applyBookingDraft(b, draft)).toMatchObject({
      operator: null,
      price: null,
      currency: null,
    });
  });

  it("needs a currency for a total and tells an edit from the reading", () => {
    const b = booking();
    const draft = { ...bookingDraftFrom(b), currency: "" };
    expect(draftProblems(draft)).toEqual(["currency"]);
    expect(isEdited(b, bookingDraftFrom(b), "price")).toBe(false);
    expect(isEdited(b, { ...bookingDraftFrom(b), price: "1084.50" }, "price")).toBe(false);
    expect(isEdited(b, { ...bookingDraftFrom(b), price: "99" }, "price")).toBe(true);
  });
});
