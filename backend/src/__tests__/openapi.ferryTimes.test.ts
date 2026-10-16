import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

/**
 * A ferry crossing's `times` is named by its own component, as bus's is: the
 * contract reused `RailTimes`, so a client generated from the spec typed every
 * crossing's times as a train's ("at their stations") and a later change to
 * rail's times would silently have changed ferry's contract too.
 */
it("names a ferry crossing's times FerryTimes, not RailTimes", () => {
  const document = buildOpenApiDocument();
  const schemas = document.components?.schemas ?? {};
  expect(schemas).toHaveProperty("FerryTimes");
  const journey = JSON.stringify(schemas.FerryJourney);
  expect(journey).toContain("#/components/schemas/FerryTimes");
  expect(journey).not.toContain("#/components/schemas/RailTimes");
});
