import { prisma } from "../../db";
import {
  dataQualityFlagPayloadSchema,
  type DataQualityEntityType,
  type DataQualityFlagKind,
  type DataQualityFlagStatus,
  type DataQualityFlagSubject,
  type DataQualityFlagView,
  type FlaggedRecord,
} from "../../schemas/dataQualityFlag";
import logger from "../../utils/logger";
import { evidenceOf, findingActionsOf } from "./findingEvidence";
import { resolveTimeSubjects } from "./timeSubjects";

/**
 * Reading and answering the data-quality inbox.
 *
 * Every function here takes a `userId` and puts it in the WHERE clause rather
 * than checking ownership after the fact. A flag names one of the user's own
 * records, so a leak is not "a stranger sees a row id" — it is a stranger
 * reading the name of somebody's hotel and the country they were in.
 */

interface StoredFlag {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  status: string;
  details: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
  undoUntil?: Date | null;
  revision?: number;
}

export interface ListFlagsFilters {
  /** `all` returns every status; anything else filters to that one. */
  status?: DataQualityFlagStatus | "all";
  kind?: DataQualityFlagKind;
  /** One flag — how an answer reads back the flag it answered. */
  id?: string;
}

/**
 * Names for the rows the flags point at, in one query per kind of row.
 *
 * A `country` flag has no row — see `listFlags`, which builds that subject from
 * the ISO code instead. Everything else must exist: a flag pointing at a deleted
 * lodging has nothing behind it to look at, so it is dropped from the list
 * rather than rendered as a dead entry.
 */
async function resolveSubjects(
  userId: string,
  flags: readonly StoredFlag[]
): Promise<Map<string, FlaggedRecord>> {
  const lodgingIds = flags.filter((f) => f.entityType === "lodging").map((f) => f.entityId);
  const placeIds = flags.filter((f) => f.entityType === "place").map((f) => f.entityId);

  const [lodgings, places] = await Promise.all([
    lodgingIds.length > 0
      ? prisma.lodging.findMany({
          where: { userId, id: { in: lodgingIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    placeIds.length > 0
      ? prisma.place.findMany({
          where: { userId, id: { in: placeIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const subjects = new Map<string, FlaggedRecord>();
  for (const lodging of lodgings) {
    subjects.set(`lodging ${lodging.id}`, {
      entityType: "lodging",
      entityId: lodging.id,
      label: lodging.name,
    });
  }
  for (const place of places) {
    subjects.set(`place ${place.id}`, {
      entityType: "place",
      entityId: place.id,
      label: place.name,
    });
  }
  return subjects;
}

/**
 * Names for bus rides a record check flagged (forgejo#282) and ferry rides the
 * ferry match flagged (spec C3). A ride is its own page, so it carries no
 * parent; `tripId` lets the inbox say which trip.
 */
async function resolveRideSubjects(
  userId: string,
  flags: readonly StoredFlag[]
): Promise<Map<string, DataQualityFlagSubject>> {
  const idsOf = (type: string) => flags.filter((f) => f.entityType === type).map((f) => f.entityId);
  const busIds = idsOf("bus_journey");
  const ferryIds = idsOf("ferry_journey");
  const select = { id: true, tripId: true, depStationName: true, arrStationName: true } as const;
  const [buses, ferries] = await Promise.all([
    busIds.length > 0
      ? prisma.busJourney.findMany({ where: { userId, id: { in: busIds } }, select })
      : Promise.resolve([]),
    ferryIds.length > 0
      ? prisma.ferryJourney.findMany({ where: { userId, id: { in: ferryIds } }, select })
      : Promise.resolve([]),
  ]);
  const subject = (
    entityType: "bus_journey" | "ferry_journey",
    ride: (typeof buses)[number]
  ): [string, DataQualityFlagSubject] => [
    `${entityType} ${ride.id}`,
    {
      entityType,
      entityId: ride.id,
      label: `${ride.depStationName} → ${ride.arrStationName}`,
      parentId: null,
      parentType: null,
      tripId: ride.tripId,
    },
  ];
  return new Map([
    ...buses.map((ride) => subject("bus_journey", ride)),
    ...ferries.map((ride) => subject("ferry_journey", ride)),
  ]);
}

/**
 * One stored row as the API returns it, or null when it cannot be shown.
 *
 * `kind` and `details` are two columns, and this is where they are checked
 * AGAINST EACH OTHER — not merely each against a list of allowed shapes. A row
 * saying `stay_dates_reversed` over an address-mismatch payload is refused here,
 * so no consumer downstream has to re-derive the pairing at runtime to be safe.
 *
 * Refusing means skipping and logging, never throwing: one unreadable row must
 * not empty the whole inbox.
 */
function toView(
  flag: StoredFlag,
  subject: DataQualityFlagSubject | undefined
): DataQualityFlagView | null {
  if (!subject) return null;

  const payload = dataQualityFlagPayloadSchema.safeParse({
    kind: flag.kind,
    details: flag.details,
  });
  if (!payload.success) {
    logger.warn({
      operation: "data_quality_flag_unreadable",
      message: "Data-quality flag skipped: details did not match the shape its kind implies",
      context: { flagId: flag.id, kind: flag.kind },
    });
    return null;
  }

  // `evidence` is computed from the same payload the pairing check just
  // passed, so it is the kind's evidence shape by construction.
  return {
    ...payload.data,
    evidence: evidenceOf(payload.data, flag.entityType, flag.entityId),
    id: flag.id,
    entityType: flag.entityType as DataQualityEntityType,
    entityId: flag.entityId,
    status: flag.status as DataQualityFlagStatus,
    subject,
    createdAt: flag.createdAt.toISOString(),
    resolvedAt: flag.resolvedAt ? flag.resolvedAt.toISOString() : null,
    undoUntil: flag.undoUntil ? flag.undoUntil.toISOString() : null,
    actions: findingActionsOf(flag.kind, flag.entityType),
    revision: flag.revision ?? 0,
  } as DataQualityFlagView;
}

export async function listFlags(
  userId: string,
  filters: ListFlagsFilters = {}
): Promise<DataQualityFlagView[]> {
  const status = filters.status ?? "open";
  const flags = await prisma.dataQualityFlag.findMany({
    where: {
      userId,
      ...(status === "all" ? {} : { status }),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.id ? { id: filters.id } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });

  const subjects = await resolveSubjects(userId, flags);
  const timeSubjects = await resolveTimeSubjects(userId, flags);
  const rideSubjects = await resolveRideSubjects(userId, flags);

  const views: DataQualityFlagView[] = [];
  for (const flag of flags) {
    // A country subject carries the ISO code and NO label: the name is
    // localised, and the server does not know the reader's language. Putting
    // the code in `label` would make that field a name for a row and a code
    // for a country — the trap this shape removes.
    const subject: DataQualityFlagSubject | undefined =
      flag.entityType === "country"
        ? { entityType: "country", countryCode: flag.entityId }
        : flag.entityType === "home"
          ? { entityType: "home", entityId: flag.entityId }
          : (subjects.get(`${flag.entityType} ${flag.entityId}`) ??
            timeSubjects.get(`${flag.entityType} ${flag.entityId}`) ??
            rideSubjects.get(`${flag.entityType} ${flag.entityId}`));
    const view = toView(flag, subject);
    if (view) views.push(view);
  }
  return views;
}

/** One flag as the API returns it, or null when it is not this user's or cannot be shown. */
export async function getFlagView(id: string, userId: string): Promise<DataQualityFlagView | null> {
  const [view] = await listFlags(userId, { status: "all", id });
  return view ?? null;
}
