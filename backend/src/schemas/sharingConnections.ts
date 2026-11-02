import { z } from "./zod";
import { origin as peerOrigin } from "../services/federation/envelope";
import { connectionSwitchesSchema } from "./tripSharePeer";

/**
 * User connections across servers (spec 2026-11-02 §5): bodies and the connection the endpoints
 * answer with. `switches` is directional — what the caller gives; `theirs` is what the other side
 * announced (for a request still waiting, what the asker chose).
 */
export { connectionSwitchesSchema };

export const connectionRequestBodySchema = z.strictObject({
  origin: peerOrigin.describe("A connected (admitted) server"),
  username: z.string().trim().min(1).max(80),
  switches: connectionSwitchesSchema,
});
export const connectionAcceptBodySchema = z.strictObject({ switches: connectionSwitchesSchema });
export const connectionSwitchesBodySchema = connectionAcceptBodySchema;
export const connectionIdSchema = z.string().uuid();

export const CONNECTION_STATE_VALUES = [
  "pending_out",
  "pending_in",
  "active",
  "declined",
  "revoked",
  "reconfirm",
] as const;

const instant = z.iso.datetime();

export const connectionSchema = z.strictObject({
  id: z.string().uuid(),
  origin: z.string().describe("The server this person's account is on"),
  username: z.string(),
  displayName: z.string(),
  state: z
    .enum(CONNECTION_STATE_VALUES)
    .describe(
      "`pending_out`: asked, waiting; `pending_in`: asked the caller; `active`; `declined`; `revoked`; `reconfirm`: paired before connections existed — keeps its trips, shares nothing new until both confirm"
    ),
  mine: connectionSwitchesSchema.describe("What the caller gives this person"),
  theirs: connectionSwitchesSchema.describe(
    "What the other side announced it gives the caller (for `pending_in`, the asker's choice)"
  ),
  requestedAt: instant.nullable(),
  confirmedAt: instant.nullable(),
  revokedAt: instant.nullable().describe("When it was declined or ended"),
});
