import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { statsLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { classifyVisit } from "../../shared/placeCounting";
import { getContinent } from "../../utils/continents";
import { buildAnchors, suggestVisits } from "../../services/places/visitSuggestions";
import logger from "../../utils/logger";

/**
 * Shipped checklists — the New 7 Wonders and friends.
 *
 * Mounted on `/api/v1/place-lists` AHEAD of `routes/placeLists.ts`, because
 * `/curated` would otherwise be captured by that router's `/:id` and answered
 * with "list not found".
 *
 * ## Lazy materialisation, and what it buys
 *
 * Subscribing writes ONE row (a `PlaceList` carrying `curatedKey`), never N
 * copies of the catalog. A target becomes a real `Place` only when it is
 * ticked. That is what keeps the domain's central promise literally true —
 * every pin on the globe is a `Place` — and it is what lets a corrected
 * coordinate in a later release reach people who subscribed in an earlier one.
 * Copy-on-subscribe would freeze the catalog at subscription time and put 1200
 * places the user has never been to into their logbook the day UNESCO ships.
 *
 * The honest cost: the progress screen is the one screen in the app that
 * renders two kinds of row. A ghost row IS the unticked state, so it has to
 * look different or the checklist means nothing.
 *
 * ## Ticking also files the place in the list
 *
 * A ticked place gets a `PlaceListEntry` in the subscription as well, so a
 * checklist behaves like every other list everywhere else in the app — `list`
 * colour mode paints it, the list filter finds it, the place detail page shows
 * which lists it belongs to. Only the progress screen needs to know that
 * unticked targets exist at all.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

/** Category every curated target is filed under; they are all landmarks. */
const CURATED_CATEGORY = "landmark";

// ---------------------------------------------------------------- catalog

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);

    const [lists, subscriptions, ticked] = await Promise.all([
      prisma.curatedList.findMany({
        orderBy: [{ sortIdx: "asc" }, { name: "asc" }],
        include: { _count: { select: { items: true } } },
      }),
      prisma.placeList.findMany({
        where: { userId, curatedKey: { not: null } },
        select: { id: true, curatedKey: true, color: true },
      }),
      // Every curated place this user has ticked, in one query rather than one
      // per list — the catalog page shows progress for all lists at once.
      prisma.place.findMany({
        where: { userId, curatedItemId: { not: null }, visited: true },
        select: { curatedItemId: true },
      }),
    ]);

    const tickedByList = new Map<string, number>();
    for (const p of ticked) {
      // Ids are namespaced "listKey:slug" — the prefix is the list.
      const key = p.curatedItemId?.split(":")[0];
      if (key) tickedByList.set(key, (tickedByList.get(key) ?? 0) + 1);
    }
    const subByKey = new Map(subscriptions.map((s) => [s.curatedKey as string, s]));

    res.json({
      success: true,
      // DE primary with the EN mirror beside it. Catalog copy is user-facing
      // text that cannot go through the i18n resource files, so both sides
      // travel to the client and it picks by locale, falling back to `name`.
      data: lists.map((l) => ({
        key: l.key,
        name: l.name,
        nameEn: l.nameEn,
        description: l.description,
        descriptionEn: l.descriptionEn,
        icon: l.icon,
        itemCount: l._count.items,
        tickedCount: tickedByList.get(l.key) ?? 0,
        subscribed: subByKey.has(l.key),
        listId: subByKey.get(l.key)?.id ?? null,
        color: subByKey.get(l.key)?.color ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- subscribe

router.post("/:key/subscribe", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const curated = await prisma.curatedList.findUnique({ where: { key: req.params.key } });
    if (!curated) throw new AppError("Checklist not found", 404);

    const list = await prisma.placeList.upsert({
      where: { userId_curatedKey: { userId, curatedKey: curated.key } },
      create: {
        userId,
        curatedKey: curated.key,
        name: curated.name,
        description: curated.description,
        icon: curated.icon,
      },
      update: {},
    });

    logger.info(
      { operation: "curated_list_subscribe", userId, curatedKey: curated.key },
      "Subscribed to curated checklist"
    );
    res.status(201).json({ success: true, data: list });
  } catch (error) {
    next(error);
  }
});

router.delete("/:key/subscribe", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);

    // Unsubscribing removes the subscription and its membership rows. It does
    // NOT touch the places that were ticked: those are visits that happened,
    // with the user's own dates and photos on them. Losing a record of standing
    // in front of the Colosseum because a checklist was tidied away would be
    // indefensible — they stay in the logbook as ordinary places.
    const deleted = await prisma.placeList.deleteMany({
      where: { userId, curatedKey: req.params.key },
    });
    if (deleted.count === 0) throw new AppError("Not subscribed", 404);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- progress

router.get("/:key/progress", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const curated = await prisma.curatedList.findUnique({
      where: { key: req.params.key },
      include: { items: { orderBy: [{ sortIdx: "asc" }, { name: "asc" }] } },
    });
    if (!curated) throw new AppError("Checklist not found", 404);

    const [subscription, places] = await Promise.all([
      prisma.placeList.findUnique({
        where: { userId_curatedKey: { userId, curatedKey: curated.key } },
      }),
      prisma.place.findMany({
        where: { userId, curatedItemId: { in: curated.items.map((i) => i.id) } },
        include: { visits: { select: { id: true, visitedAt: true } } },
      }),
    ]);
    const byItem = new Map(places.map((p) => [p.curatedItemId as string, p]));

    const now = new Date();
    const items = curated.items.map((item) => {
      const place = byItem.get(item.id);
      const lastVisitAt =
        place?.visits.reduce<Date | null>((latest, v) => {
          if (!v.visitedAt || classifyVisit(v, now) !== "visited") return latest;
          return latest === null || v.visitedAt > latest ? v.visitedAt : latest;
        }, null) ?? null;

      return {
        itemId: item.id,
        name: item.name,
        nameEn: item.nameEn,
        lat: item.lat,
        lon: item.lon,
        country: item.country,
        isoCountryCode: item.isoCountryCode,
        // Resolved HERE, not in the client. The one careful implementation
        // lives on this side and knows the cases a country code alone cannot
        // answer — Istanbul's historic areas are Europe, Cappadocia is Asia,
        // and both are on this very list. Mirroring a 250-row table into the
        // bundle to get that wrong differently is not an improvement.
        continent: getContinent(item.lat, item.lon, item.isoCountryCode),
        blurb: item.blurb,
        blurbEn: item.blurbEn,
        // The two-kinds-of-row split, made explicit for the client rather than
        // left to be inferred from a null: a ghost is a catalog target, a
        // ticked item is a real place in the logbook.
        ticked: place?.visited === true,
        placeId: place?.id ?? null,
        lastVisitAt,
      };
    });

    res.json({
      success: true,
      data: {
        key: curated.key,
        name: curated.name,
        nameEn: curated.nameEn,
        description: curated.description,
        descriptionEn: curated.descriptionEn,
        icon: curated.icon,
        subscribed: subscription !== null,
        listId: subscription?.id ?? null,
        color: subscription?.color ?? null,
        itemCount: items.length,
        tickedCount: items.filter((i) => i.ticked).length,
        items,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- suggestions

/**
 * "You were probably here" for the targets still open on this checklist.
 *
 * READ-ONLY on purpose. The service proposes; the user ticks. Auto-ticking
 * would put places nobody has been to into the visited count, invisibly — see
 * the header of `services/places/visitSuggestions.ts`.
 *
 * Anchors are the user's OWN recorded travel, and only travel that happened:
 * stays that are over, port calls on sailed cruises, flown legs, logged places.
 *
 * The only rate-limited route in this router, on `statsLimiter`. It reads the
 * caller's ENTIRE history — every stay, every port call, every flight, every
 * visited place, none of it paginated — and then matches each open target
 * against every anchor. That is a stats-sized aggregation wearing a checklist
 * hat, so it gets the stats bucket. The catalog, progress and tick routes
 * around it are bounded by one list's items and stay unlimited.
 */
router.get("/:key/suggestions", statsLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const curated = await prisma.curatedList.findUnique({
      where: { key: req.params.key },
      include: { items: true },
    });
    if (!curated) throw new AppError("Checklist not found", 404);

    const [ticked, stays, stops, flights, places] = await Promise.all([
      prisma.place.findMany({
        where: { userId, curatedItemId: { in: curated.items.map((i) => i.id) } },
        select: { curatedItemId: true, visited: true },
      }),
      prisma.lodgingStay.findMany({
        where: { userId },
        select: {
          status: true,
          checkIn: true,
          checkOut: true,
          lodging: { select: { name: true, lat: true, lon: true } },
        },
      }),
      prisma.cruiseStop.findMany({
        where: { cruise: { userId, status: { in: ["flown", "historical"] } }, isAtSea: false },
        select: {
          date: true,
          arrivalTime: true,
          port: { select: { name: true, lat: true, lon: true } },
        },
      }),
      prisma.flight.findMany({
        where: { userId, status: { in: ["flown", "historical"] } },
        select: {
          status: true,
          depIata: true,
          arrIata: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
          departureTime: true,
          arrivalTime: true,
        },
      }),
      prisma.place.findMany({
        where: { userId, visited: true },
        select: {
          name: true,
          lat: true,
          lon: true,
          visited: true,
          visits: { select: { visitedAt: true } },
        },
      }),
    ]);

    // Only OPEN targets. Suggesting something the user already ticked is noise
    // that makes the list of suggestions untrustworthy.
    const tickedIds = new Set(ticked.filter((p) => p.visited).map((p) => p.curatedItemId));
    const targets = curated.items
      .filter((i) => !tickedIds.has(i.id))
      .map((i) => ({ itemId: i.id, name: i.name, lat: i.lat, lon: i.lon }));

    const anchors = buildAnchors({
      lodgings: stays
        .filter((s) => s.lodging !== null)
        .map((s) => ({
          name: s.lodging.name,
          lat: s.lodging.lat,
          lon: s.lodging.lon,
          checkIn: s.checkIn,
          checkOut: s.checkOut,
          status: s.status,
        })),
      cruiseStops: stops
        .filter((s) => s.port !== null)
        .map((s) => ({
          portName: s.port?.name ?? null,
          lat: s.port?.lat ?? null,
          lon: s.port?.lon ?? null,
          at: s.arrivalTime ?? s.date,
        })),
      flights,
      places,
    });

    const suggestions = suggestVisits(targets, anchors);

    res.json({
      success: true,
      data: {
        key: curated.key,
        // Both numbers travel so the UI can say something honest when the list
        // is empty: no anchors at all is "record some travel first", while
        // anchors with no hits is "nothing of yours is near an open target".
        anchorCount: anchors.length,
        openCount: targets.length,
        suggestions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- tick

/** A tick may carry the date it happened — that is what accepting a suggestion
 *  does, so the visit lands with the date the evidence gave it rather than as
 *  another undated one. */
const tickSchema = z.object({
  visitedAt: z.string().datetime().nullable().optional(),
});

router.post("/items/:itemId/tick", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = tickSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const visitedAt = parsed.data.visitedAt ? new Date(parsed.data.visitedAt) : null;

    const item = await prisma.curatedPlace.findUnique({ where: { id: req.params.itemId } });
    if (!item) throw new AppError("Checklist item not found", 404);

    // Ticking implies subscribing. Someone who arrives from a search result and
    // ticks one wonder means to be following that list; making them subscribe
    // first would be ceremony with no information in it.
    const curated = await prisma.curatedList.findUnique({ where: { key: item.listKey } });
    if (!curated) throw new AppError("Checklist not found", 404);

    const place = await prisma.place.upsert({
      where: { userId_curatedItemId: { userId, curatedItemId: item.id } },
      create: {
        userId,
        curatedItemId: item.id,
        name: item.name,
        category: CURATED_CATEGORY,
        lat: item.lat,
        lon: item.lon,
        country: item.country,
        isoCountryCode: item.isoCountryCode,
        visited: true,
        dataSource: "curated",
      },
      // Re-ticking an untickd row promotes it again without touching the name,
      // notes or coordinates the user may have corrected in the meantime.
      update: { visited: true },
    });

    const list = await prisma.placeList.upsert({
      where: { userId_curatedKey: { userId, curatedKey: curated.key } },
      create: {
        userId,
        curatedKey: curated.key,
        name: curated.name,
        description: curated.description,
        icon: curated.icon,
      },
      update: {},
    });

    await prisma.placeListEntry.upsert({
      where: { listId_placeId: { listId: list.id, placeId: place.id } },
      create: { listId: list.id, placeId: place.id, sortIdx: item.sortIdx },
      update: {},
    });

    // A dated tick records the visit too, once. `createMany` with a guard
    // rather than a blind create: re-ticking after an untick must not stack a
    // second identical visit onto the same day.
    if (visitedAt) {
      const already = await prisma.placeVisit.findFirst({
        where: { placeId: place.id, userId, visitedAt },
        select: { id: true },
      });
      if (!already) {
        await prisma.placeVisit.create({ data: { placeId: place.id, userId, visitedAt } });
      }
    }

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after checklist tick");
    });

    logger.info(
      { operation: "curated_item_tick", userId, itemId: item.id, placeId: place.id },
      "Curated checklist item ticked"
    );
    res.status(201).json({ success: true, data: place });
  } catch (error) {
    next(error);
  }
});

router.delete("/items/:itemId/tick", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);

    // Unticking clears the tick and DELETES NOTHING. The row keeps its visits,
    // its photos and any notes; it simply stops counting as visited, which is
    // the same state a wishlist entry is in. Deleting the place here would make
    // a mis-click destroy a photo, and no confirmation dialog is worth that.
    const updated = await prisma.place.updateMany({
      where: { userId, curatedItemId: req.params.itemId },
      data: { visited: false },
    });
    if (updated.count === 0) throw new AppError("Checklist item not ticked", 404);

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after checklist untick");
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
