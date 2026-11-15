import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const spawnMock = jest.fn();
jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const nonSuperuserMock = jest.fn();
jest.mock("../dbRole", () => ({
  ...jest.requireActual("../dbRole"),
  isNonSuperuserRole: (...args: unknown[]) => nonSuperuserMock(...args),
}));

import { createDatabaseDump } from "../backupDatabase";

function fakeChild(output: string, code: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn();
  setImmediate(() => {
    child.stdout.end(output);
    setTimeout(() => child.emit("close", code), 20);
  });
  return child;
}

describe("createDatabaseDump", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dumpargs-"));
  beforeEach(() => nonSuperuserMock.mockResolvedValue(false));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("passes --clean --if-exists exactly once (the Windows docker copy repeated them)", async () => {
    spawnMock.mockReturnValueOnce(fakeChild("-- dump", 0));
    await createDatabaseDump(path.join(dir, "ok.sql"), "postgresql://u:p@localhost:5432/db");
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.filter((a) => a === "--clean")).toHaveLength(1);
    expect(args.filter((a) => a === "--if-exists")).toHaveLength(1);
  });

  it("removes the partial file and reports stderr when the dump fails", async () => {
    const out = path.join(dir, "fail.sql");
    spawnMock.mockReturnValueOnce(fakeChild("partial", 1));
    await expect(createDatabaseDump(out, "postgresql://u:p@localhost:5432/db")).rejects.toThrow(
      /pg_dump exited with code 1/
    );
    expect(fs.existsSync(out)).toBe(false);
  });

  it("skips the tiger/topology schemas an ordinary role cannot read, and only then (N5)", async () => {
    nonSuperuserMock.mockResolvedValueOnce(true);
    spawnMock.mockReturnValueOnce(fakeChild("-- dump", 0));
    await createDatabaseDump(path.join(dir, "n.sql"), "postgresql://u:p@localhost:5432/db");
    const args = (spawnMock.mock.calls.at(-1)?.[1] ?? []) as string[];
    expect(args.join(" ")).toContain("-N tiger -N tiger_data -N topology");

    spawnMock.mockReturnValueOnce(fakeChild("-- dump", 0));
    await createDatabaseDump(path.join(dir, "s.sql"), "postgresql://u:p@localhost:5432/db");
    const superArgs = (spawnMock.mock.calls.at(-1)?.[1] ?? []) as string[];
    expect(superArgs).not.toContain("-N");
  });
});
