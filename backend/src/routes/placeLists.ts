import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { classifyPlace, classifyVisit } from "../shared/placeCounting";
import {
  createPlaceListSchema,
  updatePlaceListSchema,
  addListEntrySchema,
  reorderListEntriesSchema,
  placeListQuerySchema,
} from "../schemas/placeList";
import logger from "../utils/logger";

/**
 * A user's own place lists.
 *
 * Shipped checklists live in `routes/placeLists/curated.ts` and are mounted on
 * the SAME path, ahead of this router — `/curated` would otherwise be captured
 * by `/:id` here and answered with "list not found".
 *
 * No rate limiter: per-user CRUD over the caller's own lists and their entries,
 * bounded by how many lists they made. The one route in the checklist feature
 * that reads the caller's ENTIRE history is `/curated/:key/suggestions`, and it
 * is limited in that file.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const LIST_INCLUDE = {
  entries: {
    include: { place: { include: { visits: { select: { visitedAt: true } } } } },
    orderBy: { sortIdx: "asc" },
  },
} satisfies Prisma.PlaceListInclude;

type ListRow = Prisma.PlaceListGetPayload<{ include: typeof LIST_INCLUDE }>;

interface ListSummary {
  placeCount: number;
  /** Places in this list that actually happened — the future-date rule applies. */
  visitedCount: number;
  countryCount: number;
}

/**
 * The list's own figures, derived exactly the way every other figure in this
 * domain is: from data and dates, through `shared/placeCounting`. A list has no
 * status column and must never grow one.
 */
function summarise(list: ListRow, now = new Date()): ListSummary {
  const countries = new Set<string>();
  let visitedCount = 0;

  for (const entry of list.entries) {
    const place = entry.place;
    const plannedVisitCount = place.visits.reduce(
      (n, v) => (classifyVisit(v, now) === "planned" ? n + 1 : n),
      0
    );
    if (classifyPlace({ visited: place.visited, plannedVisitCount }) !== "visited") continue;
    visitedCount += 1;
    if (place.isoCountryCode) countries.add(place.isoCountryCode.toUpperCase());
  }

  return { placeCount: list.entries.length, visitedCount, countryCount: countries.size };
}

/** Strips the join rows the summary was derived from unless they were asked for. */
function present(list: ListRow, withEntries: boolean, now = new Date()) {
  const summary = summarise(list, now);
  const { entries, ...rest } = list;
  return {
    ...rest,
    ...summary,
    entries: withEntries
      ? entries.map((e) => ({ ...e, place: { ...e.place, visits: undefined } }))
      : undefined,
  };
}

/**
 * A subscribed checklist takes its name and membership from the catalog.
 *
 * Renaming "Neue 7 Weltwunder" locally would make the achievement that measures
 * it report against a list nobody recognises, and hand-editing its membership
 * would make progress meaningless. Colour, icon and sort order stay editable —
 * those are presentation, and a user colouring their wonders gold breaks
 * nothing.
 */
function assertEditableAs(list: { curatedKey: string | null }, what: "name" | "membership"): void {
  if (list.curatedKey === null) return;
  throw new AppError(
    what === "name"
      ? "A subscribed checklist takes its name from the catalog"
      : "A subscribed checklist takes its places from the catalog — tick items instead",
    409
  );
}

const findOwned = async (id: string, userId: string): Promise<ListRow> => {
  const list = await prisma.placeList.findFirst({ where: { id, userId }, include: LIST_INCLUDE });
  if (!list) throw new AppError("List not found", 404);
  return list;
};

// ---------------------------------------------------------------- list

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = placeListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const rows = await prisma.placeList.findMany({
      where: { userId },
      include: LIST_INCLUDE,
      orderBy: [{ sortIdx: "asc" }, { name: "asc" }],
    });

    const now = new Date();
    res.json({ success: true, data: rows.map((r) => present(r, parsed.data.withEntries, now)) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- read

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const list = await findOwned(req.params.id, userId);
    res.json({ success: true, data: present(list, true) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createPlaceListSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const created = await prisma.placeList.create({
      data: { ...parsed.data, userId },
      include: LIST_INCLUDE,
    });

    logger.info({ operation: "place_list_create", userId, listId: created.id }, "Place list created");
    res.status(201).json({ success: true, data: present(created, true) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = updatePlaceListSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const existing = await findOwned(req.params.id, userId);
    if (parsed.data.name !== undefined) assertEditableAs(existing, "name");

    const updated = await prisma.placeList.update({
      where: { id: existing.id },
      data: parsed.data,
      include: LIST_INCLUDE,
    });
    res.json({ success: true, data: present(updated, true) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- delete

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await findOwned(req.params.id, userId);

    // Deleting a list deletes its MEMBERSHIP rows and nothing else — the places
    // themselves belong to the logbook, not to the list. Unsubscribing from a
    // checklist likewise leaves every place the user actually ticked, because
    // those are visits that happened. The cascade on `place_list_entries` is
    // what makes this true; there is deliberately no cascade to `places`.
    await prisma.placeList.delete({ where: { id: existing.id } });

    logger.info(
      { operation: "place_list_delete", userId, listId: existing.id, entries: existing.entries.length },
      "Place list deleted"
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- entries

router.post("/:id/entries", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = addListEntrySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const list = await findOwned(req.params.id, userId);
    assertEditableAs(list, "membership");

    // Ownership of the PLACE is checked separately. A foreign key proves the row
    // exists, never that it is the caller's — adding someone else's place to
    // your list would otherwise leak its name and coordinates back through the
    // list response.
    const place = await prisma.place.findFirst({
      where: { id: parsed.data.placeId, userId },
      select: { id: true },
    });
    if (!place) throw new AppError("Place not found", 404);

    const sortIdx = parsed.data.sortIdx ?? list.entries.length;
    await prisma.placeListEntry.upsert({
      where: { listId_placeId: { listId: list.id, placeId: place.id } },
      create: { listId: list.id, placeId: place.id, sortIdx },
      update: {},
    });

    checkAndUpdateAchievements(userId).catch((error) => {
      logger.error({ error, userId }, "Failed to update achievements after list entry add");
    });

    const fresh = await findOwned(list.id, userId);
    res.status(201).json({ success: true, data: present(fresh, true) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/entries/:placeId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const list = await findOwned(req.params.id, userId);
    assertEditableAs(list, "membership");

    // deleteMany, not delete: removing a place that is not in the list is not an
    // error worth surfacing, and `delete` would throw P2025 for it.
    await prisma.placeListEntry.deleteMany({
      where: { listId: list.id, placeId: req.params.placeId },
    });

    const fresh = await findOwned(list.id, userId);
    res.json({ success: true, data: present(fresh, true) });
  } catch (error) {
    next(error);
  }
});

router.put("/:id/entries/order", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = reorderListEntriesSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const list = await findOwned(req.params.id, userId);
    assertEditableAs(list, "membership");

    const known = new Set(list.entries.map((e) => e.placeId));
    const unknown = parsed.data.placeIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new AppError("Some places are not in this list", 400);

    // One transaction: a drag renumbers every row it passed, and applying that
    // half-way leaves the list visibly wrong rather than merely unsaved.
    await prisma.$transaction(
      parsed.data.placeIds.map((placeId, index) =>
        prisma.placeListEntry.updateMany({
          where: { listId: list.id, placeId },
          data: { sortIdx: index },
        })
      )
    );

    const fresh = await findOwned(list.id, userId);
    res.json({ success: true, data: present(fresh, true) });
  } catch (error) {
    next(error);
  }
});

export default router;
