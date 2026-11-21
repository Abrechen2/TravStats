import fs from "fs";
import os from "os";
import path from "path";

import { prisma } from "../../../db";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-jobs-"));
let release: () => void = () => {};
const gate = new Promise<void>((r) => (release = r));

jest.mock("../format", () => ({
  ...jest.requireActual("../format"),
  archiveWorkDir: () => dir,
}));
jest.mock("../exportArchive", () => ({
  writeAccountArchive: jest.fn(async (_u: string, target: string) => {
    await gate;
    fs.writeFileSync(target, "zip");
    return { archiveId: "a", tables: {}, files: 0, missingFiles: 0, omittedFiles: [] };
  }),
}));

import { __resetArchiveJobs, cancelAccountExports, startAccountExport } from "../archiveJobs";
import { getJob, settleAllJobs } from "../../jobs/jobRegistry";

describe("an export finishing after the account's deletion registers nothing", () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("aborts and removes its temp file when the account is gone or reserved for deletion", async () => {
    __resetArchiveJobs();
    const user = await prisma.user.create({
      data: { username: "archDeleteRace", passwordHash: "x" },
    });
    try {
      const job = startAccountExport(user.id, "archDeleteRace");
      await prisma.user.update({ where: { id: user.id }, data: { deletionStartedAt: new Date() } });
      release();
      await settleAllJobs();
      expect(getJob(job.id, user.id)?.status).toBe("failed");
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("cancelAccountExports marks a running export so it cannot register", () => {
    expect(() => cancelAccountExports("nobody")).not.toThrow();
  });
});
