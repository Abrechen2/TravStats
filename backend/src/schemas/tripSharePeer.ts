/**
 * The trip-share wire contract (spec 2026-10-20 §4), served at `POST /api/v1/trip-share-peer`.
 * A protocol of its own beside the comparison protocol: its own route, its own schemas, the
 * shared crypto only. Nothing here imports the comparison contract, and
 * `services/sharing/federation/__tests__/separation.test.ts` fails if anything ever does.
 *
 * Phase built: F-S4a (`ping`). Messages are strict objects discriminated on `kind`; every one
 * carries a `messageId` and a `sentAt` instant (ADR 0002: a `Z` instant, never an offset-less
 * datetime). `groupRef` and `seq` arrive with the group messages of F-S4c.
 */
import { z } from "./zod";

/** The envelope purpose this protocol signs and accepts (envelope version 2). */
export const TRIP_SHARE_PURPOSE = "trip-share/1" as const;
/** Trip-share protocol versions this server serves; the ping answers with them. */
export const TRIP_SHARE_VERSIONS = [1] as const;

const uuid = z.string().uuid();
/** A UTC instant with `Z`; an offset-less or offset datetime is refused (ADR 0002 D3). */
const instant = z.iso.datetime();
const header = { messageId: uuid, sentAt: instant };

export const tripPingSchema = z.strictObject({ kind: z.literal("ping"), ...header });

export const tripSharePacket = z.discriminatedUnion("kind", [tripPingSchema]);
export type TripSharePacket = z.infer<typeof tripSharePacket>;

/** Not strict: a newer server may say more, and only `tripShare` is read. */
export const tripPingReplySchema = z.object({
  tripShare: z.array(z.number().int().positive()).max(8),
});

export type TripPing = z.infer<typeof tripPingSchema>;
