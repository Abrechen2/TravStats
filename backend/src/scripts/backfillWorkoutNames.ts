/**
 * One-shot repair: the clock in the names of workouts imported before the
 * upload re-read it at the track's first point (`workoutName.ts`).
 *
 * Two hikes imported on 2026-10-09 while the phone was in Seoul carry the
 * Seoul clock in their names — "Wanderung am 28.05.2026, 14:10" for an 08:10
 * start in Madagascar. This renames every HealthKit / Health Connect track
 * whose generated name does not show the place's time, and its tour when the
 * tour still carries that same name (a tour the user renamed is left alone).
 *
 * DRY RUN BY DEFAULT — prints what it WOULD change and writes nothing.
 * Idempotent: a second run finds nothing to change.
 *
 * Usage
 * -----
 *   # Locally:
 *   DATABASE_URL=… npx tsx src/scripts/backfillWorkoutNames.ts            # dry run
 *   DATABASE_URL=… npx tsx src/scripts/backfillWorkoutNames.ts --apply    # write
 *
 *   # In the container (compiled into the image):
 *   docker exec <app> node /app/backend/dist/scripts/backfillWorkoutNames.js
 *   docker exec <app> node /app/backend/dist/scripts/backfillWorkoutNames.js --apply
 *
 *   --user=<uuid>   only this user's tracks
 *
 * Output goes to stdout for the operator (it names tours, so it is for a
 * terminal); the log line carries counts only.
 */

import { prisma } from "../db";
import { relocalizedTrackName } from "../services/tour/tracks/workoutName";
import logger from "../utils/logger";

const WORKOUT_SOURCES = ["healthkit", "healthconnect"];

export interface WorkoutRename {
  trackId: string;
  routeId: string;
  from: string;
  to: string;
  /** False when the tour carries a name of its own and keeps it. */
  renamesTour: boolean;
}

export async function backfillWorkoutNames(options: {
  apply: boolean;
  userId?: string;
}): Promise<WorkoutRename[]> {
  const tracks = await prisma.tripRouteTrack.findMany({
    where: {
      source: { in: WORKOUT_SOURCES },
      name: { not: null },
      ...(options.userId ? { route: { userId: options.userId } } : {}),
    },
    select: {
      id: true,
      name: true,
      startedAt: true,
      geometry: true,
      route: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  });
  const renames: WorkoutRename[] = [];
  for (const t of tracks) {
    const to = relocalizedTrackName(t.name, t.startedAt, t.geometry);
    if (!to || !t.name) continue;
    renames.push({
      trackId: t.id,
      routeId: t.route.id,
      from: t.name,
      to,
      renamesTour: t.route.name === t.name,
    });
  }
  if (options.apply)
    await prisma.$transaction(async (tx) => {
      for (const r of renames) {
        // Guarded on the old name: a rename since the dry run is the user's.
        await tx.tripRouteTrack.updateMany({
          where: { id: r.trackId, name: r.from },
          data: { name: r.to },
        });
        if (r.renamesTour)
          await tx.tripRoute.updateMany({
            where: { id: r.routeId, name: r.from },
            data: { name: r.to },
          });
      }
    });
  logger.info({
    operation: "backfill_workout_names",
    apply: options.apply,
    tracks: renames.length,
    tours: renames.filter((r) => r.renamesTour).length,
  });
  return renames;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const userId = argv.find((a) => a.startsWith("--user="))?.split("=")[1];
  const renames = await backfillWorkoutNames({ apply, userId });
  process.stdout.write(
    `${apply ? "APPLIED" : "DRY RUN"} — ${renames.length} workout name(s) to correct\n`
  );
  for (const r of renames)
    process.stdout.write(
      `  track ${r.trackId}: "${r.from}" -> "${r.to}"` +
        `${r.renamesTour ? ` (and tour ${r.routeId})` : " (tour keeps its own name)"}\n`
    );
}

if (require.main === module) {
  main()
    .catch((error) => {
      logger.error({ operation: "backfill_workout_names_failed", err: error });
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
