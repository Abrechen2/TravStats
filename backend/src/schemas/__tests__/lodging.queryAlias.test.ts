import { describe, it, expect } from "@jest/globals";
import { lodgingQuerySchema } from "../lodging";

describe("lodgingQuerySchema text filter (forgejo#403)", () => {
  it("accepts `q` as an alias of `search`, like every other domain's list", () => {
    const parsed = lodgingQuerySchema.parse({ q: "Zephyr" });
    expect(parsed.search).toBe("Zephyr");
    expect("q" in parsed).toBe(false);
  });

  it("keeps `search` working and lets it win when both are sent", () => {
    expect(lodgingQuerySchema.parse({ search: "old" }).search).toBe("old");
    expect(lodgingQuerySchema.parse({ search: "old", q: "new" }).search).toBe("old");
    expect(lodgingQuerySchema.parse({}).search).toBeUndefined();
  });
});
