import { describe, it, expect, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import inventory from "../../services/federation/e2e/fieldInventory.json";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
} from "./sharingFixtures";

/**
 * A custom purpose is private to its owner (spec 2026-11-22-private-business-purpose.md, "Custom
 * purposes"): neither a shared copy nor a federated record carries its key or name.
 */
describe("purpose: a share hides custom purpose names", () => {
  afterAll(async () => {
    await wipeShareTestAccounts();
  });

  it("the member's copy of a shared flight carries no custom key, and the name never reaches them", async () => {
    const owner = await makeAccount("pcat-owner");
    const member = await makeAccount("pcat-member");
    const custom = await prisma.customPurpose.create({
      data: {
        userId: owner.id,
        name: "Projekt Geheimkunde",
        kind: "business",
        color: "#112233",
        icon: "briefcase",
      },
    });
    const full = await makeFullTrip(owner);
    await prisma.flight.update({
      where: { id: full.flight.id },
      data: { purpose: `custom:${custom.id}` },
    });
    const companion = await linkWithConsent(owner, member);
    const { shareTrip } = await import("../../services/sharing/shareTrip");
    await shareTrip(owner.id, full.trip.id, companion.id);

    const copies = await prisma.flight.findMany({ where: { userId: member.id } });
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(copy.purposeKey).toBeNull();
      expect(copy.purpose).toBeNull();
    }
    const flights = await request(app).get("/api/v1/flights").set("Cookie", member.cookie);
    const catalogue = await request(app)
      .get("/api/v1/purpose/catalogue")
      .set("Cookie", member.cookie);
    for (const body of [flights.body, catalogue.body]) {
      expect(JSON.stringify(body)).not.toContain("Geheimkunde");
      expect(JSON.stringify(body)).not.toContain(custom.id);
    }
  });

  it("the federated field inventory excludes the detailed key wherever it excludes the kind", () => {
    const rows = Object.values(inventory as Record<string, { excluded?: string }>).filter((r) =>
      (r.excluded ?? "").split(" ").includes("purpose")
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect((row.excluded ?? "").split(" ")).toContain("purposeKey");
  });
});
