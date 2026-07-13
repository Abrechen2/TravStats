import type { CollectorResult, InstanceDef } from "../types.js";
import type { Runner } from "./run.js";

export interface RunningInstance {
  readonly id: string;
  /** The image TAG (e.g. "2.4.0-rc.4"), not the full reference. Null when unreachable. */
  readonly image: string | null;
  readonly error: string | null;
}

export interface DeploymentState {
  readonly running: readonly RunningInstance[];
}

/** "ghcr.io/abrechen2/travstats:2.4.0-rc.4" -> "2.4.0-rc.4" */
function toTag(imageRef: string): string {
  const trimmed = imageRef.trim();
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(colon + 1);
}

async function probe(instance: InstanceDef, run: Runner): Promise<RunningInstance> {
  try {
    const raw = await run("ssh", [
      "-o",
      "ConnectTimeout=8",
      "-o",
      "BatchMode=yes",
      `root@${instance.node}`,
      `pct exec ${instance.ct} -- docker inspect --format '{{.Config.Image}}' ${instance.container}`,
    ]);
    const tag = toTag(raw);
    return tag.length > 0
      ? { id: instance.id, image: tag, error: null }
      : { id: instance.id, image: null, error: "container not found" };
  } catch (error) {
    return {
      id: instance.id,
      image: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Probes every instance in parallel. A single dead host produces a marked tile,
 * never a missing section — an unreachable RC server must not hide prod.
 */
export async function collectDeployments(
  instances: readonly InstanceDef[],
  run: Runner
): Promise<CollectorResult<DeploymentState>> {
  const running = await Promise.all(instances.map((instance) => probe(instance, run)));
  return { ok: true, data: { running } };
}
