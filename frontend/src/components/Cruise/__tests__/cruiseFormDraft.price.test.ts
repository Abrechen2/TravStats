import { describe, expect, it } from "vitest";
import { cruiseFieldErrors, cruiseFormFields, cruiseWriteBody } from "../cruiseFormDraft";

// `Number("39,90")` refused the ordinary German price and `parseFloat` read
// "1.500,00" as 1.5 — the bus form's forgejo#295, never carried to cruises.
const base = { startDate: "", endDate: "", deck: "" };

describe("cruise price in either notation", () => {
  it.each([
    ["39,90", 39.9],
    ["1.500,00", 1500],
    ["39.90", 39.9],
  ])("accepts %s and sends %s", (raw, expected) => {
    expect(cruiseFieldErrors({ ...base, price: raw }).price).toBeUndefined();
    const fields = { ...cruiseFormFields(undefined, "EUR"), price: raw };
    expect(cruiseWriteBody(fields).price).toBe(expected);
  });

  it.each(["abc", "39,9,0", "-1"])("refuses %s at the field", (raw) => {
    expect(cruiseFieldErrors({ ...base, price: raw }).price).toBe("cruise:form.errors.price");
  });
});
