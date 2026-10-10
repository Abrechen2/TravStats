import fs from "fs";
import os from "os";
import path from "path";

import { BACKED_UP_UPLOAD_DIRS, type UploadDirName } from "../../../config/uploadDirs";
import { collectUploadDirNamesFromSource } from "../../../config/__tests__/uploadDirScan";
import { collectAccountFiles } from "../accountFiles";
import { UPLOAD_DIR_POLICIES } from "../uploadDirPolicies";
import { sweepOrphanUploads } from "../uploadSweep";

/**
 * The guard of forgejo#287: no upload directory may be forgotten by the
 * account-deletion step or by the orphan sweep, the way three were once
 * forgotten by the backup.
 *
 * Two halves. The first reads the declarations: every directory the source
 * defines and every one the backup lists has a policy, and each half of that
 * policy either names its rows or says, with a reason, why there are none. The
 * second watches the two mechanisms run and requires them to have asked every
 * directory — a policy that exists but is never consulted is the same bug.
 *
 * No database: the row readers are replaced, which is all this half needs.
 */
describe("upload directory policies", () => {
  const allDirs = (): string[] => [
    ...new Set([...collectUploadDirNamesFromSource(), ...BACKED_UP_UPLOAD_DIRS]),
  ];

  it("gives every upload directory a deletion rule and a sweep rule", () => {
    const policies: Record<string, unknown> = UPLOAD_DIR_POLICIES;
    const missing = allDirs().filter((dir) => !(dir in policies));
    expect(missing).toEqual([]);
    // And no policy for a directory that is not backed up: the lists are one list.
    expect(Object.keys(UPLOAD_DIR_POLICIES).sort()).toEqual([...BACKED_UP_UPLOAD_DIRS].sort());
  });

  it("states a reason wherever a directory is exempt", () => {
    for (const dir of BACKED_UP_UPLOAD_DIRS) {
      const { account, sweep } = UPLOAD_DIR_POLICIES[dir];
      for (const rule of [account, sweep]) {
        if (rule.kind === "none") expect(rule.reason.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("holds every user-owned directory to both mechanisms", () => {
    // Only two directories hold nothing of an account's: the transient mail
    // staging area and the instance's login backgrounds. Anything else exempt
    // here is a directory somebody forgot to describe.
    const exemptFromDeletion = BACKED_UP_UPLOAD_DIRS.filter(
      (d) => UPLOAD_DIR_POLICIES[d].account.kind === "none"
    );
    const exemptFromSweep = BACKED_UP_UPLOAD_DIRS.filter(
      (d) => UPLOAD_DIR_POLICIES[d].sweep.kind === "none"
    );
    expect(exemptFromDeletion.sort()).toEqual(["emails", "login-backgrounds"]);
    expect(exemptFromSweep).toEqual(["login-backgrounds"]);
  });

  describe("the mechanisms consult every policy", () => {
    let root: string;
    const spies: jest.SpyInstance[] = [];

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "upload-policies-"));
    });
    afterEach(() => {
      spies.splice(0).forEach((s) => s.mockRestore());
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("the account-deletion step asks every directory that holds account files", async () => {
      const asked: UploadDirName[] = [];
      for (const dir of BACKED_UP_UPLOAD_DIRS) {
        const rule = UPLOAD_DIR_POLICIES[dir].account;
        if (rule.kind !== "rows") continue;
        spies.push(
          jest.spyOn(rule, "namesOf").mockImplementation(async () => {
            asked.push(dir);
            return [];
          })
        );
      }
      await collectAccountFiles("someone", { root });
      expect(asked.sort()).toEqual(
        BACKED_UP_UPLOAD_DIRS.filter((d) => UPLOAD_DIR_POLICIES[d].account.kind === "rows").sort()
      );
    });

    it("the orphan sweep asks every directory it may sweep", async () => {
      const asked: UploadDirName[] = [];
      for (const dir of BACKED_UP_UPLOAD_DIRS) {
        // A file in each, or the sweep has nothing to judge and asks nothing.
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, "probe.bin"), "x");
        const rule = UPLOAD_DIR_POLICIES[dir].sweep;
        if (rule.kind !== "rows") continue;
        spies.push(
          jest.spyOn(rule, "referenced").mockImplementation(async () => {
            asked.push(dir);
            return ["probe.bin"];
          })
        );
      }
      await sweepOrphanUploads({ root });
      expect(asked.sort()).toEqual(
        BACKED_UP_UPLOAD_DIRS.filter((d) => UPLOAD_DIR_POLICIES[d].sweep.kind === "rows").sort()
      );
    });
  });
});
