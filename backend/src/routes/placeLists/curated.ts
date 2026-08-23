import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { classifyVisit } from "../../shared/placeCounting";
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
      data: lists.map((l) => ({
        key: l.key,
        name: l.name,
        description: l.description,
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
        lat: item.lat,
        lon: item.lon,
        country: item.country,
        isoCountryCode: item.isoCountryCode,
        blurb: item.blurb,
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
        description: curated.description,
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

// ---------------------------------------------------------------- tick

router.post("/items/:itemId/tick", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
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
