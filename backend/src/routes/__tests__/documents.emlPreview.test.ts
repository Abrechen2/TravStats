import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * A kept mail opens as readable text (`?view=text`) instead of only a download.
 * Until 2026-10-16 an `.eml` could only be downloaded, so a booking confirmation
 * filed with a flight could not be looked at in the app at all.
 */
const CRLF = "\r\n";
const lines = (...l: string[]): Buffer => Buffer.from(l.join(CRLF));

const QUOTED_PRINTABLE_MAIL = lines(
  "From: Lufthansa <noreply@booking-lufthansa.com>",
  "To: Dennis <dennis@example.org>",
  "Subject: =?UTF-8?Q?Ihre_Buchungsbest=C3=A4tigung_M4UXDO?=",
  "Date: Tue, 21 Sep 2021 10:14:00 +0200",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "X-TravStats-Detached: 4-20210921_WITTKE_M4UXDO.pdf; sha256=abc",
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "LH2460 M=C3=BCnchen 08:35 =E2=86=92 Helsinki 12:00",
  "--b1",
  "Content-Type: text/calendar; name=termin.ics",
  "Content-Disposition: attachment; filename=termin.ics",
  "",
  "BEGIN:VCALENDAR",
  "--b1--",
  ""
);

const HTML_ONLY_MAIL = lines(
  "From: hotel@example.org",
  "Subject: Reservation",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">',
  "<html><head><title>Mailer template 7</title><style>p{color:red}</style></head>",
  "<body><p>Check-in <b>12.04.</b></p><script>alert('x')</script>",
  '<img src="https://tracker.example/pixel.gif"><p>Zimmer 204</p></body></html>',
  ""
);

describe("GET /documents/:id/file?view=text", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let flightId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `eml-view-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "MUC",
          depLat: 48.35,
          depLon: 11.78,
          arrIata: "HEL",
          arrLat: 60.32,
          arrLon: 24.96,
          departureTime: new Date("2021-10-28T06:35:00Z"),
          status: "flown",
        },
      })
    ).id;
    const file = async (key: string, buffer: Buffer, originalName: string): Promise<void> => {
      ids[key] = (
        await createDocument({
          userId,
          buffer,
          originalName,
          entry: { type: "flight", id: flightId },
        })
      ).document.id;
    };
    await file("qp", QUOTED_PRINTABLE_MAIL, "Buchung.eml");
    await file("html", HTML_ONLY_MAIL, "Hotel.eml");
    await file("pdf", Buffer.from("%PDF-1.4\n% eml-view\n%%EOF"), "Ticket.pdf");
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("shows sender, date, decoded subject and body, and the attachments", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${ids.qp}/file?view=text`)
      .set("Cookie", cookie)
      .set("Accept-Language", "de-DE,de;q=0.9");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain; charset=utf-8/);
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.text).toContain("Von: Lufthansa <noreply@booking-lufthansa.com>");
    expect(res.text).toContain("Datum: Tue, 21 Sep 2021 10:14:00 +0200");
    expect(res.text).toContain("Betreff: Ihre Buchungsbestätigung M4UXDO");
    expect(res.text).toContain("LH2460 München 08:35 → Helsinki 12:00");
    expect(res.text).toContain("- termin.ics");
    expect(res.text).toContain("- 4-20210921_WITTKE_M4UXDO.pdf (separat abgelegt)");
  });

  it("reads an HTML-only mail as its text and drops what would run or load", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${ids.html}/file?view=text`)
      .set("Cookie", cookie)
      .set("Accept-Language", "en");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Subject: Reservation");
    expect(res.text).toContain("Check-in 12.04.");
    expect(res.text).toContain("Zimmer 204");
    expect(res.text).not.toContain("<");
    expect(res.text).not.toContain("alert");
    expect(res.text).not.toContain("tracker.example");
    expect(res.text).not.toContain("DOCTYPE");
    expect(res.text).not.toContain("Mailer template");
    expect(res.text).not.toContain("color:red");
  });

  it("still hands over the original mail as a download without the view", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${ids.qp}/file`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="Buchung\.eml"/);
    expect(res.body as Buffer).toEqual(QUOTED_PRINTABLE_MAIL);
  });

  it("ignores the view for a format that is not a mail", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${ids.pdf}/file?view=text`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
  });
});
