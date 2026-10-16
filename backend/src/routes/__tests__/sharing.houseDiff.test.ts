import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A member's copy of a stay may be filed under the member's OWN house (same
 * name and place). That row is theirs and serves their other stays too, so a
 * change the sharer made to one fact of the house carries that one fact — it
 * must not overwrite the rest of the member's house with the sharer's values.
 */
describe("sharing — a house change carries only what changed", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;
  let bensHouseId: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    full = await makeFullTrip(anna);
    const bensHouse = await prisma.lodging.create({
      data: {
        userId: ben.id,
        name: "Hotel Avenida Palace",
        city: "Lisboa",
        country: "PT",
        address: "Rua 1º de Dezembro 123",
        stars: 5,
        website: "https://ben.example",
      },
    });
    bensHouseId = bensHouse.id;
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, full.trip.id, companion.id);
    await prisma.shareNotice.deleteMany({ where: { userId: ben.id } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bensHouse = () => prisma.lodging.findUniqueOrThrow({ where: { id: bensHouseId } });

  it("writes the changed website and leaves Ben's address and stars alone", async () => {
    const copy = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } });
    expect(copy.lodgingId).toBe(bensHouseId);

    await request(app)
      .patch(`/api/v1/lodging/${full.lodging.id}`)
      .set("Cookie", anna.cookie)
      .send({ website: "https://avenidapalace.pt" })
      .expect(200);

    const after = await bensHouse();
    expect(after.website).toBe("https://avenidapalace.pt");
    expect(after.address).toBe("Rua 1º de Dezembro 123");
    expect(after.stars).toBe(5);
  });

  it("an undo restores Ben's own website and touches nothing else", async () => {
    await request(app)
      .patch(`/api/v1/lodging/${full.lodging.id}`)
      .set("Cookie", anna.cookie)
      .send({ website: "https://avenidapalace.pt" })
      .expect(200);
    const notice = await prisma.shareNotice.findFirstOrThrow({
      where: { userId: ben.id, kind: "updated" },
    });
    await request(app)
      .post(`/api/v1/sharing/notices/${notice.id}/undo`)
      .set("Cookie", ben.cookie)
      .expect(200);
    const after = await bensHouse();
    expect(after.website).toBe("https://ben.example");
    expect(after.address).toBe("Rua 1º de Dezembro 123");
    expect(after.stars).toBe(5);
  });
});
