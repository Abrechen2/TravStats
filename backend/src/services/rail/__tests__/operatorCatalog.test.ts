import { findRailOperator, railOperators } from "../operatorCatalog";
it("matches only known aliases and isolates logo-cache keys from rentals", () => {
  expect(findRailOperator(" DB Fernverkehr AG ")?.domain).toBe("bahn.de");
  expect(findRailOperator("DB Cargo unknown")).toBeNull();
  expect(findRailOperator("http://127.0.0.1")).toBeNull();
  expect(railOperators().every((operator) => operator.id.startsWith("rail-"))).toBe(true);
});
