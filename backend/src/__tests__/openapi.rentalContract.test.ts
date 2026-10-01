import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

/**
 * The rental contract the Companion builds on (spec
 * 2026-10-01-rental-domain-design §8, package R5): there is no separate
 * contract document — the OpenAPI spec plus ADR 0001/0002 is the contract —
 * so the fields the phone reads are pinned here. A rename on the server fails
 * this before it reaches a phone.
 */
type Schema = {
  properties?: Record<string, Record<string, unknown>>;
  $ref?: string;
  enum?: string[];
};
const doc = buildOpenApiDocument() as unknown as {
  components: { schemas: Record<string, Schema> };
  paths: Record<
    string,
    Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>
  >;
};
const schemas = doc.components.schemas;

describe("OpenAPI — the rental contract", () => {
  it("hands every rental time out in the time model's shape, on the station's clock", () => {
    const times = schemas.RentalTimes.properties ?? {};
    for (const key of ["pickup", "return", "actualPickup", "actualReturn"]) {
      expect(JSON.stringify(times[key])).toContain("TimeValue");
    }
    expect(Object.keys(schemas.RentalBooking.properties ?? {})).toEqual(
      expect.arrayContaining(["times", "pickupTimezone", "returnTimezone", "oneWay", "rentalDays"])
    );
  });

  it("names the invoice reminder the Companion shows after a return", () => {
    expect(schemas.RentalBooking.properties?.invoiceMissing).toMatchObject({ type: "boolean" });
    const reminders = JSON.stringify(doc.paths["/rentals/invoice-reminders"].get.responses["200"]);
    expect(reminders).toContain("invoiceMissing");
    expect(reminders).toContain("TimeValue");
  });

  it("lets /upcoming answer a rental entry", () => {
    const upcoming = JSON.stringify(doc.paths["/upcoming"].get.responses["200"]);
    expect(upcoming).toContain('"rental"');
  });

  it("documents km and the final amount as abstaining, never 0", () => {
    expect(String(schemas.RentalBooking.properties?.distanceKm?.description)).toMatch(
      /null = unknown, never 0/
    );
    expect(schemas.RentalBooking.properties?.distanceKm).toMatchObject({ nullable: true });
  });
});
