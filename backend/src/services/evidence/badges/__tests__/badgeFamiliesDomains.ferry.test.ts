import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../../db";
import { BADGE_PROOF_TYPES, BADGE_WITHOUT_EVIDENCE } from "../../../../shared/badgeEvidence";
import { loadBadgeFamily } from "../badgeFamiliesDomains";

/**
 * forgejo#405 — the three older ferry rules (crossings, night crossings,
 * ports) opened no list while the four newer ones did. They open their
 * counted crossings now, folded by the badge's own module.
 */
const USER = "badge-family-ferry";

const crossing = (userId: string, dep: string, arr: string, day: string) => ({
  userId,
  operator: "Color Line",
  depStationName: dep,
  depLat: 54.3,
  depLon: 10.1,
  depTimezone: "Europe/Berlin",
  arrStationName: arr,
  arrLat: 59.9,
  arrLon: 10.7,
  arrTimezone: "Europe/Oslo",
  departureTime: new Date(`${day}T12:00:00Z`),
  arrivalTime: new Date(`${day}T20:00:00Z`),
  status: "completed",
});

describe("older ferry badge rules carry evidence lists (forgejo#405)", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.ferryJourney.createMany({
      data: [
        crossing(userId, "Kiel", "Oslo", "2025-06-01"),
        crossing(userId, "Kiel", "Oslo", "2025-06-08"),
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("registers them as proofs, not as rules without evidence", () => {
    for (const type of ["ferry_count", "ferry_night_crossings", "ferry_ports"]) {
      expect(BADGE_PROOF_TYPES).toContain(type);
      expect(BADGE_WITHOUT_EVIDENCE).not.toHaveProperty(type);
    }
  });

  it("lists the counted crossings behind ferry_count and counts the subset", async () => {
    const family = await loadBadgeFamily(
      userId,
      { requirementType: "ferry_count", requirement: 5 },
      null
    );
    if (!family) throw new Error("ferry_count has no family");
    expect(family.rows).toHaveLength(2);
    expect(await family.progress(family.rows.slice(0, 1))).toBe(1);
    expect(await family.progress(family.rows)).toBe(2);
  });

  it("counts the two ends behind ferry_ports once each", async () => {
    const family = await loadBadgeFamily(
      userId,
      { requirementType: "ferry_ports", requirement: 5 },
      null
    );
    if (!family) throw new Error("ferry_ports has no family");
    expect(await family.progress(family.rows)).toBe(2);
  });
});
