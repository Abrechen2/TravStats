import { findRailOperator, railOperators } from "../operatorCatalog";
it("matches only known aliases and isolates logo-cache keys from rentals", () => {
  expect(findRailOperator(" DB Fernverkehr AG ")?.domain).toBe("bahn.de");
  expect(findRailOperator("DB Cargo unknown")).toBeNull();
  expect(findRailOperator("http://127.0.0.1")).toBeNull();
  expect(railOperators().every((operator) => operator.id.startsWith("rail-"))).toBe(true);
});

it("normalises operator name variants to one logo entry (forgejo operator-logos)", () => {
  for (const name of [
    "DB",
    "DB Fernverkehr",
    "Deutsche Bahn",
    "deutsche bahn ag",
    "DB Regio Bayern",
  ]) {
    expect(findRailOperator(name)?.id).toBe("rail-db");
  }
});

it("finds the Asian operators the owner's journeys name, also in compound names", () => {
  expect(findRailOperator("China Railway")?.id).toBe("rail-china-railway");
  expect(findRailOperator("China Railway / MTR")?.id).toBe("rail-china-railway");
  expect(findRailOperator("MTR")?.id).toBe("rail-mtr");
  expect(findRailOperator("Korail")?.id).toBe("rail-korail");
  expect(findRailOperator("Shanghai Maglev (Transrapid)")?.id).toBe("rail-shanghai-maglev");
  expect(findRailOperator("Meridian")?.id).toBe("rail-meridian");
  expect(findRailOperator("S-Bahn München")?.id).toBe("rail-sbahn-muenchen");
  expect(findRailOperator("Unknown Railways / Nobody")).toBeNull();
});
