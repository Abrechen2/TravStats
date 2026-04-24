/**
 * One-off script: fetches every demo-user cruise geometry via the live
 * backend, runs each interior vertex through the 0.1° land mask, and
 * reports any cruise whose route crosses land.
 *
 *   DATABASE_URL=... npx tsx backend/scripts/auditCruiseGeometries.ts
 */

import { PrismaClient } from "@prisma/client";
import { isWater, loadLandMask } from "../src/services/seaRouter";
import { getOrComputeSeaRoute } from "../src/services/cruiseRouteCache";
import { prisma } from "../src/db";

interface StopRow {
  dayNumber: number;
  isAtSea: boolean;
  port: { id: number; name: string; lat: number | null; lon: number | null } | null;
}

async function auditCruise(
  prisma: PrismaClient,
  cruiseId: string,
  shipName: string,
): Promise<void> {
  const stops = (await prisma.cruiseStop.findMany({
    where: { cruiseId },
    orderBy: { dayNumber: "asc" },
    include: { port: true },
  })) as unknown as StopRow[];

  const portStops = stops.filter(
    (s) => !s.isAtSea && s.port && s.port.lat !== null && s.port.lon !== null,
  );
  if (portStops.length < 2) return;

  const issues: string[] = [];
  for (let i = 0; i < portStops.length - 1; i++) {
    const from = portStops[i].port!;
    const to = portStops[i + 1].port!;
    const route = await getOrComputeSeaRoute(
      from.id,
      to.id,
      { lat: from.lat!, lon: from.lon! },
      { lat: to.lat!, lon: to.lon! },
    );
    if (!route) {
      issues.push(`${from.name} → ${to.name}: no route`);
      continue;
    }
    const coords = route.line.coordinates;
    // Check interior vertices (skip first + last — ports may be in harbours).
    let landHits = 0;
    let firstLandAt: [number, number] | null = null;
    for (let k = 1; k < coords.length - 1; k++) {
      const [lon, lat] = coords[k];
      if (!isWater(lat, lon)) {
        landHits++;
        firstLandAt ??= [lat, lon];
      }
    }
    const pct = Math.round((landHits / Math.max(1, coords.length - 2)) * 100);
    if (landHits >= 2 || route.quality === "schematic") {
      issues.push(
        `${from.name} → ${to.name}: ${landHits}/${coords.length - 2} land ` +
          `vertices (${pct}%), first at (${firstLandAt?.[0].toFixed(2)},${firstLandAt?.[1].toFixed(2)}) ` +
          `[backend quality=${route.quality}, landRatio=${route.landRatio.toFixed(2)}]`,
      );
    }
  }
  if (issues.length > 0) {
    console.log(`\n=== ${shipName} (${cruiseId}) ===`);
    for (const msg of issues) console.log(`  ${msg}`);
  } else {
    console.log(`OK  ${shipName}`);
  }
}

async function main(): Promise<void> {
  await loadLandMask();
  const demoUser = await prisma.user.findUnique({ where: { username: "demo" } });
  if (!demoUser) {
    console.error('User "demo" not found — run seedDemoAccount first.');
    process.exit(1);
  }
  const cruises = await prisma.cruise.findMany({
    where: { userId: demoUser.id },
    include: { ship: true },
    orderBy: { startDate: "asc" },
  });
  console.log(`Auditing ${cruises.length} cruises…\n`);
  for (const c of cruises) {
    await auditCruise(
      prisma,
      c.id,
      c.ship?.name ?? c.shipNameOverride ?? "(no ship)",
    );
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
