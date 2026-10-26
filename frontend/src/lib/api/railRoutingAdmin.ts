import { api } from "./client";
import { waitForJob } from "./jobs";

/** What the instance-wide tram / U-Bahn re-route did (job `rail.rerouteLocalTransit`). */
export interface LocalTransitRerouteResult {
  total: number;
  routed: number;
  straight: number;
  kept: number;
  skipped: number;
  stoppedBy: "railRoutingUnavailable" | null;
  remaining: number;
}

/**
 * Route every tram and U-Bahn ride of the instance again — the repair for
 * lines drawn as trains before 2026-10-26 (docs/features/rail-routing.md).
 * Admin only; runs as a background job and resolves with its tally.
 */
export async function rerouteLocalTransit(
  onProgress?: (progress: { done: number; total: number } | null) => void
): Promise<LocalTransitRerouteResult> {
  const { data } = await api.post<{ jobId: string }>(
    "/admin/instance-settings/rail-routing/reroute-local-transit"
  );
  return waitForJob<LocalTransitRerouteResult>(data.jobId, {
    onPoll: (job) => onProgress?.(job.progress),
  });
}
