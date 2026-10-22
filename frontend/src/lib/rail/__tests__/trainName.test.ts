import { describe, expect, it } from "vitest";
import { trainName } from "../trainName";

const bare = (n: string): string => `Zug ${n}`;

describe("trainName", () => {
  it("names a train known by its number alone as a train, not as a bare number", () => {
    expect(trainName(null, "57031", bare)).toBe("Zug 57031");
  });

  it("leaves a train with a category as it is", () => {
    expect(trainName("S", "1", bare)).toBe("S 1");
    expect(trainName("ICE", "1234", bare)).toBe("ICE 1234");
    expect(trainName("RB", null, bare)).toBe("RB");
  });

  it("says nothing when nothing is known", () => {
    expect(trainName(null, null, bare)).toBe("");
  });
});
