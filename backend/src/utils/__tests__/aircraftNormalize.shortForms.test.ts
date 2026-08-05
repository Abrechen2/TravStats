import { normalizeAircraft } from "../aircraftNormalize";

/**
 * Measured on a real 335-flight library: the SAME aircraft sat in the column
 * twice, once as "B737-800" and once as "Boeing 737-800". Of 31 distinct
 * stored types, 15 resolved to nothing at all — every one of them a short
 * form the alias table did not carry.
 *
 * The expansions deliberately KEEP the variant suffix. Mapping "B767-300ER"
 * onto the catalogue's plain "Boeing 767-300" would make the column look
 * consistent by discarding the extended-range distinction; that is a worse
 * outcome than leaving the value untouched.
 */
describe("aircraft short forms measured in real data", () => {
  const cases: Array<[string, string]> = [
    ["B737-800", "Boeing 737-800"],
    ["B737-900ER", "Boeing 737-900ER"],
    ["B737 MAX 8", "Boeing 737 MAX 8"],
    ["B737 MAX 8-200", "Boeing 737 MAX 8-200"],
    ["B767-300ER", "Boeing 767-300ER"],
    ["B767-400ER", "Boeing 767-400ER"],
    ["B777-200ER", "Boeing 777-200ER"],
    ["A320neo", "Airbus A320neo"],
    ["A321neo", "Airbus A321neo"],
    ["A321LR", "Airbus A321LR"],
    ["A220-300", "Airbus A220-300"],
    ["A330-900", "Airbus A330-900neo"],
    ["E195-E2", "Embraer E195-E2"],
    ["Airbus A320 (Sharklets)", "Airbus A320"],
  ];

  it.each(cases)("expands %s to %s", (input, expected) => {
    expect(normalizeAircraft(input)).toBe(expected);
  });

  it("is case-insensitive, as imported data is not consistent about it", () => {
    expect(normalizeAircraft("b737-800")).toBe("Boeing 737-800");
    expect(normalizeAircraft("a320NEO")).toBe("Airbus A320neo");
  });

  it("keeps the extended-range variants distinct from the base type", () => {
    expect(normalizeAircraft("B767-300ER")).not.toBe(normalizeAircraft("B767-300"));
    expect(normalizeAircraft("B777-200ER")).not.toBe(normalizeAircraft("B777-200"));
  });

  it("keeps A321LR distinct from A321neo — variant, not family", () => {
    expect(normalizeAircraft("A321LR")).not.toBe(normalizeAircraft("A321neo"));
  });

  it("still leaves a genuinely unknown type untouched", () => {
    expect(normalizeAircraft("Helikopter")).toBe("Helikopter");
    expect(normalizeAircraft("Some Experimental Prototype 9000")).toBe(
      "Some Experimental Prototype 9000",
    );
  });
});
