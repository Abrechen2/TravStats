import fs from "fs";
import path from "path";

import { prisma } from "../../../../db";
import { seedRailStations } from "../../../../seedRailStations";
import { extractEmailFromFile } from "../../../emailExtractor";
import { scoreDocument } from "../../../parsing/documentDomain";
import { extractTextFromPdf } from "../../../pdfParser";
import { readRailTemplates } from "../railBookingParser";
import { toRailCandidate } from "../railCandidates";

/**
 * LOCAL ONLY — real booking mails that never enter the repository. Each block
 * skips itself where its files are absent, which is everywhere but the
 * owner's machines, so CI stays green; see `lodgingParseRoutes.realSample`.
 *
 * pdf-parse loads its worker through a dynamic import, which Jest refuses
 * without `--experimental-vm-modules` ("A dynamic import callback was invoked
 * without…"); production (node/tsx) is unaffected. The PDFs are what these
 * tests are about, so they run only with the flag:
 *
 *   NODE_OPTIONS=--experimental-vm-modules npx jest railLocalSamples --forceExit
 *
 * Nothing from the documents is printed or asserted verbatim: only counts,
 * shapes and the values the owner released for tests. The station catalogue
 * is seeded for the run when missing and the rows this run added are removed
 * again afterwards.
 */

const OWNER_SAMPLE = path.resolve(
  __dirname,
  "../../../../../..",
  "test-samples",
  "Bahn",
  "db-buchungsbestaetigung-1.pdf"
);
/** Another person's rail mails, released by the owner as a read-only corpus. */
const TRAINS_CORPUS = "//UNRAID/Download/PST-Nowi/out/Trains";

const reachable = (p: string): boolean => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

/** See the header: without the flag every PDF read fails, and the test would measure that. */
const pdfReadable = (process.env.NODE_OPTIONS ?? "").includes("--experimental-vm-modules");
const hasOwnerSample = pdfReadable && reachable(OWNER_SAMPLE);
const hasCorpus = pdfReadable && reachable(TRAINS_CORPUS);

let seededAbove: number | null = null;

beforeAll(async () => {
  if (!hasOwnerSample && !hasCorpus) return;
  const top = await prisma.railStation.aggregate({ _max: { id: true } });
  seededAbove = top._max.id ?? 0;
  await seedRailStations();
}, 300_000);

afterAll(async () => {
  if (seededAbove !== null) {
    await prisma.railStation.deleteMany({
      where: { id: { gt: seededAbove }, isUserAdded: false },
    });
  }
});

(hasOwnerSample ? describe : describe.skip)("the owner's DB booking confirmation (PDF)", () => {
  it("reads one short-distance leg, both stations resolved, class, total and order number", async () => {
    const text = await extractTextFromPdf(fs.readFileSync(OWNER_SAMPLE));
    expect(scoreDocument(text).domain).toBe("rail");

    const { booking } = await readRailTemplates(text);
    expect(booking).not.toBeNull();
    const candidate = await toRailCandidate(booking!, undefined);
    expect(candidate).toMatchObject({
      travelClass: "second",
      price: 2,
      currency: "EUR",
      source: "db-confirmation",
    });
    expect(candidate.bookingReference).toMatch(/^\d{12}$/);
    expect(candidate.legs).toHaveLength(1);
    const [leg] = candidate.legs;
    expect(leg).toMatchObject({
      departureLocal: "2025-06-07T09:38",
      arrivalLocal: "2025-06-07T09:48",
      trainCategory: null,
      trainNumber: null,
    });
    expect(leg.departureStation).toMatchObject({ resolved: true, timezone: "Europe/Berlin" });
    expect(leg.arrivalStation).toMatchObject({ resolved: true, timezone: "Europe/Berlin" });
  }, 120_000);
});

/** A DB mail generation, told apart by the subject line DB gave it. */
function generationOf(subject: string): string | null {
  const s = subject.replace(/^(\s*(WG|Fwd|AW|Re)\s*:\s*)+/i, "");
  if (!/Auftrag/.test(s) || /Angebot|Anfrage an|Verspaetungs|Verspätungs/i.test(s)) return null;
  if (/^Ihre Bestellung/i.test(s)) return "Bestellung (Post)";
  if (/^Ihre Buchung auf/i.test(s)) return "Buchung auf bahn.de";
  if (/^Ihre Buchung vom/i.test(s)) return "Auftragsbestätigung (Post)";
  if (/^Ihre Buchung bei/i.test(s)) return "Buchung bei bahn.de";
  if (/Fahrkartenkauf/i.test(s)) return "Fahrkartenkauf";
  if (/^Buchungsbestätigung/i.test(s)) return "Buchungsbestätigung";
  return null;
}

interface Row {
  years: Set<number>;
  mails: number;
  detected: number;
  recognised: number;
  withLegs: number;
  legs: number;
  resolved: number;
  withTrain: number;
  withPrice: number;
  withClass: number;
}

const emptyRow = (): Row => ({
  years: new Set(),
  mails: 0,
  detected: 0,
  recognised: 0,
  withLegs: 0,
  legs: 0,
  resolved: 0,
  withTrain: 0,
  withPrice: 0,
  withClass: 0,
});

(hasCorpus ? describe : describe.skip)("the DB mail corpus (counts only)", () => {
  it("recognises every booking generation and no non-booking", async () => {
    const rows = new Map<string, Row>();
    for (const file of fs.readdirSync(TRAINS_CORPUS).filter((f) => /\.msg$/i.test(f))) {
      const mail = extractEmailFromFile(fs.readFileSync(path.join(TRAINS_CORPUS, file)), file);
      const text = mail.subject ? `${mail.subject}\n\n${mail.text}` : mail.text;
      const generation = generationOf(mail.subject) ?? "keine Buchung";
      const row = rows.get(generation) ?? emptyRow();
      rows.set(generation, row);
      row.mails += 1;
      if (mail.sentAt) row.years.add(mail.sentAt.getUTCFullYear());
      if (scoreDocument(text).domain === "rail") row.detected += 1;

      const { booking, orderReference } = await readRailTemplates(text, mail.attachments ?? []);
      if (booking || orderReference) row.recognised += 1;
      if (!booking) continue;
      const candidate = await toRailCandidate(booking, undefined);
      row.withLegs += 1;
      row.legs += candidate.legs.length;
      row.resolved += candidate.legs.filter(
        (l) => l.departureStation.resolved && l.arrivalStation.resolved
      ).length;
      row.withTrain += candidate.legs.filter((l) => l.trainNumber !== null).length;
      if (candidate.price !== null) row.withPrice += 1;
      if (candidate.travelClass !== null) row.withClass += 1;
    }

    const table = [...rows.entries()].map(([generation, r]) => ({
      generation,
      years: r.years.size ? `${Math.min(...r.years)}–${Math.max(...r.years)}` : "",
      mails: r.mails,
      detectedRail: r.detected,
      recognised: r.recognised,
      mailsWithLegs: r.withLegs,
      legs: r.legs,
      legsBothResolved: r.resolved,
      legsWithTrain: r.withTrain,
      mailsWithPrice: r.withPrice,
      mailsWithClass: r.withClass,
    }));
    // Counts, never contents — the one thing this suite may print.
    console.table(table);

    const negatives = rows.get("keine Buchung");
    expect(negatives?.recognised ?? 0).toBe(0);
    for (const [generation, r] of rows) {
      if (generation === "keine Buchung") continue;
      // Every booking mail says at least which order it is; one encrypted mail
      // in the corpus is the known exception.
      expect(r.recognised).toBeGreaterThanOrEqual(r.mails - 1);
    }
    // Floors measured on 2026-09-26 — a template change may raise them, never lower.
    const floor = (g: string) => rows.get(g)?.withLegs ?? 0;
    expect(floor("Bestellung (Post)")).toBeGreaterThanOrEqual(7);
    expect(floor("Buchung bei bahn.de")).toBeGreaterThanOrEqual(42);
    expect(floor("Fahrkartenkauf")).toBeGreaterThanOrEqual(33);
    expect(floor("Buchungsbestätigung")).toBeGreaterThanOrEqual(59);
    const resolvedLegs = [...rows.values()].reduce((sum, r) => sum + r.resolved, 0);
    expect(resolvedLegs).toBeGreaterThanOrEqual(386);
  }, 600_000);
});
