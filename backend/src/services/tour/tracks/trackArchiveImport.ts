import { createHash } from "crypto";

import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { parseTrackFile } from "./parseTrackFile";
import { ingestTrack } from "./ingestTrack";
import { ingestedTrackColumns } from "./trackRow";
import { readArchiveBlock, restoredTrackColumns, type ArchiveBlock } from "./gpxArchive";

/**
 * Recordings from files — one GPX/TCX/FIT, or many out of a ZIP — each placed
 * on the tour it belongs to (owner, 2026-09-25: tours move between accounts
 * with their recordings).
 *
 * Our own export carries a TravStats block (see `gpxArchive.ts`): the tour it
 * came from and every figure measured on the raw points. Such a file finds
 * its tour by id in this account, else by name among this account's tours of
 * the same kind (a moved account), else it creates the day tour — so the ZIP
 * alone moves tours with their recordings. A ROADTRIP is not created from a
 * recording: its stations are its substance and come from the spreadsheet,
 * which is therefore read first.
 *
 * Any other file becomes a new day tour of its own, named after the
 * recording. It is never attached to an existing tour by name — "Morning
 * run" names a hundred walks.
 *
 * The same file twice is one recording: our files by the recording's own
 * reference, other files by a hash of their bytes.
 *
 * A dry run writes nothing and reports what WOULD happen, as the spreadsheet
 * import does.
 */

export interface ArchiveFile {
  name: string;
  content: Buffer;
}

export type ArchiveAction = "attach" | "createTour" | "duplicate" | "error";

export interface ArchiveFileOutcome {
  file: string;
  action: ArchiveAction;
  tourId: string | null;
  tourName: string | null;
  /** Fixed vocabulary for `error` — the client picks the sentence. */
  message?: "unreadable" | "noTimestamps" | "roadtripNotFound" | "ambiguousTour";
}

interface RouteRef {
  id: string;
  name: string;
}

const PENDING = "pending:";
const day = (d: Date): string => d.toISOString().slice(0, 10);

function baseName(file: string): string {
  const leaf = file.split(/[\\/]/).pop() ?? file;
  return leaf.replace(/\.(gpx|tcx|fit)$/i, "").trim() || "Tour";
}

/** The caller's tours of one kind with this name, and the days they touch. */
async function toursNamed(userId: string, kind: string, name: string) {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind, name: { equals: name.trim(), mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      tracks: { select: { startedAt: true } },
      stops: { select: { startDate: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    days: new Set([
      ...r.tracks.map((t) => day(t.startedAt)),
      ...r.stops.flatMap((s) => (s.startDate ? [day(s.startDate)] : [])),
    ]),
  }));
}

export async function importTrackArchive(
  userId: string,
  files: readonly ArchiveFile[],
  dryRun: boolean
): Promise<ArchiveFileOutcome[]> {
  const out: ArchiveFileOutcome[] = [];
  /** Source tour id → route in this account, so two recordings of one tour land together. */
  const placed = new Map<string, RouteRef>();
  /** Hashes and references already taken by an earlier file of this run. */
  const takenInRun = new Set<string>();

  for (const file of files) {
    const parsedFile = await parseTrackFile(file.content, file.name);
    if (!parsedFile) {
      out.push({
        file: file.name,
        action: "error",
        tourId: null,
        tourName: null,
        message: "unreadable",
      });
      continue;
    }

    const block: ArchiveBlock | null =
      parsedFile.format === "gpx" ? readArchiveBlock(file.content.toString("utf8")) : null;

    let columns: Record<string, unknown>;
    let externalRef: string;
    if (block) {
      columns = restoredTrackColumns(parsedFile.track, block);
      externalRef = block.track.externalRef ?? `travstats:${block.track.id}`;
    } else {
      const ingested = ingestTrack(parsedFile.track);
      if (!ingested) {
        out.push({
          file: file.name,
          action: "error",
          tourId: null,
          tourName: null,
          message: "noTimestamps",
        });
        continue;
      }
      columns = {
        ...ingestedTrackColumns(ingested),
        source: parsedFile.format,
        name: parsedFile.track.name,
        truncated: false,
      };
      externalRef = `sha256:${createHash("sha256").update(file.content).digest("hex")}`;
    }

    // ---- which tour
    let route: RouteRef | null = null;
    let create: { name: string; kind: string; activity: string | null; mode: string } | null = null;

    if (block) {
      const t = block.tour;
      const own = await prisma.tripRoute.findFirst({
        where: { id: t.id, userId, kind: t.kind },
        select: { id: true, name: true },
      });
      route = own ?? placed.get(t.id) ?? null;
      if (!route) {
        const named = await toursNamed(userId, t.kind, t.name);
        const onDay = named.filter((n) => n.days.has(day(new Date(block.track.startedAt))));
        const pick = named.length === 1 ? named : onDay;
        if (pick.length === 1) route = { id: pick[0].id, name: pick[0].name };
        else if (pick.length > 1) {
          out.push({
            file: file.name,
            action: "error",
            tourId: null,
            tourName: t.name,
            message: "ambiguousTour",
          });
          continue;
        } else if (t.kind === "roadtrip") {
          out.push({
            file: file.name,
            action: "error",
            tourId: null,
            tourName: t.name,
            message: "roadtripNotFound",
          });
          continue;
        } else {
          create = { name: t.name, kind: "tour", activity: t.activity, mode: t.mode };
        }
      }
    } else {
      const taken = await prisma.tripRouteTrack.findFirst({
        where: { externalRef, route: { userId } },
        select: { route: { select: { id: true, name: true } } },
      });
      if (taken || takenInRun.has(externalRef)) {
        out.push({
          file: file.name,
          action: "duplicate",
          tourId: taken?.route.id ?? null,
          tourName: taken?.route.name ?? null,
        });
        continue;
      }
      create = {
        name: parsedFile.track.name?.trim() || baseName(file.name),
        kind: "tour",
        activity: null,
        mode: "foot",
      };
    }

    // ---- the same recording already there?
    if (route && !route.id.startsWith(PENDING)) {
      // Back in its own account, our file names the very recording it was
      // written from — which usually carries no reference of its own.
      const existing = await prisma.tripRouteTrack.findFirst({
        where: {
          routeId: route.id,
          OR: [{ externalRef }, ...(block ? [{ id: block.track.id }] : [])],
        },
        select: { id: true },
      });
      if (existing || takenInRun.has(`${route.id}|${externalRef}`)) {
        out.push({ file: file.name, action: "duplicate", tourId: route.id, tourName: route.name });
        continue;
      }
    }

    // ---- write
    let createdTour = false;
    if (!route && create) {
      createdTour = true;
      route = dryRun
        ? { id: `${PENDING}${file.name}`, name: create.name }
        : await prisma.tripRoute.create({
            data: {
              userId,
              name: create.name.slice(0, 200),
              kind: "tour",
              mode: create.mode,
              activity: create.activity,
            },
            select: { id: true, name: true },
          });
      if (block) placed.set(block.tour.id, route);
    }
    if (!route) continue;

    if (!dryRun) {
      await prisma.tripRouteTrack.create({
        data: {
          ...(columns as Omit<
            Prisma.TripRouteTrackUncheckedCreateInput,
            "routeId" | "externalRef"
          >),
          routeId: route.id,
          externalRef,
        },
      });
    }
    takenInRun.add(externalRef);
    takenInRun.add(`${route.id}|${externalRef}`);
    out.push({
      file: file.name,
      action: createdTour ? "createTour" : "attach",
      tourId: route.id.startsWith(PENDING) ? null : route.id,
      tourName: route.name,
    });
  }

  return out;
}
