/**
 * The gate an outbound call passes before it leaves the server (forgejo#392).
 *
 * A call is blocked when the master internet switch is off, or when the admin
 * switched the service off in the catalogue policy. The answer names which, so
 * the caller can report it as itself instead of as "nothing found".
 */
import { internetAllowed } from "../internetGate";
import { isServiceDisabledByAdmin } from "./policy";

export type EgressBlock = "internet_off" | "service_off";

export async function egressBlock(serviceId: string): Promise<EgressBlock | null> {
  if (!(await internetAllowed())) return "internet_off";
  if (await isServiceDisabledByAdmin(serviceId)) return "service_off";
  return null;
}

/** Thrown by a caller that cannot answer without going out and was not allowed to. */
export class EgressBlockedError extends Error {
  constructor(
    readonly serviceId: string,
    readonly block: EgressBlock
  ) {
    super(`Outbound access to "${serviceId}" is blocked (${block})`);
    this.name = "EgressBlockedError";
  }
}

export async function assertEgressAllowed(serviceId: string): Promise<void> {
  const block = await egressBlock(serviceId);
  if (block) throw new EgressBlockedError(serviceId, block);
}
