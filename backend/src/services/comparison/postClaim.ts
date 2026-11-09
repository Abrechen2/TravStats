/**
 * What happens after a claim that came with connection switches (spec 2026-11-08 §11.8). The
 * comparison side must not import trip sharing (`separation.test.ts`), so the friends module
 * registers the step here when the friends router loads.
 */
import type { ConnectionSwitches } from "../../schemas/connectionSwitches";

export type PostClaim = (
  userId: string,
  leaderboardRemoteId: string,
  switches: ConnectionSwitches
) => Promise<unknown>;

let hook: PostClaim | null = null;
export const registerPostClaim = (fn: PostClaim): void => {
  hook = fn;
};
export const runPostClaim: PostClaim = async (userId, id, switches) => hook?.(userId, id, switches);
