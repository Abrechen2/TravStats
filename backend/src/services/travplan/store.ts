import { assertAnchorsCurrent } from "./anchors";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../../db";
import type { Prisma, TravelPlan } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { emptyState, createPlanSchema, proposalContentSchema } from "./schema";
import { parseState } from "./upgrade";
import { applyOperation, applyProposal } from "./operations";
import { mirrorEmptyTrip } from "./metadata";
import { adoptExisting } from "./existing";
import { linkActual } from "./linkActual";
import { checkPlan, deriveBudget } from "./rules";
import { scheduleRoute } from "./routeSchedule";
import { compareVariants } from "./variants";
import { todayIn } from "../../shared/time/clock";
import { isValidZone } from "../../shared/time/zonedParts";
import { prepareExecution, synchronizeExecution, type PreparedExecution } from "./execution";
import type { PlanState, PlanView, PlanWrite, PlanSummary } from "./types";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(record)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(record[k]))
      .join(",") +
    "}"
  );
}
export function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
/**
 * "Today" for the date-driven route findings. The plan's own zone is the
 * cheap, deterministic choice here (`view` has no user at hand); a plan
 * without a valid zone falls back to UTC. The trip's own zone is the right day
 * here: it is the calendar the traveller lives in while planning and travelling.
 */
function planToday(state: PlanState): string {
  return todayIn(isValidZone(state.timezone) ? state.timezone : "UTC");
}
export function view(
  row: Omit<TravelPlan, "state"> & { state: unknown },
  name: string,
  lastMutationId?: string
): PlanView {
  const state = parseState(row.state);
  return {
    id: row.id,
    tripId: row.tripId,
    name,
    revision: row.revision,
    state,
    findings: checkPlan(state, planToday(state)),
    budget: deriveBudget(state),
    ...(state.shape === "route"
      ? { schedule: scheduleRoute(state), variants: compareVariants(state) }
      : {}),
    ...(lastMutationId ? { lastMutationId } : {}),
  };
}
export async function configuration() {
  return (
    (await prisma.travelPlanConfig.findUnique({ where: { id: "default" } })) ?? {
      enabled: process.env.TRAVPLAN_ENABLED === "true",
      aiDailyLimit: 10,
      weatherDailyLimit: 20,
    }
  );
}
export async function assertEnabled() {
  if (!(await configuration()).enabled)
    throw new AppError("Travel planning is disabled on this server", 403, "PLAN_DISABLED");
}
export async function ownedPlan(userId: string, tripId: string) {
  const plan = await prisma.travelPlan.findFirst({
    where: { tripId, trip: { userId } },
    include: { trip: { select: { name: true, id: true } } },
  });
  if (!plan) throw new AppError("Plan not found", 404, "PLAN_NOT_FOUND");
  return plan;
}
export async function readPlan(userId: string, tripId: string): Promise<PlanView> {
  const row = await ownedPlan(userId, tripId);
  const last = await prisma.travelPlanMutation.findFirst({
    where: { planId: row.id, revision: row.revision },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return view(row, row.trip.name, last?.id);
}
export async function listPlans(userId: string): Promise<PlanSummary[]> {
  // Extract only list metadata in PostgreSQL; do not load hundreds of full plans into Node.
  return prisma.$queryRaw<PlanSummary[]>`
    SELECT p.id,p.trip_id AS "tripId",t.name,p.revision,
      COALESCE(p.state->>'destination','') AS destination,
      p.state->>'startDay' AS "startDay",p.state->>'endDay' AS "endDay",
      p.state->>'status' AS status,
      jsonb_array_length(p.state->'ideas')::int AS "ideasCount",
      jsonb_array_length(p.state->'bookings')::int AS "bookingsCount"
    FROM travel_plans p JOIN trips t ON t.id=p.trip_id
    WHERE t.user_id=${userId}
    ORDER BY p.updated_at DESC LIMIT 500
  `;
}
export async function createPlan(userId: string, input: unknown): Promise<PlanView> {
  await assertEnabled();
  const body = createPlanSchema.parse(input);
  const prior = await prisma.travelPlan.findFirst({
    where: { createRef: body.clientRef, trip: { userId } },
    include: { trip: { select: { name: true } } },
  });
  if (prior) {
    if (parseState(prior.state).creationHash) {
      if (parseState(prior.state).creationHash !== hash(body))
        throw new AppError("Creation key has different content", 409, "PLAN_IDEMPOTENCY_CONFLICT");
      return view(prior, prior.trip.name);
    }
    const first = await prisma.travelPlanMutation.findFirst({
      where: { planId: prior.id },
      orderBy: { createdAt: "asc" },
      select: { before: true },
    });
    const original = first?.before as unknown as { state: unknown; name: string } | undefined;
    if (
      (body.tripId && prior.tripId !== body.tripId) ||
      (original?.name ?? prior.trip.name) !== body.name ||
      hash({ ...emptyState(), ...body.settings }) !==
        hash({ ...parseState(original?.state ?? prior.state), items: [], bookings: [] })
    )
      throw new AppError("Creation key has different content", 409, "PLAN_IDEMPOTENCY_CONFLICT");
    return view(prior, prior.trip.name);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      let trip = body.tripId
        ? await tx.trip.findFirst({
            where: { id: body.tripId, userId },
            select: {
              id: true,
              name: true,
              startDay: true,
              endDay: true,
              startDate: true,
              endDate: true,
              startZone: true,
              destinationLabel: true,
            },
          })
        : null;
      if (body.tripId && !trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
      if (trip) {
        const existing = await tx.travelPlan.findUnique({ where: { tripId: trip.id } });
        if (existing) return view(existing, trip.name);
      }
      if (!trip)
        trip = await tx.trip.create({
          data: {
            userId,
            name: body.name,
            status: "planned",
            destinationLabel: body.settings.destination,
            startDate: body.settings.startDay
              ? new Date(body.settings.startDay + "T00:00:00Z")
              : null,
            endDate: body.settings.endDay ? new Date(body.settings.endDay + "T00:00:00Z") : null,
            startDay: body.settings.startDay
              ? new Date(body.settings.startDay + "T00:00:00Z")
              : null,
            endDay: body.settings.endDay ? new Date(body.settings.endDay + "T00:00:00Z") : null,
            startZone: body.settings.timezone,
            endZone: body.settings.timezone,
          },
          select: {
            id: true,
            name: true,
            startDay: true,
            endDay: true,
            startDate: true,
            endDate: true,
            startZone: true,
            destinationLabel: true,
          },
        });
      let state: PlanState = parseState({
        ...emptyState(),
        ...(body.tripId
          ? {
              destination: trip.destinationLabel || "",
              startDay: (trip.startDay ?? trip.startDate)?.toISOString().slice(0, 10) ?? null,
              endDay: (trip.endDay ?? trip.endDate)?.toISOString().slice(0, 10) ?? null,
              timezone: trip.startZone,
            }
          : {}),
        ...body.settings,
        creationHash: hash(body),
      });
      if (body.tripId) state = await adoptExisting(tx, userId, trip.id, state);
      const row = await tx.travelPlan.create({
        data: { tripId: trip.id, createRef: body.clientRef, state: asJson(state) },
      });
      return view(row, trip.name);
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const retry = await prisma.travelPlan.findFirst({
      where: { createRef: body.clientRef, trip: { userId } },
      include: { trip: { select: { name: true } } },
    });
    if (retry && parseState(retry.state).creationHash === hash(body))
      return view(retry, retry.trip.name);
    if ((error as { code?: string }).code === "P2002") {
      if (body.tripId) {
        const existing = await prisma.travelPlan.findFirst({
          where: { tripId: body.tripId, trip: { userId } },
          include: { trip: { select: { name: true } } },
        });
        if (existing) return view(existing, existing.trip.name);
      }
      throw new AppError("Creation key has already been used", 409, "PLAN_IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}
/**
 * The stored result of an earlier write with this clientRef, or null. Lets a
 * caller that does expensive work before `writePlan` answer a retry without
 * redoing it (and without the redone work changing the payload hash).
 */
export async function findReceipt(
  userId: string,
  tripId: string,
  clientRef: string
): Promise<PlanView | null> {
  const owned = await ownedPlan(userId, tripId);
  const receipt = await prisma.travelPlanMutation.findUnique({
    where: { planId_clientRef: { planId: owned.id, clientRef } },
  });
  return receipt ? (receipt.result as unknown as PlanView) : null;
}
export async function writePlan(
  userId: string,
  tripId: string,
  body: PlanWrite
): Promise<PlanView> {
  await assertEnabled();
  const payloadHash = hash(body);
  const owned = await ownedPlan(userId, tripId);
  async function replay() {
    const receipt = await prisma.travelPlanMutation.findUnique({
      where: { planId_clientRef: { planId: owned.id, clientRef: body.clientRef } },
    });
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash)
      throw new AppError("Mutation key has different content", 409, "PLAN_IDEMPOTENCY_CONFLICT");
    return receipt.result as unknown as PlanView;
  }
  const previous = await replay();
  if (previous) return previous;
  const prepared = new Map<string, PreparedExecution>();
  const initial = parseState(owned.state);
  if (owned.revision !== body.baseRevision)
    throw new AppError("Plan has changed", 409, "PLAN_REVISION_CONFLICT");
  if (body.operation.type === "execution" && body.operation.execution === "confirmed")
    prepared.set(
      body.operation.id,
      await prepareExecution(userId, tripId, initial, body.operation.id)
    );
  if (body.operation.type === "undo") {
    const target = await prisma.travelPlanMutation.findFirst({
      where: { id: body.operation.mutationId, planId: owned.id, revision: owned.revision },
    });
    if (target) {
      const before = parseState((target.before as unknown as { state: unknown }).state);
      for (const item of before.items)
        if (
          item.execution === "confirmed" &&
          initial.items.find((i) => i.id === item.id)?.execution !== "confirmed"
        )
          prepared.set(item.id, await prepareExecution(userId, tripId, before, item.id));
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.travelPlan.findFirst({
        where: { id: owned.id, trip: { userId } },
        include: { trip: { select: { name: true } } },
      });
      if (!row) throw new AppError("Plan not found", 404, "PLAN_NOT_FOUND");
      if (row.revision !== body.baseRevision)
        throw new AppError(
          "Plan has changed; refresh before applying this edit",
          409,
          "PLAN_REVISION_CONFLICT"
        );
      const reservation = await tx.travelPlan.updateMany({
        where: { id: row.id, revision: row.revision },
        data: { revision: { increment: 1 } },
      });
      if (reservation.count !== 1)
        throw new AppError("Plan changed during this edit", 409, "PLAN_REVISION_CONFLICT");
      const before = parseState(row.state);
      let name = row.trip.name,
        next: PlanState;
      if (body.operation.type === "undo") {
        const change = await tx.travelPlanMutation.findFirst({
          where: { id: body.operation.mutationId, planId: row.id, revision: row.revision },
        });
        if (!change)
          throw new AppError("Only the latest change can be undone", 409, "PLAN_UNDO_STALE");
        const saved = change.before as unknown as { state: PlanState; name: string };
        next = parseState(saved.state);
        name = saved.name;
      } else if (body.operation.type === "proposal") {
        await assertAnchorsCurrent(tx, userId, tripId, before);
        const proposal = await tx.travelPlanProposal.findFirst({
          where: { id: body.operation.proposalId, planId: row.id, status: "pending" },
        });
        if (
          !proposal ||
          proposal.baseRevision !== row.revision ||
          proposal.inputHash !== hash(before) ||
          proposal.expiresAt < new Date()
        )
          throw new AppError("Proposal is stale; generate it again", 409, "PLAN_PROPOSAL_STALE");
        const content = proposalContentSchema.parse(proposal.content);
        next = applyProposal(before, content.changes);
        for (const idea of content.ideas)
          if (!next.ideas.some((i) => i.title.toLowerCase() === idea.title.toLowerCase()))
            next.ideas.push({ id: randomUUID(), ...idea, priority: "optional", itemId: null });
        next = parseState(next);
        const priorProblems = new Set(
          checkPlan(before, planToday(before))
            .filter((f) => f.code === "overlap")
            .map((f) => f.id)
        );
        if (
          checkPlan(next, planToday(next)).some(
            (f) => f.code === "overlap" && !priorProblems.has(f.id)
          )
        )
          throw new AppError(
            "Proposal creates conflicting appointments",
            409,
            "PLAN_PROPOSAL_CONFLICT"
          );
        await tx.travelPlanProposal.update({
          where: { id: proposal.id },
          data: { status: "accepted" },
        });
      } else if (body.operation.type === "refresh_existing") {
        next = await adoptExisting(tx, userId, tripId, before);
      } else if (body.operation.type === "link_actual") {
        next = await linkActual(
          tx,
          userId,
          tripId,
          before,
          body.operation.id,
          body.operation.sourceId
        );
      } else {
        next = applyOperation(before, body.operation, row.revision);
        if (body.operation.type === "settings" && body.operation.name) name = body.operation.name;
      }
      // Kept originals belong to this account and this canonical trip.
      if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024)
        throw new AppError("Plan is too large", 413, "PLAN_TOO_LARGE");
      const documentIds = [...new Set(next.bookings.flatMap((b) => b.documentIds))];
      if (
        documentIds.length &&
        (await tx.document.count({ where: { id: { in: documentIds }, userId, tripId } })) !==
          documentIds.length
      )
        throw new AppError(
          "A document does not belong to this trip",
          404,
          "PLAN_DOCUMENT_NOT_FOUND"
        );
      await synchronizeExecution(tx, userId, tripId, before, next, prepared);
      if (body.operation.type === "settings" || body.operation.type === "undo")
        await mirrorEmptyTrip(tx, tripId, next);
      await tx.travelPlan.update({ where: { id: row.id }, data: { state: asJson(next) } });
      if (name !== row.trip.name) await tx.trip.update({ where: { id: tripId }, data: { name } });
      // Invalidate the trip feed without deriving execution from the plan dates.
      else await tx.trip.update({ where: { id: tripId }, data: { updatedAt: new Date() } });
      const result = view(
        { ...row, state: asJson(next) as Prisma.JsonValue, revision: row.revision + 1 },
        name
      );
      const receipt = await tx.travelPlanMutation.create({
        data: {
          planId: row.id,
          clientRef: body.clientRef,
          payloadHash,
          baseRevision: row.revision,
          revision: result.revision,
          before: asJson({ state: before, name: row.trip.name }),
          result: asJson(result),
        },
      });
      result.lastMutationId = receipt.id;
      await tx.travelPlanMutation.update({
        where: { id: receipt.id },
        data: { result: asJson(result) },
      });
      return result;
    });
  } catch (error) {
    const result = await replay();
    if (result) return result;
    throw error;
  }
}
export async function reserveUsage(userId: string, kind: "ai" | "weather", limit: number) {
  const day = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  await prisma.$transaction(async (tx) => {
    await tx.travelPlanUsage.createMany({
      data: [{ userId, day, kind, count: 0 }],
      skipDuplicates: true,
    });
    const reserved = await tx.travelPlanUsage.updateMany({
      where: { userId, day, kind, count: { lt: limit } },
      data: { count: { increment: 1 } },
    });
    if (reserved.count !== 1)
      throw new AppError("Daily planning limit reached", 429, "PLAN_DAILY_LIMIT");
  });
}
