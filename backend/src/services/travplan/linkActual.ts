import { AppError } from "../../middleware/errorHandler";
import type { PlanTransaction } from "./execution";
import type { PlanState } from "./types";
export async function linkActual(
  tx: PlanTransaction,
  userId: string,
  tripId: string,
  state: PlanState,
  itemId: string,
  sourceId: string
): Promise<PlanState> {
  const next = structuredClone(state),
    item = next.items.find((i) => i.id === itemId);
  if (!item) throw new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");
  if (item.source?.kind.startsWith("plan"))
    throw new AppError("This entry already has materialized evidence", 409, "PLAN_PROTECTED");
  const where = { id: sourceId, userId, tripId };
  let row: { id: string; status: string; updatedAt: Date } | null = null;
  switch (item.kind) {
    case "flight":
      row = await tx.flight.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    case "hotel":
      row = await tx.lodgingStay.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    case "rail":
      row = await tx.railJourney.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    case "bus":
      row = await tx.busJourney.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    case "ferry":
      row = await tx.ferryJourney.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    case "cruise":
      row = await tx.cruise.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    case "rental":
      row = await tx.rentalBooking.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      break;
    default:
      throw new AppError("Unsupported actual record kind", 400, "PLAN_EXECUTION_LINK");
  }
  if (next.items.some((i) => i.id !== item.id && i.kind === item.kind && i.source?.id === sourceId))
    throw new AppError("Actual record is already linked in this plan", 409, "PLAN_PROTECTED");
  if (!row) throw new AppError("Actual record not found on this trip", 404, "PLAN_ITEM_NOT_FOUND");
  if (!["flown", "historical", "completed", "returned"].includes(row.status))
    throw new AppError("The actual record has not been completed", 409, "PLAN_EXECUTION_LINK");
  item.source = {
    kind: "linkedActual:" + item.kind,
    id: row.id,
    version: row.updatedAt.toISOString(),
  };
  item.execution = "confirmed";
  return next;
}
