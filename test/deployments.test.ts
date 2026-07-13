import { describe, expect, it } from "vitest";
import { collectDeployments } from "../src/collectors/deployments.js";
import type { Runner } from "../src/collectors/run.js";
import type { InstanceDef } from "../src/types.js";

const INSTANCES: InstanceDef[] = [
  { id: "prod", label: "Prod", role: "production", node: "10.0.0.1", ct: 100, container: "TravStats" },
  { id: "rc", label: "RC", role: "rc", node: "10.0.0.1", ct: 107, container: "travstats-rc" },
];

describe("collectDeployments", () => {
  it("reports the running image tag per instance", async () => {
    const run: Runner = async (_cmd, args) =>
      args.join(" ").includes("107")
        ? "ghcr.io/abrechen2/travstats:2.4.0-rc.4\n"
        : "ghcr.io/abrechen2/travstats:2.3.1\n";

    const result = await collectDeployments(INSTANCES, run);
    if (!result.ok) throw new Error(result.reason);

    expect(result.data.running.find((r) => r.id === "prod")?.image).toBe("2.3.1");
    expect(result.data.running.find((r) => r.id === "rc")?.image).toBe("2.4.0-rc.4");
  });

  it("degrades ONE unreachable instance to an error tile, keeping the others", async () => {
    const run: Runner = async (_cmd, args) => {
      if (args.join(" ").includes("107")) throw new Error("ssh: connect timed out");
      return "ghcr.io/abrechen2/travstats:2.3.1\n";
    };

    const result = await collectDeployments(INSTANCES, run);
    if (!result.ok) throw new Error("one dead host must not fail the whole collector");

    expect(result.data.running.find((r) => r.id === "prod")?.image).toBe("2.3.1");
    const rc = result.data.running.find((r) => r.id === "rc");
    expect(rc?.image).toBeNull();
    expect(rc?.error).toContain("timed out");
  });

  it("returns an empty result when no instances are configured", async () => {
    const result = await collectDeployments([], async () => "");
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.running).toEqual([]);
  });
});
