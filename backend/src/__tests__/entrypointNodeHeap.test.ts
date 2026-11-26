import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Perf audit 2026-11, item 2 — the Node heap sized from the container's memory.
 *
 * Measured on prod: V8 chose a 4144 MB heap inside a 2 GiB box, so memory
 * growth ended in swap on Ceph instead of a GC. The `node-heap` block is cut
 * out of docker-entrypoint.sh by its markers and run under /bin/sh with a fake
 * cgroup tree and meminfo, so this tests the script that ships.
 */

const ENTRYPOINT = path.join(__dirname, "../../../docker-entrypoint.sh");

function block(name: string): string {
  const script = fs.readFileSync(ENTRYPOINT, "utf-8");
  const start = script.indexOf(`# >>> ${name}`);
  const end = script.indexOf(`# <<< ${name}`);
  if (start < 0 || end < start) throw new Error(`marker block ${name} not found`);
  return script.slice(start, end);
}

interface Fake {
  v2?: string;
  v1?: string;
  memTotalMb?: number;
  env?: Record<string, string>;
}

function runHeap(fake: Fake): { options: string; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entrypoint-heap-"));
  const cgroup = path.join(dir, "cgroup");
  fs.mkdirSync(path.join(cgroup, "memory"), { recursive: true });
  if (fake.v2 !== undefined) fs.writeFileSync(path.join(cgroup, "memory.max"), `${fake.v2}\n`);
  if (fake.v1 !== undefined) {
    fs.writeFileSync(path.join(cgroup, "memory", "memory.limit_in_bytes"), `${fake.v1}\n`);
  }
  const meminfo = path.join(dir, "meminfo");
  if (fake.memTotalMb !== undefined) {
    fs.writeFileSync(meminfo, `MemTotal:       ${fake.memTotalMb * 1024} kB\nMemFree: 1 kB\n`);
  }
  const script = `set -e\n${block("node-heap")}\necho "OPTS=\${NODE_OPTIONS:-}"\n`;
  const run = spawnSync("/bin/sh", ["-c", script], {
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH ?? "",
      CGROUP_ROOT: cgroup,
      MEMINFO_FILE: meminfo,
      ...(fake.env ?? {}),
    },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (run.status !== 0) throw new Error(`heap block failed: ${run.stderr}`);
  const options = /OPTS=(.*)/.exec(run.stdout)?.[1] ?? "";
  return { options, output: run.stdout };
}

const MB = 1024 * 1024;

describe("the entrypoint's Node heap sizing", () => {
  it("takes 55 % of a cgroup v2 limit (2 GiB -> 1126 MB) and logs why", () => {
    const run = runHeap({ v2: String(2048 * MB), memTotalMb: 65536 });
    expect(run.options).toBe("--max-old-space-size=1126");
    expect(run.output).toContain("Node heap: 1126 MB (cgroup limit 2048 MB)");
  });

  it("falls back to cgroup v1 when there is no memory.max", () => {
    const run = runHeap({ v1: String(4096 * MB), memTotalMb: 65536 });
    expect(run.options).toBe("--max-old-space-size=2252");
  });

  it("uses half of MemTotal when the cgroup says max (4 GiB LXC -> 1126 MB)", () => {
    const run = runHeap({ v2: "max", memTotalMb: 4096 });
    expect(run.options).toBe("--max-old-space-size=1126");
    expect(run.output).toContain("no cgroup limit");
  });

  it("treats a v1 'unlimited' near 2^63 as no limit", () => {
    const run = runHeap({ v1: "9223372036854771712", memTotalMb: 4096 });
    expect(run.options).toBe("--max-old-space-size=1126");
  });

  it("caps the heap at 4096 MB on a 64 GB host without limits", () => {
    expect(runHeap({ v2: "max", memTotalMb: 65536 }).options).toBe("--max-old-space-size=4096");
  });

  it("never goes below 512 MB on a tiny limit", () => {
    expect(runHeap({ v2: String(512 * MB), memTotalMb: 65536 }).options).toBe(
      "--max-old-space-size=512"
    );
  });

  it("lets NODE_MAX_OLD_SPACE_MB override everything, after other NODE_OPTIONS", () => {
    const run = runHeap({
      v2: String(2048 * MB),
      memTotalMb: 4096,
      env: { NODE_MAX_OLD_SPACE_MB: "3000", NODE_OPTIONS: "--enable-source-maps" },
    });
    expect(run.options).toBe("--enable-source-maps --max-old-space-size=3000");
  });

  it("keeps an operator's own --max-old-space-size in NODE_OPTIONS", () => {
    const run = runHeap({
      v2: String(2048 * MB),
      memTotalMb: 4096,
      env: { NODE_OPTIONS: "--max-old-space-size=700" },
    });
    expect(run.options).toBe("--max-old-space-size=700");
  });

  it("ignores a non-numeric override with a warning", () => {
    const run = runHeap({ v2: "max", memTotalMb: 4096, env: { NODE_MAX_OLD_SPACE_MB: "1g" } });
    expect(run.options).toBe("--max-old-space-size=1126");
    expect(run.output).toContain("not a number");
  });

  it("keeps the V8 default when nothing is readable", () => {
    const run = runHeap({});
    expect(run.options).toBe("");
    expect(run.output).toContain("V8 default kept");
  });
});
