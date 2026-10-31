import type { PlaceCapture } from "../../prisma";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { AuthRequest } from "../../middleware/auth";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { visitPromotesPlace } from "../../shared/placeCounting";
import { completeAddressFromCoordinates } from "../geo/nominatim";
import { visitTimeColumns } from "../../routes/places/visitTime";
import { tripForVisitDay } from "./visitTrip";
import type { CreateCaptureInput, ResolveCaptureInput } from "../../schemas/placeCapture";

/**
 * Positions the Companion captured before they had a name (companion#90).
 * The server holds them until the user names or dismisses them; see the
 * `PlaceCapture` model and docs/superpowers/specs/2026-10-31-place-captures.md.
 */

/** Rows one list answers; open captures are few, the bound keeps a flood harmless. */
export const CAPTURE_LIST_LIMIT = 200;

export interface CaptureDto {
  id: string;
  clientId: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  capturedAt: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  placeId: string | null;
  visitId: string | null;
  createdAt: string;
}

export function toCaptureDto(row: PlaceCapture): CaptureDto {
  return {
    id: row.id,
    clientId: row.clientId,
    lat: row.lat,
    lon: row.lon,
    accuracyM: row.accuracyM,
    capturedAt: row.capturedAt.toISOString(),
    note: row.note,
    status: row.status as CaptureDto["status"],
    placeId: row.placeId,
    visitId: row.visitId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Creates the capture, or answers the one this `clientId` already made. */
export async function createCapture(
  userId: string,
  input: CreateCaptureInput
): Promise<{ row: PlaceCapture; created: boolean }> {
  const existing = await prisma.placeCapture.findUnique({
    where: { userId_clientId: { userId, clientId: input.clientId } },
  });
  if (existing) return { row: existing, created: false };
  try {
    const row = await prisma.placeCapture.create({
      data: {
        userId,
        clientId: input.clientId,
        lat: input.lat,
        lon: input.lon,
        accuracyM: input.accuracyM,
        capturedAt: new Date(input.capturedAt),
        note: input.note || null,
      },
    });
    return { row, created: true };
  } catch (err) {
    // Two uploads of the same capture raced: the loser answers the winner's row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.placeCapture.findUnique({
        where: { userId_clientId: { userId, clientId: input.clientId } },
      });
      if (winner) return { row: winner, created: false };
    }
    throw err;
  }
}

export async function listCaptures(userId: string, status: string): Promise<PlaceCapture[]> {
  return prisma.placeCapture.findMany({
    where: { userId, status },
    orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
    take: CAPTURE_LIST_LIMIT,
  });
}

async function ownedCapture(userId: string, id: string): Promise<PlaceCapture> {
  const row = await prisma.placeCapture.findFirst({ where: { id, userId } });
  if (!row) throw new AppError("Capture not found", 404, "CAPTURE_NOT_FOUND");
  return row;
}

const alreadyResolved = () =>
  new AppError("Capture is already resolved or dismissed", 409, "CAPTURE_ALREADY_RESOLVED");

/**
 * Names a capture: a place (new at the captured position, or one the caller
 * owns) and a visit at `capturedAt`, in one transaction. The status flips with
 * a conditional update, so two resolves cannot both win.
 */
export async function resolveCapture(
  userId: string,
  id: string,
  input: ResolveCaptureInput,
  req: AuthRequest
): Promise<PlaceCapture> {
  const capture = await ownedCapture(userId, id);
  if (capture.status !== "open") throw alreadyResolved();

  const chosen = input.placeId
    ? await prisma.place.findFirst({ where: { id: input.placeId, userId } })
    : null;
  if (input.placeId && !chosen) {
    throw new AppError("Place not found", 404, "VISIT_PLACE_NOT_FOUND");
  }
  // Only a NEW place is completed from the position; awaited before the
  // transaction so a slow geocoder holds no connection open.
  const completed = chosen
    ? null
    : await completeAddressFromCoordinates({
        lat: capture.lat,
        lon: capture.lon,
        address: null,
        city: null,
        country: null,
      });

  if (chosen && input.visitId) {
    // Already written by the phone: bind, create nothing.
    const visit = await prisma.placeVisit.findFirst({
      where: { id: input.visitId, userId, placeId: chosen.id },
      select: { id: true },
    });
    if (!visit) {
      throw new AppError("visitId does not belong to placeId", 400, "VALIDATION_FAILED");
    }
    const claimed = await prisma.placeCapture.updateMany({
      where: { id, userId, status: "open" },
      data: { status: "resolved", placeId: chosen.id, visitId: visit.id },
    });
    if (claimed.count === 0) throw alreadyResolved();
    return ownedCapture(userId, id);
  }

  const anchor = chosen ?? { id: "", lat: capture.lat, lon: capture.lon };
  const { columns: time, writtenVia } = await visitTimeColumns(
    { kind: "instant", utc: capture.capturedAt, bareZ: false },
    anchor,
    req
  );
  const tripId = await tripForVisitDay(prisma, userId, time);
  const happened = visitPromotesPlace(time);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.placeCapture.updateMany({
      where: { id, userId, status: "open" },
      data: { status: "resolved" },
    });
    if (claimed.count === 0) throw alreadyResolved();

    const place =
      chosen ??
      (await tx.place.create({
        data: {
          userId,
          name: input.name as string,
          category: input.category ?? "other",
          lat: capture.lat,
          lon: capture.lon,
          address: completed?.address ?? null,
          city: completed?.city ?? null,
          country: completed?.country ?? null,
          isoCountryCode: resolveCountryCode(completed?.country ?? null),
          visited: happened,
          dataSource: "manual",
        },
      }));
    const visit = await tx.placeVisit.create({
      data: { placeId: place.id, userId, tripId, ...time, writtenVia, orderIdx: 0 },
    });
    if (happened && !place.visited) {
      await tx.place.update({ where: { id: place.id }, data: { visited: true } });
    }
    return tx.placeCapture.update({
      where: { id },
      data: { placeId: place.id, visitId: visit.id },
    });
  });
}

/** Dismisses an open capture; the row stays as the record that it happened. */
export async function dismissCapture(userId: string, id: string): Promise<PlaceCapture> {
  await ownedCapture(userId, id);
  const claimed = await prisma.placeCapture.updateMany({
    where: { id, userId, status: "open" },
    data: { status: "dismissed" },
  });
  if (claimed.count === 0) throw alreadyResolved();
  return ownedCapture(userId, id);
}
