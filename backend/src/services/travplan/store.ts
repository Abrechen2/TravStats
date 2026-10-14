import { createHash } from "node:crypto";
import { prisma } from "../../db";
import type { Prisma, TravelPlan } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { emptyState, stateSchema, createPlanSchema, proposalContentSchema } from "./schema";
import { applyOperation, applyProposal } from "./operations";
import {linkActual} from "./linkActual";
import { checkPlan, deriveBudget } from "./rules";
import {prepareExecution,synchronizeExecution,type PreparedExecution} from "./execution";
import type { PlanState, PlanView, PlanWrite } from "./types";
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
export function view(
  row: Omit<TravelPlan, "state"> & { state: unknown },
  name: string,
  lastMutationId?: string
): PlanView {
  const state = stateSchema.parse(row.state);
  return {
    id: row.id,
    tripId: row.tripId,
    name,
    revision: row.revision,
    state,
    findings: checkPlan(state),
    budget: deriveBudget(state),
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
  const last=await prisma.travelPlanMutation.findFirst({where:{planId:row.id,revision:row.revision},orderBy:{createdAt:"desc"},select:{id:true}});
  return view(row, row.trip.name,last?.id);
}
export async function listPlans(userId: string) {
  const rows = await prisma.travelPlan.findMany({
    where: { trip: { userId } },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: { trip: { select: { name: true } } },
  });
  return rows.map((r) => view(r, r.trip.name));
}
export async function createPlan(userId: string, input: unknown): Promise<PlanView> {
  await assertEnabled();
  const body = createPlanSchema.parse(input);
  const prior = await prisma.travelPlan.findFirst({
    where: { createRef: body.clientRef, trip: { userId } },
    include: { trip: { select: { name: true } } },
  });
  if (prior) {
    const first=await prisma.travelPlanMutation.findFirst({where:{planId:prior.id},orderBy:{createdAt:"asc"},select:{before:true}});
    const original=first?.before as unknown as {state:unknown;name:string}|undefined;
    if (
      (original?.name??prior.trip.name) !== body.name ||
      hash({ ...emptyState(), ...body.settings }) !== hash(original?.state??prior.state)
    )
      throw new AppError("Creation key has different content", 409, "PLAN_IDEMPOTENCY_CONFLICT");
    return view(prior, prior.trip.name);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      let trip = body.tripId
        ? await tx.trip.findFirst({
            where: { id: body.tripId, userId },
            select: { id: true, name: true },
          })
        : null;
      if (body.tripId && !trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
      if (trip) {
        const existing = await tx.travelPlan.findUnique({ where: { tripId: trip.id } });
        if (existing) return view(existing, trip.name);
      }
      if (!trip)
        trip = await tx.trip.create({
          data: { userId, name: body.name, status: "planned" },
          select: { id: true, name: true },
        });
      const state = stateSchema.parse({ ...emptyState(), ...body.settings });
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
    if (
      retry &&
      hash(retry.state) === hash({ ...emptyState(), ...body.settings }) &&
      retry.trip.name === body.name
    )
      return view(retry, retry.trip.name);
    throw error;
  }
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
  const prepared = new Map<string,PreparedExecution>();
  const initial=stateSchema.parse(owned.state);
  if (owned.revision!==body.baseRevision) throw new AppError("Plan has changed",409,"PLAN_REVISION_CONFLICT");
  if (body.operation.type==='execution' && body.operation.execution==='confirmed') prepared.set(body.operation.id,await prepareExecution(userId,tripId,initial,body.operation.id));
  if (body.operation.type==='undo') {
    const target=await prisma.travelPlanMutation.findFirst({where:{id:body.operation.mutationId,planId:owned.id,revision:owned.revision}});
    if (target) {const before=stateSchema.parse((target.before as unknown as {state:unknown}).state);for(const item of before.items)if(item.execution==='confirmed'&&initial.items.find(i=>i.id===item.id)?.execution!=='confirmed')prepared.set(item.id,await prepareExecution(userId,tripId,before,item.id))}
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
      const before = stateSchema.parse(row.state);
      let name = row.trip.name,
        next: PlanState;
      if (body.operation.type === "undo") {
        const change = await tx.travelPlanMutation.findFirst({
          where: { id: body.operation.mutationId, planId: row.id, revision: row.revision },
        });
        if (!change)
          throw new AppError("Only the latest change can be undone", 409, "PLAN_UNDO_STALE");
        const saved = change.before as unknown as { state: PlanState; name: string };
        next = stateSchema.parse(saved.state);
        name = saved.name;
      } else if (body.operation.type === "proposal") {
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
        next = applyProposal(before, proposalContentSchema.parse(proposal.content).changes);
        const priorProblems = new Set(
          checkPlan(before)
            .filter((f) => f.code === "overlap")
            .map((f) => f.id)
        );
        if (checkPlan(next).some((f) => f.code === "overlap" && !priorProblems.has(f.id)))
          throw new AppError(
            "Proposal creates conflicting appointments",
            409,
            "PLAN_PROPOSAL_CONFLICT"
          );
        await tx.travelPlanProposal.update({
          where: { id: proposal.id },
          data: { status: "accepted" },
        });
      } else if(body.operation.type==="link_actual") {next=await linkActual(tx,userId,tripId,before,body.operation.id,body.operation.sourceId);
      } else {
        next = applyOperation(before, body.operation, row.revision);
        if (body.operation.type === "settings" && body.operation.name) name = body.operation.name;
      }
      // Kept originals belong to this account and this canonical trip.
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
      await synchronizeExecution(tx,userId,tripId,before,next,prepared);
      const updated = await tx.travelPlan.updateMany({
        where: { id: row.id, revision: row.revision },
        data: { state: asJson(next), revision: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new AppError("Plan changed during this edit", 409, "PLAN_REVISION_CONFLICT");
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
    const row = await tx.travelPlanUsage.upsert({
      where: { userId_day_kind: { userId, day, kind } },
      create: { userId, day, kind, count: 0 },
      update: {},
    });
    const reserved = await tx.travelPlanUsage.updateMany({
      where: { id: row.id, count: { lt: limit } },
      data: { count: { increment: 1 } },
    });
    if (reserved.count !== 1)
      throw new AppError("Daily planning limit reached", 429, "PLAN_DAILY_LIMIT");
  });
}
