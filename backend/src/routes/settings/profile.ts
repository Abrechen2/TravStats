import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { dayFieldSchema } from "../../shared/time/timeInput";
import { toDbDate } from "../../shared/time/localDate";
import { remoteFindableSchema } from "../../schemas/sharingRemote";
import { getFindable, setFindable } from "../../services/sharing/federation/remoteStats";

const router = Router();

// Minimal user-level profile fields that aren't in UserSettings JSON.
// Currently just birthdate — used by the BIRTHDAY_FLIGHT achievement to
// match a flight's departure month+day against the user.
const profileSchema = z.object({
  // `YYYY-MM-DD`, or an ISO string with an offset (read as the day it
  // writes); null clears the field. An offset-less datetime is refused with
  // TIME_SHAPE_REQUIRED — the host would have decided which day it was.
  birthdate: dayFieldSchema().nullable().optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { birthdate: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      birthdate: user.birthdate ? user.birthdate.toISOString().slice(0, 10) : null,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const data = profileSchema.parse(req.body);

    // A birthday is a FLOATING day (ADR 0002 D1): the same date everywhere,
    // no zone. `birthDay` holds it as a DATE; the legacy `birthdate` keeps
    // its noon-UTC shape, which kept month+day comparisons stable whatever
    // zone the server ran in, until phase 6 drops it.
    const updateData: {
      birthdate?: Date | null;
      birthDay?: Date | null;
      birthPrecision?: string | null;
    } = {};
    if (data.birthdate === null) {
      Object.assign(updateData, { birthdate: null, birthDay: null, birthPrecision: null });
    } else if (typeof data.birthdate === "string") {
      Object.assign(updateData, {
        birthdate: new Date(`${data.birthdate}T12:00:00.000Z`),
        birthDay: toDbDate(data.birthdate),
        birthPrecision: "day",
      });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { birthdate: true },
    });

    res.json({
      birthdate: user.birthdate ? user.birthdate.toISOString().slice(0, 10) : null,
    });
  } catch (error) {
    next(error);
  }
});

// "Für andere Server auffindbar" (settings v3 `findable`). The same switch as
// `/sharing/remote/findable`, answered bare like the rest of this family, so the
// settings page reads one route family. Writing it needs federation to be on
// (404 `SHARE_REMOTE_DISABLED` otherwise — the row is greyed out then).
router.get("/findable", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ findable: await getFindable(req.userId!) });
  } catch (error) {
    next(error);
  }
});

router.put("/findable", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { findable } = remoteFindableSchema.parse(req.body ?? {});
    res.json({ findable: await setFindable(req.userId!, findable) });
  } catch (error) {
    next(error);
  }
});

export default router;
