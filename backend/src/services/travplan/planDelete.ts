/**
 * Deleting a plan (forgejo#404). Owner only - `ownedPlan` already refuses anyone else, and the
 * co-planner of spec D3 ("everything except deleting the plan") has no route here.
 *
 * What goes: the plan document with its ideas, bookings, placeholders, stations, stages and
 * variants, the undo receipts and the AI proposals. What stays, always: the trip and everything
 * the logbook already holds on it - flights, stays, ferry crossings, stations a handover wrote.
 * A plan is not travel evidence, so deleting one can never remove evidence.
 */
import { prisma } from "../../db";
import { ownedPlan } from "./store";
import { parseState } from "./upgrade";
import { NOT_PLAN_SHELL } from "./planShell";
import logger from "../../utils/logger";

export interface PlanDeletePreview {
  /** What the delete removes. */
  removes: {
    items: number;
    ideas: number;
    bookings: number;
    placeholders: number;
    stations: number;
    stages: number;
    variants: number;
    tasks: number;
    packing: number;
    receipts: number;
    proposals: number;
  };
  /** What stays in the logbook that the plan wrote (handover). */
  keeps: { stations: number; confirmedItems: number };
  /** The trip stays either way; true when it holds nothing but the plan's shell. */
  tripIsEmptyShell: boolean;
}

export async function previewPlanDelete(
  userId: string,
  tripId: string
): Promise<PlanDeletePreview> {
  const plan = await ownedPlan(userId, tripId);
  const state = parseState(plan.state);
  const [receipts, proposals, notShell] = await Promise.all([
    prisma.travelPlanMutation.count({ where: { planId: plan.id } }),
    prisma.travelPlanProposal.count({ where: { planId: plan.id } }),
    prisma.trip.count({ where: { id: tripId, userId, ...NOT_PLAN_SHELL } }),
  ]);
  return {
    removes: {
      items: state.items.length,
      ideas: state.ideas.length,
      bookings: state.bookings.length,
      placeholders: state.bookings.filter((b) => b.placeholder).length,
      stations: state.stations.length,
      stages: state.stages.length,
      variants: state.variants.length,
      tasks: state.tasks.length,
      packing: state.packing.length,
      receipts,
      proposals,
    },
    keeps: {
      stations: state.stationLinks.length,
      confirmedItems: state.items.filter((i) => i.execution === "confirmed").length,
    },
    tripIsEmptyShell: notShell === 0,
  };
}

export async function deletePlan(userId: string, tripId: string): Promise<void> {
  const plan = await ownedPlan(userId, tripId);
  // Scoped to the account as well: a foreign key proves the row exists, not whose it is.
  await prisma.travelPlan.deleteMany({ where: { id: plan.id, trip: { userId } } });
  logger.info({ operation: "travplan.delete", tripId }, "plan deleted");
}
