import { shouldBackupBeforeMigrating } from "../upgradeBackup";

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

describe("upgradeBackup.getCurrentVersion — APP_VERSION drift rules", () => {
  // getCurrentVersion reads the real VERSION file two directories up; these
  // tests only vary the env against whatever that file holds.
  const fs = require("fs");
  const path = require("path");
  const { getCurrentVersion } = require("../upgradeBackup");
  const versionFile = path.join(__dirname, "..", "..", "..", "VERSION");
  const baked = fs.readFileSync(versionFile, "utf-8").trim();
  const stripped = baked.replace(/-(rc|security-rc|beta|alpha)\.\d+$/, "");

  const originalEnv = process.env.APP_VERSION;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = originalEnv;
  });

  it("uses the baked VERSION file when no env is set", () => {
    delete process.env.APP_VERSION;
    expect(getCurrentVersion()).toBe(baked);
  });

  it("uses the env when it matches the baked version exactly", () => {
    process.env.APP_VERSION = baked;
    expect(getCurrentVersion()).toBe(baked);
  });

  // The one legitimate disagreement: a byte-identical RC promotion, where the
  // file keeps the rc suffix and compose declares the released identity.
  it("honours the env when it is the promotion alias of the baked version", () => {
    if (stripped === baked) {
      // The repo VERSION currently has no pre-release suffix, so the alias
      // case is unreachable against the real file — covered by the rule's
      // exact-match branch instead.
      expect(getCurrentVersion()).toBe(baked);
      return;
    }
    process.env.APP_VERSION = stripped;
    expect(getCurrentVersion()).toBe(stripped);
  });

  // The stale-env case that skipped a real upgrade's backup on the beta box:
  // env still said the previous build while the image was already the next.
  it("ignores a stale prerelease env in favour of the baked file", () => {
    process.env.APP_VERSION = "0.0.9-beta.1";
    expect(getCurrentVersion()).toBe(baked);
  });

  // The quoting-slip case: a mangled value must never become the recorded
  // version this install compares against forever.
  it("ignores a garbage env value", () => {
    process.env.APP_VERSION = `${baked}"`;
    expect(getCurrentVersion()).toBe(baked);
  });
});
