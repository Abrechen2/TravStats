import { describe, expect, it } from "vitest";
import { collectDeployments } from "../src/collectors/deployments.js";
import type { Runner } from "../src/collectors/run.js";
import type { InstanceDef } from "../src/types.js";

const INSTANCES: InstanceDef[] = [
  {
    id: "prod",
    label: "Prod",
    role: "production",
    node: "10.0.0.1",
    ct: 100,
    container: "TravStats",
  },
  { id: "rc", label: "RC", role: "rc", node: "10.0.0.1", ct: 107, container: "travstats-rc" },
];

const SINGLE_INSTANCE: InstanceDef[] = [
  {
    id: "prod",
    label: "Prod",
    role: "production",
    node: "10.0.0.1",
    ct: 100,
    container: "TravStats",
  },
];

/** Runs collectDeployments against a single instance whose `docker inspect` output is fixed. */
async function probeSingle(rawImageRef: string) {
  const run: Runner = async () => rawImageRef;
  const result = await collectDeployments(SINGLE_INSTANCE, run);
  if (!result.ok) throw new Error(result.reason);
  const [instance] = result.data.running;
  return instance;
}

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

  describe("tag parsing", () => {
    it("parses a plain registry reference with a tag", async () => {
      const instance = await probeSingle("ghcr.io/abrechen2/travstats:2.4.0-rc.4\n");
      expect(instance.image).toBe("2.4.0-rc.4");
      expect(instance.error).toBeNull();
    });

    it("does NOT mistake a digest for a version tag", async () => {
      const instance = await probeSingle(
        "ghcr.io/abrechen2/travstats@sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n"
      );
      expect(instance.image).toBeNull();
      expect(instance.error).toBe("container not found");
    });

    it("extracts the tag from a registry reference that also has a port", async () => {
      const instance = await probeSingle("registry:5000/img:1.2.3\n");
      expect(instance.image).toBe("1.2.3");
      expect(instance.error).toBeNull();
    });

    it("does NOT mistake a registry port for a tag when no tag is present", async () => {
      const instance = await probeSingle("registry:5000/img\n");
      expect(instance.image).toBeNull();
      expect(instance.error).toBe("container not found");
    });

    it("reports no tag for a bare reference with neither tag nor digest", async () => {
      const instance = await probeSingle("ghcr.io/abrechen2/travstats\n");
      expect(instance.image).toBeNull();
      expect(instance.error).toBe("container not found");
    });

    it("reports no tag for an empty docker inspect output", async () => {
      const instance = await probeSingle("");
      expect(instance.image).toBeNull();
      expect(instance.error).toBe("container not found");
    });
  });
});
