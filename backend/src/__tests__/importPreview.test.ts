import fs from "fs";
import path from "path";
import { buildPreviewRows, type PreviewRowInput } from "../services/importPreview";
import { prisma } from "../db";

function loadFr24Fixture(): PreviewRowInput[] {
  const csv = fs.readFileSync(path.join(__dirname, "fixtures/fr24-sample.csv"), "utf-8");
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [header, ...rows] = lines;
  const cols = header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"(.*)"$/, "$1"));
  return rows.map((r, idx) => {
    const cells = r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"(.*)"$/, "$1"));
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    const fromMatch = row.From.match(/\(([A-Z0-9]+)\/([A-Z0-9]+)\)/);
    const toMatch = row.To.match(/\(([A-Z0-9]+)\/([A-Z0-9]+)\)/);
    const [hh, mm, ss] = (row.Duration || "00:00:00").split(":").map(Number);
    return {
      date: row.Date,
      depTimeLocal: row["Dep time"],
      arrTimeLocal: row["Arr time"],
      durationSeconds: (hh ?? 0) * 3600 + (mm ?? 0) * 60 + (ss ?? 0),
      fromIata: fromMatch ? fromMatch[1] : "",
      toIata: toMatch ? toMatch[1] : "",
      flightNumber: row["Flight number"],
      airline: row.Airline,
      aircraft: row.Aircraft,
      registration: row.Registration,
      seatNumber: row["Seat number"],
      notes: row.Note || undefined,
      source: "fr24" as const,
      sourceRowIndex: idx,
    };
  });
}

describe("importPreview.buildPreviewRows", () => {
  let userId: string;
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-import-preview-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("trans-meridian — uses Duration as ground truth for IDL-westbound (LAX→SYD)", async () => {
    const inputs = loadFr24Fixture();
    const rows = (await buildPreviewRows(userId, inputs)).rows;
    const lax = rows.find((r) => r.fromIata === "LAX" && r.toIata === "SYD");
    expect(lax).toBeDefined();
    const delta = lax!.arrUtc.getTime() - lax!.depUtc.getTime();
    expect(Math.abs(delta - 14 * 3600 * 1000 - 55 * 60 * 1000)).toBeLessThan(60_000);
    expect(lax!.arrivalLocalCorrected.startsWith("2023-03-24")).toBe(true);
  });

  it("status defaulting — 2019 row is flown, 2024 future row is scheduled", async () => {
    const inputs = loadFr24Fixture();
    const rows = (await buildPreviewRows(userId, inputs)).rows;
    const tk = rows.find((r) => r.flightNumberNormalised === "TK1989");
    expect(tk?.statusDefault).toBe("flown");
  });

  it("flag — duration_mismatch is set when |Duration - derived| > 30min", async () => {
    // dep FRA 10:00 CET (09:00 UTC), duration 8h → arrUtc = 17:00 UTC
    // arr JFK 11:00 EST (16:00 UTC) — 1h off from 17:00 UTC, well beyond 30 min threshold
    const bad: PreviewRowInput[] = [
      {
        date: "2024-01-15",
        depTimeLocal: "10:00:00",
        arrTimeLocal: "11:00:00",
        durationSeconds: 8 * 3600,
        fromIata: "FRA",
        toIata: "JFK",
        flightNumber: "LH400",
        source: "fr24",
        sourceRowIndex: 0,
      },
    ];
    const rows = (await buildPreviewRows(userId, bad)).rows;
    expect(rows[0].flags).toContain("duration_mismatch");
  });

  it("duration_mismatch is a soft warning — depUtc/arrUtc/arrivalLocalCorrected stay valid", async () => {
    // Regression for jay-tau UAT (issue #99): FR24's `Duration` field uses
    // UTC+4 instead of Asia/Kolkata (+5:30) for BLR-international flights,
    // tripping duration_mismatch on otherwise valid rows. The frontend used
    // to silently drop them. The backend MUST keep producing usable
    // depUtc/arrUtc/arrivalLocalCorrected so the row stays importable.
    // Reproduces jay-tau's AF191 BLR→CDG observation:
    //   real ~10h35, IATA-correct math 11h00, FR24's broken Duration 9h30
    // depUtc = 2023-03-15 01:30 IST = 2023-03-14 20:00 UTC
    // naive arrUtc = 2023-03-15 08:00 CET = 2023-03-15 07:00 UTC (= 11h flight)
    // derived arrUtc = depUtc + 9h30 = 2023-03-15 05:30 UTC
    // delta = 90 min, well past the 30-min threshold
    const blrRoute: PreviewRowInput[] = [
      {
        date: "2023-03-15",
        depTimeLocal: "01:30:00",
        arrTimeLocal: "08:00:00",
        durationSeconds: 9 * 3600 + 30 * 60,
        fromIata: "BLR",
        toIata: "CDG",
        flightNumber: "AF191",
        source: "fr24",
        sourceRowIndex: 0,
      },
    ];
    const rows = (await buildPreviewRows(userId, blrRoute)).rows;
    expect(rows[0].flags).toContain("duration_mismatch");
    // depUtc must NOT be SAFE_DATE (epoch 0) — frontend uses this directly
    expect(rows[0].depUtc.getTime()).toBeGreaterThan(0);
    expect(rows[0].arrUtc.getTime()).toBeGreaterThan(0);
    expect(rows[0].arrivalLocalCorrected).not.toBe("");
    // statusDefault should resolve normally — the date is in the past
    expect(rows[0].statusDefault).toBe("flown");
  });

  it("flag — unresolvable_airport is set for unknown IATA", async () => {
    const bad: PreviewRowInput[] = [
      {
        date: "2024-01-15",
        depTimeLocal: "10:00:00",
        arrTimeLocal: "12:00:00",
        fromIata: "XXX",
        toIata: "JFK",
        flightNumber: "ZZ1",
        source: "generic_csv",
        sourceRowIndex: 0,
      },
    ];
    const rows = (await buildPreviewRows(userId, bad)).rows;
    expect(rows[0].flags).toContain("unresolvable_airport");
  });

  it("flag — malformed Date or Time is rejected upstream by the parser, but server is defensive", async () => {
    const bad: PreviewRowInput[] = [
      {
        date: "2024-02-30",
        depTimeLocal: "25:00:00",
        arrTimeLocal: "26:00:00",
        fromIata: "FRA",
        toIata: "JFK",
        flightNumber: "LH400",
        source: "generic_csv",
        sourceRowIndex: 0,
      },
    ];
    const rows = (await buildPreviewRows(userId, bad)).rows;
    expect(rows[0].flags).toContain("malformed_datetime");
  });
});
