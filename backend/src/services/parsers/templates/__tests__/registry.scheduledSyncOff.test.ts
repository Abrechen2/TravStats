import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../../../../db";
import { TemplateRegistry } from "../registry";

/** forgejo#392: the admin's update/templates switch stops the scheduled template sync. */
describe("template registry scheduled sync honours the admin's off switch", () => {
  let tmp: string;
  let rowId: number;
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-off-"));
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = row ? row.id : (await prisma.adminSettings.create({ data: {} })).id;
  });
  afterAll(async () => {
    await prisma.adminSettings.update({ where: { id: rowId }, data: { updateCheckEnabled: true } });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const run = async (enabled: boolean): Promise<string[]> => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { updateCheckEnabled: enabled },
    });
    const calls: string[] = [];
    const registry = new TemplateRegistry({
      baseUrl: "https://templates.example.test",
      cacheDir: tmp,
      snapshotDir: path.join(tmp, "snap"),
      fetchJson: (url: string) => {
        calls.push(url);
        return Promise.reject(new Error("HTTP 404"));
      },
    });
    await (registry as unknown as { scheduledSync: () => Promise<void> }).scheduledSync();
    return calls;
  };

  it("makes no request while update checks are switched off, and syncs again when on", async () => {
    expect(await run(false)).toEqual([]);
    expect((await run(true)).length).toBeGreaterThan(0);
  });
});
