import { randomUUID } from "crypto";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { removeDocumentFile } from "../../services/documents/documentStore";

/** Synthetic mail exercises the complete upload → extract → preview → save pipeline. */
function ticketEmail(): Buffer {
  return Buffer.from(
    [
      "From: tickets@example.test",
      "To: traveller@example.test",
      "Subject: Ferry ticket",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Departure port: Bari",
      "Arrival port: Durres",
      "Departure: 20.10.2026 22:00",
      "Arrival: 21.10.2026 08:00",
      "Passengers: 2",
      "Total price: 240 EUR",
    ].join("\r\n")
  );
}
it("uploads an EML, previews its text and attaches the original only after the reviewed crossing is saved", async () => {
  const user = await prisma.user.create({
    data: { username: `ferry-email-${randomUUID()}`, passwordHash: "not-a-login" },
  });
  const cookie = `auth_token=${generateToken(user.id)}`;
  let storedName: string | undefined;
  try {
    const uploaded = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", cookie)
      .attach("file", ticketEmail(), {
        filename: "synthetic-ferry.eml",
        contentType: "message/rfc822",
      });
    expect(uploaded.status).toBe(201);
    const id = uploaded.body.data.id;
    const document = await prisma.document.findUniqueOrThrow({ where: { id } });
    storedName = document.storedName;
    const preview = await request(app)
      .post("/api/v1/ferry/ticket-preview")
      .set("Cookie", cookie)
      .send({ documentId: id });
    expect(preview.status).toBe(200);
    expect(preview.body.data.parser).toBe("labels");
    expect(preview.body.data.crossings[0]).toMatchObject({
      departurePort: { value: "Bari" },
      arrivalPort: { value: "Durres" },
      departureLocal: { value: "2026-10-20T22:00" },
      price: { value: "240" },
    });
    expect(await prisma.ferryJourney.count({ where: { userId: user.id } })).toBe(0);
    expect(document.ferryJourneyId).toBeNull();
    const saved = await request(app)
      .post("/api/v1/ferry")
      .set("Cookie", cookie)
      .send({
        departureStation: { name: "Bari", lat: 41.13, lon: 16.86, country: "IT" },
        arrivalStation: { name: "Durres", lat: 41.31, lon: 19.45, country: "AL" },
        departureLocal: "2026-10-20T22:00",
        arrivalLocal: "2026-10-21T08:00",
        documentIds: [id],
      });
    expect(saved.status).toBe(201);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).ferryJourneyId).toBe(
      saved.body.data.id
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    if (storedName) await removeDocumentFile(storedName);
  }
}, 30000);
