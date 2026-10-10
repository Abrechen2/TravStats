import { describe, it, expect } from "@jest/globals";
import { derivePlaceTemplate } from "../placeDeriver";
import { applyV2PlaceTemplate } from "../../../places/v2Place";
import { applyV2CruiseTemplate } from "../../../cruise/v2Cruise";
import { workshopEnvelopeSchema } from "../../templates/v2/envelope";
import {
  PLACE_FOREIGN,
  PLACE_HELD_OUT,
  PLACE_SELECTIONS,
  PLACE_SOURCE,
  PLACE_SUBJECT,
  select,
} from "./workshopSamples";

/**
 * forgejo#124 — the workshop derives a place template, read by the generic
 * place consumer into a place import candidate. There is no compiled-in place
 * reader; this template is the reader.
 */

const input = {
  trainingDataId: "td-place-1",
  subject: PLACE_SUBJECT,
  fullText: PLACE_SOURCE,
  selections: PLACE_SELECTIONS,
};

function derived() {
  const result = derivePlaceTemplate(input);
  if (!result.ok) throw new Error(`derivation refused: ${result.refusal}`);
  return result.template;
}

describe("derivePlaceTemplate", () => {
  it("writes a place envelope the shared schema accepts", () => {
    const template = derived();
    expect(workshopEnvelopeSchema.safeParse(template).success).toBe(true);
    expect(template.id).toBe("place:user-td-place-1");
    expect(template.extraction.required).toEqual(["name"]);
  });

  it("reads its own ticket into an import candidate — and no position it does not know", () => {
    expect(applyV2PlaceTemplate(derived(), `${PLACE_SUBJECT}\n${PLACE_SOURCE}`)).toEqual({
      sourceRowIndex: 0,
      name: "Museum am Probeufer",
      address: "Uferweg 12, 10999 Musterstadt",
      category: "Museum",
      visitedAt: "2027-09-14",
    });
  });

  it("reads a held-out ticket of the same museum", () => {
    expect(applyV2PlaceTemplate(derived(), PLACE_HELD_OUT)).toMatchObject({
      name: "Museum am Probeufer",
      visitedAt: "2027-11-02",
    });
  });

  it("declines another museum's ticket", () => {
    expect(applyV2PlaceTemplate(derived(), PLACE_FOREIGN)).toBeNull();
  });

  it("is never read as a cruise, whatever the document", () => {
    // The cruise consumer checks the envelope's domain before it runs anything.
    expect(applyV2CruiseTemplate(derived(), PLACE_SOURCE)).toEqual([]);
  });

  it("abstains without a name — a place nobody can name is no row to offer", () => {
    const result = derivePlaceTemplate({
      ...input,
      selections: PLACE_SELECTIONS.filter((s) => s.label !== "name"),
    });
    expect(result).toEqual({ ok: false, refusal: "placeNeedsName" });
  });

  it("abstains when the marked visit date is not one it can read", () => {
    const text = PLACE_SOURCE.replace("14.09.2027", "Sonntag");
    const result = derivePlaceTemplate({
      ...input,
      fullText: text,
      selections: [
        select(text, "Museum am Probeufer", "name"),
        select(text, "Sonntag", "visitedAt"),
      ],
    });
    expect(result).toEqual({ ok: false, refusal: "dateNotUnderstood" });
  });
});
