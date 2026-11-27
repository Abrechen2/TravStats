import { describe, expect, it } from "vitest";

import { originHost } from "../personHandle";

describe("originHost (UAT 2026-11-27: the handle read 'dennis@http://…')", () => {
  it("drops the scheme and a trailing slash, keeps the port", () => {
    expect(originHost("http://192.0.2.7:3010")).toBe("192.0.2.7:3010");
    expect(originHost("https://trav.example.org/")).toBe("trav.example.org");
  });
});
