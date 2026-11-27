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
  /** A second meminfo, as bound in from the LXC container (lxcfs). */
  hostMemTotalMb?: number;
  /** This process's cgroup v2 path, and memory.max per path below the root. */
  selfCgroup?: string;
  tree?: Record<string, string>;
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
  for (const [rel, max] of Object.entries(fake.tree ?? {})) {
    fs.mkdirSync(path.join(cgroup, rel), { recursive: true });
    fs.writeFileSync(path.join(cgroup, rel, "memory.max"), `${max}\n`);
  }
  const selfCgroup = path.join(dir, "self-cgroup");
  if (fake.selfCgroup !== undefined) fs.writeFileSync(selfCgroup, `0::${fake.selfCgroup}\n`);
  const hostMeminfo = path.join(dir, "host-meminfo");
  if (fake.hostMemTotalMb !== undefined) {
    fs.writeFileSync(hostMeminfo, `MemTotal:       ${fake.hostMemTotalMb * 1024} kB\n`);
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
      HOST_MEMINFO_FILE: hostMeminfo,
      PROC_SELF_CGROUP: selfCgroup,
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

  describe("docker inside an LXC container (prod rc.47: 4 GiB CT, host 32 GB)", () => {
    it("reads the CT's size from a bound lxcfs meminfo instead of the host's MemTotal", () => {
      // Before: memory.max "max" and MemTotal 32 GB gave the 4096 MB maximum.
      const run = runHeap({ v2: "max", memTotalMb: 31929, hostMemTotalMb: 4096 });
      expect(run.options).toBe("--max-old-space-size=1126");
    });

    it("takes the smallest memory.max on the way from its own cgroup up to the root", () => {
      const run = runHeap({
        v2: "max",
        memTotalMb: 31929,
        selfCgroup: "/lxc/100/docker/abc",
        tree: {
          "lxc/100/docker/abc": "max",
          "lxc/100/docker": "max",
          "lxc/100": String(3072 * MB),
        },
      });
      expect(run.options).toBe("--max-old-space-size=1689");
      expect(run.output).toContain("cgroup limit 3072 MB");
    });

    it("prefers a tighter limit of its own cgroup over a looser ancestor", () => {
      const run = runHeap({
        memTotalMb: 31929,
        selfCgroup: "/a/b",
        tree: { a: String(8192 * MB), "a/b": String(2048 * MB) },
      });
      expect(run.options).toBe("--max-old-space-size=1126");
    });

    it("keeps the host's MemTotal when no second meminfo is bound", () => {
      const run = runHeap({ v2: "max", memTotalMb: 31929 });
      expect(run.options).toBe("--max-old-space-size=4096");
    });
  });
});
