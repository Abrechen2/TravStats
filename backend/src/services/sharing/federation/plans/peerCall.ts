/**
 * One plan message to the other server and its parsed answer. A transport failure (the other
 * server is down, switched off, not admitted, or answers something unusable) is a
 * `PlanPeerUnreachable`; a failure of this server's own code or database is passed on as itself.
 */
import { exchange, type PeerTransport } from "../../../federation/security";
import { planReplySchema, type PlanPacket, type PlanReply } from "../../../../schemas/tripSharePlans";
import { LOCAL_ERROR, kindOf } from "../peerCheck";
import { PLAN_TRANSPORT } from "../transport";

export class PlanPeerUnreachable extends Error {
  constructor(
    readonly origin: string,
    readonly kind: string
  ) {
    super(`The server ${origin} does not answer (${kind})`);
  }
}

export async function callPeer(
  origin: string,
  body: PlanPacket,
  transport: PeerTransport = PLAN_TRANSPORT
): Promise<PlanReply> {
  try {
    return planReplySchema.parse(await exchange(origin, body, transport));
  } catch (error) {
    const kind = kindOf(error);
    if (kind === LOCAL_ERROR) throw error;
    throw new PlanPeerUnreachable(origin, kind);
  }
}
