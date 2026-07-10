import { settingsUpdateSchema } from "../../routes/settings/general";

describe("settings schema: whatsNewSeenVersion", () => {
  it("accepts a version string", () => {
    const parsed = settingsUpdateSchema.parse({ whatsNewSeenVersion: "2.4.0" });
    expect(parsed.whatsNewSeenVersion).toBe("2.4.0");
  });

  it("rejects a non-string", () => {
    expect(() => settingsUpdateSchema.parse({ whatsNewSeenVersion: 240 })).toThrow();
  });

  it("rejects an over-long value", () => {
    expect(() => settingsUpdateSchema.parse({ whatsNewSeenVersion: "x".repeat(33) })).toThrow();
  });

  it("still accepts a payload without the key", () => {
    expect(() => settingsUpdateSchema.parse({})).not.toThrow();
  });
});
