import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { resolveCountryCode } from "../shared/geo/countryCode";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { classifyVisit } from "../shared/placeCounting";
import {
  createPlaceSchema,
  updatePlaceSchema,
  createVisitSchema,
  updateVisitSchema,
  placeQuerySchema,
} from "../schemas/place";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST/PATCH/DELETE — consistent with routes/cruises.ts and lodging.ts.
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

export const PLACE_INCLUDE = { visits: true } satisfies Prisma.PlaceInclude;
export type PlaceRow = Prisma.PlaceGetPayload<{ include: typeof PLACE_INCLUDE }>;

/**
 * The DETAIL view additionally carries each visit's photo proof. Deliberately
 * not folded into `PLACE_INCLUDE`: the list endpoint uses that for every row,
 * and a gallery per row is a page of joins nobody asked for.
 */
const PLACE_DETAIL_INCLUDE = {
  visits: { include: { photos: { orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }] } } },
} satisfies Prisma.PlaceInclude;

interface PlaceAggregates {
  /** Visits that actually happened — future-dated ones excluded. */
  visitCount: number;
  /** Total rows, including planned ones. The list shows both, separately. */
  plannedVisitCount: number;
  /** Most recent COMPLETED visit; null when undated or never visited. */
  lastVisitAt: Date | null;
}

function computeAggregates(visits: PlaceRow["visits"], now = new Date()): PlaceAggregates {
  let visitCount = 0;
  let plannedVisitCount = 0;
  let lastVisitAt: Date | null = null;

  for (const v of visits) {
    if (classifyVisit(v, now) === "planned") {
      plannedVisitCount += 1;
      continue;
    }
    visitCount += 1;
    if (v.visitedAt && (lastVisitAt === null || v.visitedAt > lastVisitAt)) {
      lastVisitAt = v.visitedAt;
    }
  }
  return { visitCount, plannedVisitCount, lastVisitAt };
}

type DecoratedPlace = PlaceRow & PlaceAggregates;

/**
 * Generic over the include shape so the detail view keeps its photos in the
 * TYPE and not only at runtime — a spread that silently widens the payload
 * while the signature claims otherwise is how a field ends up undocumented.
 */
function decorate<T extends { visits: PlaceRow["visits"] }>(
  place: T,
  now = new Date()
): T & PlaceAggregates {
  return { ...place, ...computeAggregates(place.visits, now) };
}

/**
 * Sorting happens in memory for the two DERIVED keys (`visitCount`,
 * `lastVisit`) because neither is a column — they fall out of the visit rows
 * after the future-date rule has been applied, and pushing that into SQL would
 * mean encoding the rule twice. Everything else sorts in the database.
 *
 * The `limit` cap (500) is what keeps this honest: it is not a page of an
 * unbounded set being silently reordered.
 */
function sortDecorated(
  places: DecoratedPlace[],
  sortBy: string,
  sortOrder: "asc" | "desc"
): DecoratedPlace[] {
  if (sortBy !== "visitCount" && sortBy !== "lastVisit") return places;
  const dir = sortOrder === "asc" ? 1 : -1;
  return [...places].sort((a, b) => {
    if (sortBy === "visitCount") return (a.visitCount - b.visitCount) * dir;
    const av = a.lastVisitAt?.getTime() ?? -Infinity;
    const bv = b.lastVisitAt?.getTime() ?? -Infinity;
    return (av - bv) * dir;
  });
}

const orderByFor = (
  sortBy: string,
  sortOrder: "asc" | "desc"
): Prisma.PlaceOrderByWithRelationInput | undefined => {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "city":
      return { city: sortOrder };
    case "category":
      return { category: sortOrder };
    case "createdAt":
      return { createdAt: sortOrder };
    default:
      // Derived keys are ordered after the fact; give the DB a stable base
      // order so the in-memory sort is deterministic for ties.
      return { name: "asc" };
  }
};

// ---------------------------------------------------------------- list

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = placeQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { q, category, country, visited, tripId, sortBy, sortOrder, limit, offset } = parsed.data;

    const where: Prisma.PlaceWhereInput = { userId };
    if (category) where.category = category;
    if (typeof visited === "boolean") where.visited = visited;
    if (country) where.isoCountryCode = country.toUpperCase();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
      ];
    }
    if (tripId) where.visits = { some: { tripId } };

    const [rows, total] = await Promise.all([
      prisma.place.findMany({
        where,
        include: PLACE_INCLUDE,
        orderBy: orderByFor(sortBy, sortOrder),
        take: limit,
        skip: offset,
      }),
      prisma.place.count({ where }),
    ]);

    const now = new Date();
    const data = sortDecorated(
      rows.map((r) => decorate(r, now)),
      sortBy,
      sortOrder
    );

    res.json({ success: true, data, meta: { total, limit, offset } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- read

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const place = await prisma.place.findFirst({
      where: { id: req.params.id, userId },
      include: PLACE_DETAIL_INCLUDE,
    });
    if (!place) throw new AppError("Place not found", 404);
    res.json({ success: true, data: decorate(place) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createPlaceSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;

    // Dedup on the geocoder reference, so picking the same restaurant out of
    // search twice yields one row rather than a second pin on top of the
    // first. Hand-entered places carry no ref and are never blocked by this.
    if (input.externalRef) {
      const existing = await prisma.place.findFirst({
        where: { userId, externalRef: input.externalRef },
        include: PLACE_INCLUDE,
      });
      if (existing) {
        res.status(200).json({ success: true, data: decorate(existing), deduped: true });
        return;
      }
    }

    const place = await prisma.place.create({
      data: {
        userId,
        name: input.name,
        category: input.category,
        lat: input.lat,
        lon: input.lon,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        isoCountryCode: resolveCountryCode(input.country ?? null),
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
        visited: input.visited,
        dataSource: "manual",
      },
      include: PLACE_INCLUDE,
    });

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after place create");
    });

    res.status(201).json({ success: true, data: decorate(place) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.place.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Place not found", 404);

    const parsed = updatePlaceSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;

    const data: Prisma.PlaceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.category !== undefined) data.category = input.category;
    if (input.lat !== undefined) data.lat = input.lat;
    if (input.lon !== undefined) data.lon = input.lon;
    if (input.address !== undefined) data.address = input.address;
    if (input.city !== undefined) data.city = input.city;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.visited !== undefined) data.visited = input.visited;
    if (input.externalRef !== undefined) data.externalRef = input.externalRef;
    // The derived code moves with the text it was derived from, always in the
    // same statement — the two must never disagree.
    if (input.country !== undefined) {
      data.country = input.country;
      data.isoCountryCode = resolveCountryCode(input.country);
    }

    const place = await prisma.place.update({
      where: { id: existing.id },
      data,
      include: PLACE_INCLUDE,
    });

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after place update");
    });

    res.json({ success: true, data: decorate(place) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- delete

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.place.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Place not found", 404);

    // Visits cascade at the DB level; deleting the place deletes its history,
    // which is what "delete this place" means.
    await prisma.place.delete({ where: { id: existing.id } });

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after place delete");
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- visits

/** Ownership of the trip is checked separately — a visit must never be able to
 *  attach itself to someone else's trip by id. */
async function assertTripOwned(tripId: string | null | undefined, userId: string): Promise<void> {
  if (!tripId) return;
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404);
}

router.post("/:id/visits", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const place = await prisma.place.findFirst({ where: { id: req.params.id, userId } });
    if (!place) throw new AppError("Place not found", 404);

    const parsed = createVisitSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;
    await assertTripOwned(input.tripId, userId);

    // Recording a visit that HAPPENED is the statement "I was here", so it
    // promotes the place out of the wishlist in the SAME transaction. Leaving
    // `visited` untouched there is the silent-wrong-count bug the default
    // guards against: invisible until a headline number is wrong.
    //
    // A FUTURE-dated visit is the opposite statement — "I will be here" — and
    // must not promote anything. Flipping the flag for it made the place read
    // "Besucht" the moment a plan was entered, which is how a place you have
    // never been to ends up in the visited count. The rule comes from
    // `classifyVisit`, the same one that already keeps future visits out of
    // every total, so the flag and the figures cannot disagree.
    //
    // One-directional on purpose: nothing here ever sets `visited` back to
    // false. A place may legitimately be visited with no visit rows at all
    // ("I have been to that Maccis, no idea when"), and recomputing the flag
    // from the visits would erase exactly that.
    const visitedAt = input.visitedAt ? new Date(input.visitedAt) : null;
    const happened = classifyVisit({ visitedAt }) === "visited";

    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.placeVisit.create({
        data: {
          placeId: place.id,
          userId,
          tripId: input.tripId ?? null,
          visitedAt,
          orderIdx: input.orderIdx ?? 0,
          notes: input.notes ?? null,
          rating: input.rating ?? null,
        },
      }),
    ];
    if (happened && !place.visited) {
      writes.push(prisma.place.update({ where: { id: place.id }, data: { visited: true } }));
    }
    const [visit] = await prisma.$transaction(writes);

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after visit create");
    });

    res.status(201).json({ success: true, data: visit });
  } catch (error) {
    next(error);
  }
});

router.patch("/visits/:visitId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.placeVisit.findFirst({
      where: { id: req.params.visitId, userId },
    });
    if (!existing) throw new AppError("Visit not found", 404);

    const parsed = updateVisitSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;
    if (input.tripId !== undefined) await assertTripOwned(input.tripId, userId);

    const data: Prisma.PlaceVisitUpdateInput = {};
    if (input.visitedAt !== undefined) {
      data.visitedAt = input.visitedAt ? new Date(input.visitedAt) : null;
    }
    if (input.orderIdx !== undefined) data.orderIdx = input.orderIdx;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.rating !== undefined) data.rating = input.rating;
    if (input.tripId !== undefined) {
      data.trip = input.tripId ? { connect: { id: input.tripId } } : { disconnect: true };
    }

    const visit = await prisma.placeVisit.update({ where: { id: existing.id }, data });

    // Moving a planned visit into the past is the same statement as recording
    // one, so it promotes the place too. The reverse does NOT demote it — see
    // the create handler for why the flag is one-directional.
    if (classifyVisit({ visitedAt: visit.visitedAt }) === "visited") {
      await prisma.place.updateMany({
        where: { id: visit.placeId, userId, visited: false },
        data: { visited: true },
      });
    }

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after visit update");
    });

    res.json({ success: true, data: visit });
  } catch (error) {
    next(error);
  }
});

router.delete("/visits/:visitId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.placeVisit.findFirst({
      where: { id: req.params.visitId, userId },
    });
    if (!existing) throw new AppError("Visit not found", 404);

    // Deleting the last visit does NOT reset `visited`. The two are separate
    // questions (shared/placeCounting.ts): removing a wrong date is not the
    // same statement as "I was never here", and the user can say the latter
    // explicitly on the place itself.
    await prisma.placeVisit.delete({ where: { id: existing.id } });

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after visit delete");
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
