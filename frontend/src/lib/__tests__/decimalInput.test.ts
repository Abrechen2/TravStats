import { describe, it, expect } from "vitest";
import { parseDecimalInput } from "../decimalInput";

describe("parseDecimalInput (forgejo#163)", () => {
  it.each([
    ["150,00", 150],
    ["150.00", 150],
    ["25,5", 25.5],
    [" 42 ", 42],
    ["1.500,00", 1500],
    ["1,500.00", 1500],
    ["1.234.567,89", 1234567.89],
    [",5", 0.5],
    ["-3,5", -3.5],
    // A lone mark is the decimal mark; nothing says it groups.
    ["1.500", 1.5],
    ["1,500", 1.5],
  ])("reads %j as %s", (typed, expected) => {
    expect(parseDecimalInput(typed)).toBe(expected);
  });

  it("tells a blank field from a wrong one", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNaN();
    expect(parseDecimalInput("1,2,3")).toBeNaN();
    expect(parseDecimalInput("12,5x")).toBeNaN();
    expect(parseDecimalInput("1e3")).toBeNaN();
  });
});
