import { describe, expect, it } from "vitest";
import { tokens } from "../tokens";

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const distance = (a: string, b: string): number => {
  const [x, y] = [channels(a), channels(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/** A map reads colour as meaning: a list swatch must not pass for a domain. */
const MIN_DISTANCE = 45;

describe("list colour palette", () => {
  it("keeps the lime list colour clearly apart from the roadtrip/tour moss (was 16 RGB points)", () => {
    expect(distance(tokens.listColor.lime, tokens.domainColor.roadtrip)).toBeGreaterThanOrEqual(
      MIN_DISTANCE
    );
    expect(distance(tokens.listColor.lime, tokens.domainColor.tour)).toBeGreaterThanOrEqual(
      MIN_DISTANCE
    );
  });
});
