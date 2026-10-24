import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemoWrites } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import {
  PACKING_MAX_ITEMS,
  putPackingListSchema,
  type PackingItem,
} from "../../schemas/companionData";
import { resolveTrip } from "./resolveTrip";

/**
 * A trip's packing list — `GET`/`PUT /api/v1/trips/:id/packing` (Companion
 * audit 2026-10-23). It lived on the phone only (Companion decision D12)
 * until the owner's rule of 2026-10-20: the server knows everything, the app
 * is a companion. The Companion edits offline and sends the whole list.
 *
 * Two devices never overwrite each other unseen: a write names the `rev` it
 * started from, and a list that moved on since answers 409
 * `PACKING_LIST_STALE` with the stored `rev`; the client reads the list again,
 * replays its own unsent edits on it and sends once more. A resend whose first
 * answer was lost carries the same `mutationId` and is answered from the row,
 * not refused as stale.
 *
 * Private to its owner; nothing that shares a trip selects this table. Bare
 * responses, like every trip router (ADR 0001).
 */

const router = Router();
router.use("/trips/:id/packing", authenticate, requireWriteScope, rejectDemoWrites);

interface PackingListPayload {
  items: PackingItem[];
  rev: number;
  updatedAt: string | null;
  /** Only on a PUT: true when this write had already been applied. */
  replayed?: boolean;
}

type StoredList = { items: Prisma.JsonValue; rev: number; updatedAt: Date };

const toPayload = (row: StoredList | null): PackingListPayload => ({
  items: row ? (row.items as unknown as PackingItem[]) : [],
  rev: row?.rev ?? 0,
  updatedAt: row ? row.updatedAt.toISOString() : null,
});

const SELECT = { items: true, rev: true, updatedAt: true, lastMutationId: true } as const;

function stale(rev: number): AppError {
  return new AppError(
    "The packing list changed since it was read",
    409,
    "PACKING_LIST_STALE",
    undefined,
    {
      rev,
    }
  );
}

router.get("/trips/:id/packing", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const trip = await resolveTrip(req.userId!, req.params.id);
    const row = await prisma.tripPackingList.findUnique({
      where: { tripId: trip.id },
      select: SELECT,
    });
    res.json(toPayload(row));
  } catch (error) {
    next(error);
  }
});

router.put("/trips/:id/packing", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = putPackingListSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid packing list",
        400,
        "PACKING_LIST_INVALID"
      );
    }
    const userId = req.userId!;
    const trip = await resolveTrip(userId, req.params.id);
    const { items, baseRev, mutationId } = parsed.data;
    const json = items as unknown as Prisma.InputJsonValue;

    const current = await prisma.tripPackingList.findUnique({
      where: { tripId: trip.id },
      select: SELECT,
    });
    if (current?.lastMutationId === mutationId) {
      res.json({ ...toPayload(current), replayed: true });
      return;
    }
    // Over the adding limit only while it does not grow: a merged list may be long.
    const storedCount = Array.isArray(current?.items) ? current.items.length : 0;
    if (items.length > PACKING_MAX_ITEMS && items.length > storedCount) {
      throw new AppError(`At most ${PACKING_MAX_ITEMS} items`, 400, "PACKING_LIST_INVALID");
    }

    if (baseRev === 0) {
      if (current) throw stale(current.rev);
      try {
        const created = await prisma.tripPackingList.create({
          data: { userId, tripId: trip.id, items: json, rev: 1, lastMutationId: mutationId },
          select: SELECT,
        });
        res.json(toPayload(created));
      } catch (error) {
        // Another device created the list a moment earlier.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const winner = await prisma.tripPackingList.findUnique({
            where: { tripId: trip.id },
            select: { rev: true },
          });
          throw stale(winner?.rev ?? 1);
        }
        throw error;
      }
      return;
    }

    // Compare and replace in one statement: the row is written only while it
    // still has the rev the client saw.
    const { count } = await prisma.tripPackingList.updateMany({
      where: { tripId: trip.id, rev: baseRev },
      data: { items: json, rev: { increment: 1 }, lastMutationId: mutationId },
    });
    const after = await prisma.tripPackingList.findUnique({
      where: { tripId: trip.id },
      select: SELECT,
    });
    if (count === 0) {
      if (after?.lastMutationId === mutationId) {
        res.json({ ...toPayload(after), replayed: true });
        return;
      }
      throw stale(after?.rev ?? 0);
    }
    res.json(toPayload(after));
  } catch (error) {
    next(error);
  }
});

export default router;
