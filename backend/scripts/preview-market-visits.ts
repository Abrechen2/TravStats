/** File-only experiment. This command never connects to Prod, Dawarich or a DB. */
import fs from "node:fs";
import { detectMarketVisits, MARKET_RULES } from "../src/services/dawarich/marketVisits/detect";
import {
  previewMarketVisit,
  type KnownPlace,
  type KnownTrip,
  type KnownVisit,
} from "../src/services/dawarich/marketVisits/preview";
import type { MarketArea } from "../src/services/dawarich/marketVisits/geometry";
import type { DawarichPoint } from "../src/services/dawarich/dawarichClient";

import { prepareMarketAreas } from "../src/services/dawarich/marketVisits/areas";

function main() {
  const [inputFile, areasFile, outputFile, ...extra] = process.argv.slice(2);
  if (!inputFile || !areasFile || !outputFile || extra.length)
    throw new Error(
      "Usage: tsx scripts/preview-market-visits.ts <private-input.json> <markets.geojson> <new-private-output.json>"
    );
  const input = JSON.parse(fs.readFileSync(inputFile, "utf8")) as {
    points: DawarichPoint[];
    places?: KnownPlace[];
    visits?: KnownVisit[];
    trips?: KnownTrip[];
    truncated?: boolean;
  };
  if (!Array.isArray(input.points) || input.points.length > 250_000)
    throw new Error("Expected at most 250000 original position points");
  if (input.truncated)
    throw new Error("Incomplete input: do not present a partial track as a complete trip");
  const catalog = JSON.parse(fs.readFileSync(areasFile, "utf8"));
  if (
    catalog.type !== "FeatureCollection" ||
    !Array.isArray(catalog.features) ||
    catalog.features.length > 2000
  )
    throw new Error("Expected a bounded GeoJSON market catalog");
  const missingAreas: { id: string; name: string; reason: string }[] = [];
  const areas: MarketArea[] = [];
  for (const feature of catalog.features) {
    if (feature.properties?.kind !== "market") continue;
    const { id, name, sourceUrl, parentId, entityRef } = feature.properties;
    if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
      missingAreas.push({ id, name, reason: "areaMissing" });
      continue;
    }
    areas.push({ id, name, sourceUrl, parentId, entityRef, geometry: feature.geometry });
  }
  const started = performance.now();
  const prepared = prepareMarketAreas(areas);
  const findings = detectMarketVisits(input.points, areas).map((c) =>
    previewMarketVisit(
      c,
      prepared.find((a) => a.id === c.marketId)!,
      {
        places: input.places ?? [],
        visits: input.visits ?? [],
        trips: input.trips ?? [],
      }
    )
  );
  const result = {
    previewOnly: true,
    writesToProduction: 0,
    rules: MARKET_RULES,
    inputPointCount: input.points.length,
    areaCount: areas.length,
    missingAreas,
    elapsedMs: Math.round(performance.now() - started),
    findings,
  };
  // Never overwrite a source file or previous evidence. Private by default.
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      previewOnly: true,
      points: result.inputPointCount,
      areas: areas.length,
      candidates: findings.length,
      alreadyRecorded: findings.filter((f) => f.status === "alreadyRecorded").length,
      review: findings.filter((f) => f.status !== "alreadyRecorded").length,
      missingAreas: missingAreas.length,
      elapsedMs: result.elapsedMs,
      writesToProduction: 0,
    })
  );
}
try {
  main();
} catch (error) {
  // File paths and input positions are private; never dump an input payload.
  console.error(error instanceof Error ? error.message : "Market preview failed");
  process.exitCode = 1;
}
