import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "@jest/globals";
import { TOUR_ACTIVITIES } from "../roadtrip";

/**
 * `shared/tour/roadtrip.ts` exists twice — here and in the frontend — and its
 * header says "change both together". Nothing checks that, so this reads the
 * frontend file from disk and compares the activity vocabulary.
 */
function frontendActivities(): string[] {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../../../frontend/src/shared/tour/roadtrip.ts"),
    "utf8"
  );
  const literal = /TOUR_ACTIVITIES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (!literal) throw new Error("TOUR_ACTIVITIES literal not found in the frontend mirror");
  return [...literal[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("TOUR_ACTIVITIES", () => {
  it("names a guided excursion — a coach day tour belongs to the tour domain", () => {
    expect(TOUR_ACTIVITIES).toContain("excursion");
  });

  it("keeps `other` last, the catch-all after every named activity", () => {
    expect(TOUR_ACTIVITIES[TOUR_ACTIVITIES.length - 1]).toBe("other");
  });

  it("is identical in the backend and the frontend mirror", () => {
    expect(frontendActivities()).toEqual([...TOUR_ACTIVITIES]);
  });
});
