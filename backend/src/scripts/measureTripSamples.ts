/**
 * Measures the trip-document template against the REAL sample mails, the same
 * way `measureLodgingSamples.ts` measures the Booking.com one. Offline: no DB,
 * no model. Run it after any change to the template.
 *
 *   cd backend && npx tsx src/scripts/measureTripSamples.ts
 *
 * The samples are the owner's private mail and are gitignored, so this prints
 * what was found rather than asserting it — the numbers are the point.
 */
import * as fs from "fs";
import * as path from "path";
import MsgReader from "@kenjiuno/msgreader";
import { extractTextFromPdf } from "../services/pdfParser";
import { parseTripDocument, type TripDocument } from "../services/trip/tripDocumentParser";

const DIR =
  process.env.SAMPLE_DIR ??
  path.resolve(__dirname, "../../..", "test-samples", "Rundreisen Mails");

if (!fs.existsSync(DIR)) {
  console.log(`No sample folder at ${DIR} — set SAMPLE_DIR. Nothing to measure.`);
  process.exit(0);
}

interface Row {
  mail: string;
  pdf: string;
  doc: TripDocument;
}

/** Optional: write the parsed documents out so other tools can compare against them. */
const OUT = process.env.OUT ?? "";

async function main(): Promise<void> {
  const entries = fs.readdirSync(DIR).sort();
  const files = entries.filter((f) => /\.msg$/i.test(f));
  const losePdfs = entries.filter((f) => /\.pdf$/i.test(f));
  const rows: Row[] = [];
  let mailsWithoutPdf = 0;

  for (const mail of files) {
    const reader = new MsgReader(fs.readFileSync(path.join(DIR, mail)));
    const attachments = (reader.getFileData().attachments ?? []).filter((a) =>
      /\.pdf$/i.test(a.fileName ?? ""),
    );
    if (attachments.length === 0) mailsWithoutPdf += 1;
    for (const att of attachments) {
      const content = reader.getAttachment(att);
      const text = await extractTextFromPdf(Buffer.from(content.content));
      rows.push({ mail, pdf: att.fileName ?? "?", doc: parseTripDocument(text) });
    }
  }

  // Documents also arrive detached from their mail — saved out of the mail
  // client, or forwarded as a bare file. Reading only attachments would miss
  // every one of them and quietly report a smaller sample.
  for (const pdf of losePdfs) {
    const text = await extractTextFromPdf(fs.readFileSync(path.join(DIR, pdf)));
    rows.push({ mail: "(lose Datei)", pdf, doc: parseTripDocument(text) });
  }

  const invoices = rows.filter((r) => r.doc.kind === "invoice");
  const itineraries = rows.filter((r) => r.doc.kind === "itinerary");
  const unknown = rows.filter((r) => r.doc.kind === "unknown");

  console.log(`\nMails: ${files.length} · PDFs: ${rows.length} · ohne PDF: ${mailsWithoutPdf}`);
  console.log(
    `Erkannt: ${invoices.length} Rechnung · ${itineraries.length} Unterlagen · ${unknown.length} unbekannt`,
  );

  const pct = (n: number, of: number): string =>
    of === 0 ? "—" : `${n}/${of} (${Math.round((n / of) * 100)}%)`;

  console.log("\n--- Rechnung ---");
  console.log(`  Buchungs-Nr. : ${pct(invoices.filter((r) => r.doc.bookingReference).length, invoices.length)}`);
  console.log(`  Reisename    : ${pct(invoices.filter((r) => r.doc.tripName).length, invoices.length)}`);
  console.log(`  Reisetag     : ${pct(invoices.filter((r) => r.doc.startDate).length, invoices.length)}`);
  console.log(`  Teilnehmer   : ${pct(invoices.filter((r) => r.doc.travellers.length > 0).length, invoices.length)}`);
  console.log(`  Gesamtbetrag : ${pct(invoices.filter((r) => r.doc.totalPrice !== null).length, invoices.length)}`);
  console.log(`  Flüge (IATA) : ${pct(invoices.filter((r) => r.doc.flights.length > 0).length, invoices.length)}`);

  console.log("\n--- Reiseunterlagen ---");
  console.log(`  Buchungs-Nr. : ${pct(itineraries.filter((r) => r.doc.bookingReference).length, itineraries.length)}`);
  console.log(`  Reisedatum   : ${pct(itineraries.filter((r) => r.doc.startDate).length, itineraries.length)}`);
  console.log(`  Ablauf       : ${pct(itineraries.filter((r) => r.doc.flights.length > 0).length, itineraries.length)}`);
  console.log(`  Unterkünfte  : ${pct(itineraries.filter((r) => r.doc.stays.length > 0).length, itineraries.length)}`);

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 2), "utf8");
    console.log(`\nGeschrieben: ${OUT}`);
  }

  console.log("\n--- Je Dokument ---");
  for (const r of rows) {
    const d = r.doc;
    const real = d.flights.filter((f) => !f.ignore);
    const skipped = d.flights.filter((f) => f.ignore);
    console.log(
      `\n${d.kind.padEnd(9)} ${r.pdf}\n` +
        `  Buchung ${d.bookingReference ?? "—"} · Code ${d.tripCode ?? "—"} · Start ${d.startDate ?? "—"}\n` +
        `  Name "${d.tripName ?? "—"}" · Reisende ${d.travellers.length} · Preis ${d.totalPrice ?? "—"} ${d.currency ?? ""}\n` +
        `  Flüge ${real.length} echt / ${skipped.length} übersprungen (${[...new Set(skipped.map((f) => f.ignore))].join(", ") || "—"})` +
        (d.countries.length ? ` · Länder ${d.countries.join(", ")}` : ""),
    );
    for (const f of real) {
      console.log(
        `      ${f.date}  ${(f.fromIata ?? f.from).padEnd(22)} -> ${(f.toIata ?? f.to).padEnd(22)}` +
          `  ${(f.flightNumber ?? "—").padEnd(7)} ${f.departTime ?? ""}${f.arrivesNextDay ? " (+1)" : ""}`,
      );
    }
    for (const s of d.stays) {
      console.log(
        `      ${s.from}-${s.to}  ${s.name.padEnd(34)} | ${s.city ?? "—"} | ${s.country ?? "—"}` +
          `${s.addressLines.length ? ` | ${s.addressLines.join(" / ")}` : ""}`,
      );
    }
  }
}

void main();
