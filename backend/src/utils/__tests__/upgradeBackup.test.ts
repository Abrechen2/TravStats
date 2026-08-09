import { parseMajor, shouldBackupBeforeMigrating } from "../upgradeBackup";

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

describe("upgradeBackup.shouldBackupBeforeMigrating (#246)", () => {
  // The trigger used to fire only when the MAJOR digit increased. 2.4.0 ->
  // 2.5.0 applied seven migrations and was skipped, so the release that most
  // needed a snapshot ran without one. What matters is not which digit moved
  // but whether an existing installation is about to migrate.
  it("backs up a minor upgrade of an existing install", () => {
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: "2.4.0",
        currentVersion: "2.5.0",
        hasExistingMigrations: true,
      }).backup
    ).toBe(true);
  });

  it("backs up a patch upgrade of an existing install", () => {
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: "2.5.0",
        currentVersion: "2.5.1",
        hasExistingMigrations: true,
      }).backup
    ).toBe(true);
  });

  it("still backs up a major upgrade", () => {
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: "1.9.9",
        currentVersion: "2.0.0",
        hasExistingMigrations: true,
      }).backup
    ).toBe(true);
  });

  it("does NOT back up a plain restart on the same version", () => {
    // Containers restart often; a snapshot per restart would fill the disk
    // and none of them would precede a migration.
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: "2.5.0",
        currentVersion: "2.5.0",
        hasExistingMigrations: true,
      }).backup
    ).toBe(false);
  });

  it("does NOT back up a fresh install", () => {
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: null,
        currentVersion: "2.5.0",
        hasExistingMigrations: false,
      }).backup
    ).toBe(false);
  });

  it("backs up a pre-marker install that already carries data", () => {
    // No version file, but migrations exist: an old install upgrading for the
    // first time since the marker was introduced. The case worth protecting.
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: null,
        currentVersion: "2.5.0",
        hasExistingMigrations: true,
      }).backup
    ).toBe(true);
  });

  it("backs up an rc -> final move on the same numbers", () => {
    // 2.6.0-rc.3 -> 2.6.0 is a different build; migrations can differ.
    expect(
      shouldBackupBeforeMigrating({
        previousVersion: "2.6.0-rc.3",
        currentVersion: "2.6.0",
        hasExistingMigrations: true,
      }).backup
    ).toBe(true);
  });

  it("gives a reason naming what changed", () => {
    const r = shouldBackupBeforeMigrating({
      previousVersion: "2.4.0",
      currentVersion: "2.5.0",
      hasExistingMigrations: true,
    });
    expect(r.reason).toContain("2.4.0");
    expect(r.reason).toContain("2.5.0");
  });
});
