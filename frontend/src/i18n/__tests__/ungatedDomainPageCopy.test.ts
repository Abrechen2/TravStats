import { describe, expect, it } from "vitest";

import deBus from "../resources/de/bus.json";
import enBus from "../resources/en/bus.json";
import deFerry from "../resources/de/ferry.json";
import enFerry from "../resources/en/ferry.json";
import deRental from "../resources/de/rental.json";
import enRental from "../resources/en/rental.json";

/**
 * Rental, bus and ferry left beta on 2026-10-26 (owner); their pages must not
 * say otherwise — the rail precedent (`railPageCopy.test.ts`).
 */
describe("the rental, bus and ferry pages out of beta", () => {
  it.each([
    ["de bus", deBus],
    ["en bus", enBus],
    ["de ferry", deFerry],
    ["en ferry", enFerry],
    ["de rental", deRental],
    ["en rental", enRental],
  ])("%s carries no beta note", (_label, bundle) => {
    expect("betaNote" in bundle).toBe(false);
    expect(bundle.subtitle).not.toMatch(/beta/i);
    expect((bundle as { pageNote?: string }).pageNote ?? "").not.toMatch(/beta/i);
  });
});
