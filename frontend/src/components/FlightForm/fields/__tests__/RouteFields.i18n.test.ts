/**
 * Review follow-up (Task 4) — `flights:form.from`/`form.to` bake a "*"
 * required-marker directly into the translated string. That's accurate for
 * the create form (FlightCompleteStep.tsx, FlightReviewModal.tsx both still
 * pass `required` to AirportAutocomplete) but became a lie for RouteFields
 * once `required` was dropped there (a flight being edited always already
 * has coordinates, so the picker can never actually block a save).
 *
 * Ripple check before choosing a fix shape: `form.from`/`form.to` have THREE
 * consumers (FlightCompleteStep, FlightReviewModal, RouteFields) and only
 * TWO of them are still genuinely required. Re-deriving the marker from a
 * `required` prop would mean editing FlightReviewModal.tsx too — a form this
 * task never otherwise touches. A separate non-asterisk key pair used only
 * by the edit path stays confined to RouteFields.tsx + these two resource
 * files, so that's the shape chosen here.
 *
 * This file pins BOTH sides: the new edit-only keys carry no asterisk, and
 * the original create-form keys are untouched (still do) — protecting
 * against a future edit accidentally "fixing" one at the expense of the
 * other.
 */

import { describe, it, expect } from "vitest";
import de from "../../../../i18n/resources/de/flights.json";
import en from "../../../../i18n/resources/en/flights.json";

describe("RouteFields i18n — required-marker accuracy (review follow-up)", () => {
  it("the edit-only route labels carry no required marker", () => {
    expect(de.edit.routeFrom).not.toMatch(/\*/);
    expect(de.edit.routeTo).not.toMatch(/\*/);
    expect(en.edit.routeFrom).not.toMatch(/\*/);
    expect(en.edit.routeTo).not.toMatch(/\*/);
  });

  it("the create form's own from/to labels are untouched (still required)", () => {
    expect(de.form.from).toMatch(/\*/);
    expect(de.form.to).toMatch(/\*/);
    expect(en.form.from).toMatch(/\*/);
    expect(en.form.to).toMatch(/\*/);
  });

  it("the unresolved-edit hint exists in both languages", () => {
    expect(typeof de.edit.routeUnresolvedHint).toBe("string");
    expect(de.edit.routeUnresolvedHint.length).toBeGreaterThan(0);
    expect(typeof en.edit.routeUnresolvedHint).toBe("string");
    expect(en.edit.routeUnresolvedHint.length).toBeGreaterThan(0);
  });
});
