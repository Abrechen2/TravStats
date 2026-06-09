import { parseMajor } from "../upgradeBackup";

describe("upgradeBackup.parseMajor", () => {
  it("parses simple semver", () => {
    expect(parseMajor("1.2.1")).toBe(1);
    expect(parseMajor("2.0.0")).toBe(2);
  });

  it("parses pre-release tags", () => {
    expect(parseMajor("2.0.0-beta.4")).toBe(2);
    expect(parseMajor("2.0.0-rc.1")).toBe(2);
    expect(parseMajor("1.2.0-security-rc.1")).toBe(1);
  });

  it("strips leading v prefix", () => {
    expect(parseMajor("v2.0.0")).toBe(2);
    expect(parseMajor("V2.0.0-rc.1")).toBe(2);
  });

  it("returns null for non-version strings", () => {
    expect(parseMajor("unknown")).toBeNull();
    expect(parseMajor("")).toBeNull();
    expect(parseMajor("not-a-version")).toBeNull();
  });

  it("returns null when no dot follows the major", () => {
    expect(parseMajor("2")).toBeNull();
    expect(parseMajor("v2")).toBeNull();
  });

  it("handles double-digit majors", () => {
    expect(parseMajor("10.0.0")).toBe(10);
    expect(parseMajor("v123.4.5")).toBe(123);
  });
});
