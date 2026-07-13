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

/**
 * Extracts the tag from a full image reference, e.g.
 * "ghcr.io/abrechen2/travstats:2.4.0-rc.4" -> "2.4.0-rc.4".
 *
 * Returns null when no tag is present, which covers three distinct shapes
 * that must NOT be mistaken for a tag:
 * - a digest-pinned reference ("img@sha256:...") — the digest is not a version
 * - a bare reference with no tag or digest at all ("img")
 * - a registry-with-port reference with no tag ("registry:5000/img") — the
 *   port number must not be misread as a tag
 */
function toTag(imageRef: string): string | null {
  const withoutDigest = imageRef.trim().split("@")[0];
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  // A colon only separates a tag when it appears after the final path
  // segment — otherwise it is a registry port (e.g. "registry:5000/img").
  if (lastColon === -1 || lastColon < lastSlash) return null;
  const tag = withoutDigest.slice(lastColon + 1);
  return tag.length > 0 ? tag : null;
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
    return tag !== null
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
