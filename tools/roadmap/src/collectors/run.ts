import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Injected into every collector so tests never touch the network or the disk. */
export type Runner = (cmd: string, args: readonly string[]) => Promise<string>;

export function execRunner(timeoutMs: number): Runner {
  return async (cmd, args) => {
    const { stdout } = await execFileAsync(cmd, [...args], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  };
}
