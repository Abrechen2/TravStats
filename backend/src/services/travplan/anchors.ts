import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { PlanTransaction } from "./execution";
import type { PlanState } from "./types";
/** AI proposals must not rely on a source booking edited outside TravPlan. */
export async function assertAnchorsCurrent(
  db: PlanTransaction | typeof prisma,
  userId: string,
  tripId: string,
  state: PlanState
) {
  const active = state.items.filter(
    (i) => i.source && i.execution !== "cancelled" && i.execution !== "skipped"
  );
  const check = async (
    kinds: string[],
    load: (ids: string[]) => Promise<{ id: string; updatedAt: Date }[]>
  ) => {
    const items = active.filter((i) => kinds.includes(i.source!.kind));
    if (!items.length) return;
    const records = await load(items.map((i) => i.source!.id));
    if (
      items.some(
        (i) =>
          !records.some(
            (r) => r.id === i.source!.id && r.updatedAt.toISOString() === i.source!.version
          )
      )
    )
      throw new AppError(
        "A fixed booking changed in TravStats; refresh source bookings before asking for or applying help",
        409,
        "PLAN_ANCHOR_STALE"
      );
  };
  const where = (ids: string[]) => ({ id: { in: ids }, userId, tripId }),
    select = { id: true, updatedAt: true } as const;
  await check(["existing:flight", "linkedActual:flight", "planFlight"], (ids) =>
    db.flight.findMany({ where: where(ids), select })
  );
  await check(["existing:hotel", "linkedActual:hotel", "planHotel"], (ids) =>
    db.lodgingStay.findMany({ where: where(ids), select })
  );
  await check(["existing:rail", "linkedActual:rail"], (ids) =>
    db.railJourney.findMany({ where: where(ids), select })
  );
  await check(["existing:bus", "linkedActual:bus"], (ids) =>
    db.busJourney.findMany({ where: where(ids), select })
  );
  await check(["existing:ferry", "linkedActual:ferry"], (ids) =>
    db.ferryJourney.findMany({ where: where(ids), select })
  );
  await check(["existing:cruise", "linkedActual:cruise"], (ids) =>
    db.cruise.findMany({ where: where(ids), select })
  );
  await check(["existing:rental", "linkedActual:rental"], (ids) =>
    db.rentalBooking.findMany({ where: where(ids), select })
  );
  const venues = active.filter((i) => i.kind === "hotel" && i.source?.auxId);
  if (venues.length) {
    const rows = await db.lodging.findMany({
      where: { userId, id: { in: venues.map((i) => i.source!.auxId!) } },
      select,
    });
    if (
      venues.some(
        (i) =>
          !rows.some(
            (r) => r.id === i.source!.auxId && r.updatedAt.toISOString() === i.source!.auxVersion
          )
      )
    )
      throw new AppError(
        "A lodging changed in TravStats; refresh source bookings",
        409,
        "PLAN_ANCHOR_STALE"
      );
  }
}
