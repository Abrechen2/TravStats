import type { Identity } from "../../federation/identity";
import { tripFederationAvailability } from "./availability";
import { remoteShareError } from "./errors";

/** This server's identity while trip sharing across servers is on, else `SHARE_REMOTE_DISABLED`. */
export async function requireTripFederation(userId: string): Promise<Identity> {
  const state = await tripFederationAvailability();
  if (!state.available)
    throw remoteShareError(
      "SHARE_REMOTE_DISABLED",
      404,
      "Trip sharing across servers is switched off on this server",
      { userId, kind: state.reason }
    );
  return state.identity;
}
